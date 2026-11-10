import hashlib
import importlib.util
import io
import json
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('seal', Path(__file__).with_name('owned-signing-seal.py'))
seal = importlib.util.module_from_spec(spec); spec.loader.exec_module(seal)


class SigningRecoveryEncryption(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.openssl = shutil.which('openssl') or str(Path('C:/Program Files/Git/mingw64/bin/openssl.exe'))
        if not Path(cls.openssl).is_file(): raise RuntimeError('Installed OpenSSL is required; do not skip recovery verification')

    def fixture(self, root, gateway=None, recipient=None, callback=None):
        key, cert = root / 'synthetic.key.pem', root / 'synthetic.cert.pem'
        subprocess.run([self.openssl, 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '1',
            '-subj', '/CN=Synthetic recovery unit fixture', '-keyout', str(key), '-out', str(cert)], check=True, capture_output=True)
        der = subprocess.check_output([self.openssl, 'x509', '-in', str(cert), '-outform', 'DER'])
        pin = hashlib.sha256(der).hexdigest().upper(); recovery = seal.recovery_module()
        files = {name: ('Synthetic private fixture ' + name).encode() for name in recovery.CONFIG}
        if gateway:
            names = recovery.GATEWAY if gateway == 'complete' else recovery.GATEWAY[:-1]
            files.update({name: ('Synthetic private gateway fixture ' + name).encode() for name in names})
        if recipient:
            names = recovery.RECIPIENT[:-1] if recipient == 'partial' else recovery.RECIPIENT
            files.update({name: ('Synthetic private recipient fixture ' + name).encode() for name in names})
        if callback:
            names=recovery.CALLBACK[:-1] if callback=='partial' else recovery.CALLBACK
            files.update({name:('Synthetic private callback fixture '+name).encode() for name in names})
            files['callback-trust.cert.pem']=b'Synthetic provider public certificate fixture'
        volumes = {name: ('Synthetic archive fixture ' + name).encode() for name in ['database', 'cache']}
        manifest = {'version': 1, 'images': recovery.signing.IMAGES, 'files': {name: hashlib.sha256(value).hexdigest() for name, value in files.items()},
            'fileMetadata': {name: {'uid': recovery.config_owner(name), 'gid': recovery.config_owner(name), 'mode': 0o600} for name in files},
            'volumes': {name: {'sha256': hashlib.sha256(value).hexdigest()} for name, value in volumes.items()}}
        files.update({name + '.tar': value for name, value in volumes.items()})
        files['backup-manifest.json'] = json.dumps(manifest).encode()
        proof = {name: True for name in ['allHashes', 'ownershipAndModes',
            'applicationConfigurationUsable', 'databaseCounts', 'cacheAuthenticationAndAof', 'certificatePassphrase']}
        proof['appOrMailWorkersStarted'] = False
        if gateway: proof['gatewayConfigurationUsable'] = True
        if recipient and recipient != 'missing-proof': proof['recipientConfigurationUsable'] = True
        if callback and callback!='missing-proof':proof['callbackConfigurationUsable']=True
        files['restore-verified.json'] = json.dumps(proof).encode()
        snapshot = '20261110T000000Z-a1b2c3d4'; source = io.BytesIO()
        with tarfile.open(fileobj=source, mode='w') as archive:
            for name, value in files.items():
                row = tarfile.TarInfo(snapshot + '/' + name); row.size = len(value); row.mode = 0o600
                archive.addfile(row, io.BytesIO(value))
        plaintext = source.getvalue(); target = root / (snapshot + '.cms')
        subprocess.run([self.openssl, 'cms', '-encrypt', '-binary', '-aes-256-gcm', '-stream', '-outform', 'DER', '-out', str(target),
            '-recip', str(cert), '-keyopt', 'rsa_padding_mode:oaep', '-keyopt', 'rsa_oaep_md:sha256', '-keyopt', 'rsa_mgf1_md:sha256'],
            input=plaintext, check=True, capture_output=True)
        metadata = {'version': 1, 'snapshot': snapshot, 'ciphertext': target.name, 'recipientSha256': pin,
            'signingRestoreVerified': True, 'cipherSha256': seal.checksum(target), 'plaintextBytes': len(plaintext),
            'plaintextTarSha256': hashlib.sha256(plaintext).hexdigest(), 'images': recovery.signing.IMAGES}
        target.with_suffix('.cms.json').write_text(json.dumps(metadata))
        return target, cert, key, pin, metadata

    def test_authenticated_streaming_recovery_can_be_verified_again_without_plaintext_files(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); target, cert, key, pin, metadata = self.fixture(root)
            for _ in range(2): seal.verify(target, cert, key, pin, self.openssl)
            proof = json.loads(target.with_suffix('.restore-proof.json').read_text())
            self.assertTrue(proof['authenticatedDecryption']); self.assertFalse(proof['plaintextStoredOnDisk'])
            self.assertFalse(any(path.suffix == '.tar' for path in root.iterdir()))

    def test_modified_authenticated_tag_is_rejected_even_if_outer_checksum_is_replaced(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); target, cert, key, pin, metadata = self.fixture(root)
            data = bytearray(target.read_bytes()); data[-8] ^= 1; target.write_bytes(data)
            metadata['cipherSha256'] = seal.checksum(target); target.with_suffix('.cms.json').write_text(json.dumps(metadata))
            with self.assertRaisesRegex(ValueError, 'Authenticated signing decryption failed'): seal.verify(target, cert, key, pin, self.openssl)
            self.assertFalse(target.with_suffix('.restore-proof.json').exists())

    def test_other_recipient_identity_fails_before_publishing_any_recovery_proof(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); target, cert, key, pin, metadata = self.fixture(root)
            with self.assertRaisesRegex(ValueError, 'recipient certificate identity differs'):
                seal.verify(target, cert, key, '0' * 64, self.openssl)
            self.assertFalse(target.with_suffix('.restore-proof.json').exists())

    def test_unauthenticated_cms_cbc_is_not_mistaken_for_authenticated_recovery(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); target, cert, key, pin, metadata = self.fixture(root)
            subprocess.run([self.openssl, 'cms', '-encrypt', '-binary', '-aes-256-cbc', '-outform', 'DER',
                '-out', str(target), str(cert)], input=b'Synthetic CBC archive', check=True, capture_output=True)
            metadata['cipherSha256'] = seal.checksum(target); target.with_suffix('.cms.json').write_text(json.dumps(metadata))
            with self.assertRaisesRegex(ValueError, 'Authenticated CMS envelope required'): seal.verify(target, cert, key, pin, self.openssl)
            self.assertFalse(target.with_suffix('.restore-proof.json').exists())

    def test_gateway_recovery_requires_complete_private_identity_and_all_hashes(self):
        for stage in ['complete', 'partial']:
            with self.subTest(stage=stage), tempfile.TemporaryDirectory() as temporary:
                target, cert, key, pin, metadata = self.fixture(Path(temporary), gateway=stage)
                if stage == 'complete': seal.verify(target, cert, key, pin, self.openssl)
                else:
                    with self.assertRaisesRegex(ValueError, 'Recovered signing manifest differs'): seal.verify(target, cert, key, pin, self.openssl)
                    self.assertFalse(target.with_suffix('.restore-proof.json').exists())

    def test_recipient_recovery_requires_all_files_and_actual_restore_acceptance(self):
        for stage in ['complete', 'partial', 'missing-proof']:
            with self.subTest(stage=stage), tempfile.TemporaryDirectory() as temporary:
                target, cert, key, pin, metadata = self.fixture(Path(temporary), gateway='complete', recipient=stage)
                if stage == 'complete': seal.verify(target, cert, key, pin, self.openssl)
                else:
                    with self.assertRaises(ValueError): seal.verify(target, cert, key, pin, self.openssl)
                    self.assertFalse(target.with_suffix('.restore-proof.json').exists())

    def test_callback_recovery_requires_complete_identity_trust_and_restore_proof(self):
        for stage in ['complete','partial','missing-proof']:
            with self.subTest(stage=stage),tempfile.TemporaryDirectory() as temporary:
                target,cert,key,pin,metadata=self.fixture(Path(temporary),callback=stage)
                if stage=='complete':seal.verify(target,cert,key,pin,self.openssl)
                else:
                    with self.assertRaises(ValueError):seal.verify(target,cert,key,pin,self.openssl)
                    self.assertFalse(target.with_suffix('.restore-proof.json').exists())


if __name__ == '__main__': unittest.main()
