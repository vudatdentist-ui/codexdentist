import importlib.util
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from contextlib import ExitStack
from types import SimpleNamespace

spec = importlib.util.spec_from_file_location('recipient', Path(__file__).with_name('owned-signing-recipient.py'))
recipient = importlib.util.module_from_spec(spec); spec.loader.exec_module(recipient)


class RecipientBoundary(unittest.TestCase):
    def test_public_process_has_only_http_config_and_never_private_tls_or_api(self):
        config = recipient.configuration(); web = config['services']['web']
        self.assertEqual(set(config['services']), {'web'}); self.assertFalse(web.get('ports')); self.assertFalse(web.get('environment'))
        self.assertEqual(web['user'], '101:101'); self.assertTrue(web['read_only'])
        self.assertEqual(web['logging'], {'driver': 'none'}); self.assertEqual(web['cap_drop'], ['ALL'])
        self.assertEqual(web['volumes'], [{'type': 'bind', 'source': './nginx.conf', 'target': '/etc/nginx/nginx.conf', 'read_only': True}])
        text = recipient.template().decode()
        for denied in ['3443', 'ssl_certificate', '/api/v2/', 'apiToken', 'location /admin', 'location /signup']:
            self.assertNotIn(denied, text)
        self.assertIn('listen 8080;', text); self.assertIn('location / { return 404; }', text)
        self.assertIn('access_log off;', text); self.assertIn('Referrer-Policy no-referrer', text)
        self.assertEqual(config['networks']['edge']['name'], 'coolify')
        self.assertEqual(config['networks']['ceremony']['name'], 'codexdentist-owned-signing-gateway_recipient')
        self.assertNotIn('codexdentist-owned-signing_private', json.dumps(config))
        self.assertIn('http://proxy:8080', text); self.assertNotIn('http://app:3000', text)
        self.assertNotIn('coolify', recipient.gateway.configuration()['networks'])

    def test_only_dedicated_hostname_router_is_published_without_token_logging(self):
        route = recipient.router()['http']
        self.assertEqual(set(route['routers']), {'codexdentist-signing-http', 'codexdentist-signing-https'})
        for row in route['routers'].values():
            self.assertEqual(row['rule'], 'Host(`sign.codexdentist.com`)')
            self.assertEqual(row['observability'], {'accessLogs': False, 'tracing': False})
        self.assertEqual(route['services']['codexdentist-signing']['loadBalancer']['servers'], [{'url': 'http://codexdentist-signing-recipient:8080'}])

    def test_long_native_fixture_uses_short_scoped_dns_alias(self):
        provider = 'codexdentist-signing-test-' + 'a' * 32
        with patch.object(recipient, 'PROVIDER_PROJECT', provider), patch.object(recipient, 'PROJECT', provider + '-recipient'), patch.object(recipient, 'EDGE', provider + '-recipient-edge'):
            self.assertEqual(recipient.configuration()['services']['web']['networks']['edge']['aliases'], ['codexdentist-signing-recipient'])
            self.assertNotIn(provider, recipient.template().decode())
        with patch.object(recipient, 'EDGE', 'foreign-edge'):
            with self.assertRaises(ValueError): recipient.configuration()

    def test_prepare_preserves_existing_installation(self):
        with tempfile.TemporaryDirectory() as temporary, patch.object(recipient, 'ROOT', Path(temporary)), patch.object(recipient.gateway, 'run') as run:
            with self.assertRaises(ValueError): recipient.prepare()
            run.assert_not_called()

    def test_publication_requires_exact_restored_current_configuration(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); snapshot = root / 'snapshot'; snapshot.mkdir()
            names = ['recipient/' + name for name in ['compose.json', 'manifest.json', 'nginx.conf', 'router.json']]
            files = {}
            for name in names:
                value = ('Synthetic current configuration ' + name).encode()
                (root / name.removeprefix('recipient/')).write_bytes(value)
                files[name] = hashlib.sha256(value).hexdigest()
            proof = {name: True for name in ['allHashes', 'ownershipAndModes', 'applicationConfigurationUsable',
                'databaseCounts', 'cacheAuthenticationAndAof', 'certificatePassphrase', 'gatewayConfigurationUsable', 'recipientConfigurationUsable']}
            proof['appOrMailWorkersStarted'] = False
            (snapshot / 'restore-verified.json').write_text(json.dumps(proof))
            recovery = SimpleNamespace(RECIPIENT=names, validate_snapshot=lambda path: {'files': files})
            with patch.object(recipient, 'ROOT', root), patch.object(recipient, 'recovery_module', return_value=recovery):
                recipient.restored_snapshot(snapshot)
                for wrong in [{**proof, 'recipientConfigurationUsable': False}, {**proof, 'appOrMailWorkersStarted': True}, {**proof, 'databaseCounts': False}]:
                    (snapshot / 'restore-verified.json').write_text(json.dumps(wrong))
                    with self.assertRaises(ValueError): recipient.restored_snapshot(snapshot)
                (snapshot / 'restore-verified.json').write_text(json.dumps(proof))
                (root / 'nginx.conf').write_bytes(b'foreign current configuration')
                with self.assertRaises(ValueError): recipient.restored_snapshot(snapshot)

    def test_publication_rolls_back_only_its_exact_route_and_manifest(self):
        for failure in [None, 'probe', 'status', 'concurrent']:
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as temporary, ExitStack() as stack:
                root = Path(temporary); route = root / 'dynamic/signing.yaml'; route.parent.mkdir()
                original = json.dumps({'published': False}).encode(); (root / 'manifest.json').write_bytes(original)
                proposed = json.dumps(recipient.router()).encode(); (root / 'router.json').write_bytes(proposed)
                stack.enter_context(patch.object(recipient, 'ROOT', root)); stack.enter_context(patch.object(recipient, 'ROUTE', route))
                stack.enter_context(patch.object(recipient, 'installation', return_value={'published': False}))
                stack.enter_context(patch.object(recipient, 'restored_snapshot'))
                def write(path, value, uid=0):
                    with path.open('xb') as output: output.write(value)
                stack.enter_context(patch.object(recipient.gateway, 'private', side_effect=write))
                stack.enter_context(patch.object(recipient.gateway, 'replace', side_effect=lambda path,value: path.write_bytes(value)))
                calls = []
                def status():
                    calls.append('status')
                    if failure == 'status' and calls.count('status') == 2: raise ValueError('Synthetic status failure')
                def probe(public=False):
                    if public and failure in ['probe', 'concurrent']:
                        if failure == 'concurrent': route.write_bytes(b'foreign operator route')
                        raise ValueError('Synthetic public probe failure')
                stack.enter_context(patch.object(recipient, 'status', side_effect=status))
                stack.enter_context(patch.object(recipient, 'probe', side_effect=probe))
                if failure:
                    with self.assertRaises(ValueError): recipient.publish(root / 'snapshot')
                    if failure == 'concurrent': self.assertEqual(route.read_bytes(), b'foreign operator route')
                    else:
                        self.assertFalse(route.exists()); self.assertEqual((root / 'manifest.json').read_bytes(), original)
                    self.assertFalse((root / 'publication.accepted.json').exists())
                else:
                    recipient.publish(root / 'snapshot'); self.assertEqual(route.read_bytes(), proposed)
                    self.assertTrue(json.loads((root / 'manifest.json').read_text())['published'])
                self.assertTrue((root / 'publication.intent.json').exists())


if __name__ == '__main__': unittest.main()
