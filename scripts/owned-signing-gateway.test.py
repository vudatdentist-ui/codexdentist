import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from contextlib import ExitStack
import json
import hashlib

spec = importlib.util.spec_from_file_location('gateway', Path(__file__).with_name('owned-signing-gateway.py'))
gateway = importlib.util.module_from_spec(spec); spec.loader.exec_module(gateway)
spec = importlib.util.spec_from_file_location('gateway_recovery', Path(__file__).with_name('owned-signing-backup.py'))
recovery = importlib.util.module_from_spec(spec); spec.loader.exec_module(recovery)


class SigningGateway(unittest.TestCase):
    def test_internal_gateway_has_no_ports_egress_worker_state_or_core_secrets(self):
        config = gateway.configuration(); self.assertEqual(set(config['services']), {'proxy'})
        service = config['services']['proxy']; self.assertFalse(service.get('ports')); self.assertFalse(service.get('environment'))
        self.assertEqual(service['user'], '101:101'); self.assertTrue(service['read_only'])
        self.assertEqual(service['cap_drop'], ['ALL']); self.assertEqual(service['logging'], {'driver': 'none'})
        self.assertTrue(config['networks']['api']['internal']); self.assertTrue(config['networks']['recipient']['internal'])
        self.assertEqual(config['networks']['provider'], {'external': True, 'name': 'codexdentist-owned-signing_private'})
        self.assertRegex(service['image'], r'^ghcr.io/nginx/nginx-unprivileged@sha256:[a-f0-9]{64}$')
        for mount in service['volumes']:
            self.assertTrue(mount['read_only']); self.assertEqual(mount['type'], 'bind')
        self.assertFalse(config.get('volumes'))

    def test_recipient_gateway_has_no_admin_signup_bulk_api_or_api_token_routes(self):
        text = gateway.TEMPLATE.read_text(); private, public = text.split('  # Recipient web ceremony only.', 1)
        self.assertIn('listen 3443 ssl;', private); self.assertIn('ssl_protocols TLSv1.2 TLSv1.3;', private)
        self.assertIn('location /api/v2/', private); self.assertNotIn('location /api/v2/', public)
        self.assertIn('location / { return 404; }', public)
        self.assertNotIn('apiToken', public); self.assertNotIn('location /api/auth', public)
        self.assertIn('recipient\\.completeDocumentWithToken', public); self.assertIn('envelope\\.field\\.sign', public)
        self.assertIn('access_log off;', text); self.assertIn('error_log /dev/null crit;', text)
        self.assertIn('Referrer-Policy no-referrer', text); self.assertNotIn('$http_authorization', text)

    def test_prepare_never_replaces_existing_keys_or_runtime(self):
        with tempfile.TemporaryDirectory() as temporary, patch.object(gateway, 'ROOT', Path(temporary)), patch.object(gateway, 'run') as run:
            with self.assertRaises(ValueError): gateway.prepare()
            run.assert_not_called()

    def test_runtime_and_recovery_share_the_exact_gateway_identity_and_private_ownership(self):
        self.assertEqual(gateway.IMAGE, recovery.GATEWAY_IMAGE)
        self.assertEqual(set(recovery.GATEWAY), {'gateway/' + name for name in
            ['compose.json', 'manifest.json', 'nginx.conf', 'gateway.key.pem', 'gateway.cert.pem']})
        for name in recovery.GATEWAY:
            self.assertEqual(recovery.config_owner(name), 0 if name.endswith(('compose.json', 'manifest.json')) else 101)

    def test_long_fixture_project_names_never_become_upstream_dns_labels(self):
        project = 'codexdentist-signing-test-' + 'a' * 32
        self.assertGreater(len(project + '-app-1'), 63)
        with patch.object(gateway, 'PROVIDER_PROJECT', project):
            config = gateway.template().decode()
            self.assertEqual(config.count('http://app:3000'), 2)
            self.assertNotIn(project + '-app-1', config)
            self.assertEqual(gateway.configuration()['networks']['provider']['name'], project + '_private')

    def test_private_dns_upgrade_preserves_originals_and_refuses_concurrent_rewrites(self):
        desired = gateway.template(); before = desired.replace(b'http://app:3000', b'http://codexdentist-owned-signing-app-1:3000')
        for failure in [None, 'recreate', 'status', 'probe', 'concurrent']:
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as temporary, ExitStack() as stack:
                root = Path(temporary); (root / 'nginx.conf').write_bytes(before)
                original_manifest = json.dumps({'configSha256': hashlib.sha256(before).hexdigest()}).encode()
                (root / 'manifest.json').write_bytes(original_manifest); (root / 'gateway.key.pem').write_bytes(b'preserved synthetic identity')
                events = []
                def step(name):
                    def action(*args):
                        events.append(name)
                        if failure == 'concurrent' and name == 'probe':
                            (root / 'nginx.conf').write_bytes(b'concurrent configuration'); raise RuntimeError('Synthetic concurrent change')
                        if failure == name and events.count(name) == 1: raise RuntimeError('Synthetic ' + name)
                    return action
                def write(path, value, uid=0):
                    with path.open('xb') as output: output.write(value)
                stack.enter_context(patch.object(gateway, 'ROOT', root)); stack.enter_context(patch.object(gateway, 'installation'))
                stack.enter_context(patch.object(gateway, 'private', side_effect=write))
                stack.enter_context(patch.object(gateway, 'replace', side_effect=lambda path, value, uid=0: path.write_bytes(value)))
                for name in ['recreate', 'status', 'probe']: stack.enter_context(patch.object(gateway, name, side_effect=step(name)))
                if failure:
                    with self.assertRaises((RuntimeError, ValueError)): gateway.upgrade_private()
                    if failure == 'concurrent': self.assertEqual((root / 'nginx.conf').read_bytes(), b'concurrent configuration')
                    else:
                        self.assertEqual((root / 'nginx.conf').read_bytes(), before)
                        self.assertEqual((root / 'manifest.json').read_bytes(), original_manifest)
                    self.assertFalse((root / 'dns-config-upgrade-accepted.json').exists())
                else:
                    gateway.upgrade_private(); self.assertEqual((root / 'nginx.conf').read_bytes(), desired)
                    self.assertTrue((root / 'dns-config-upgrade-accepted.json').exists())
                self.assertEqual((root / 'gateway.key.pem').read_bytes(), b'preserved synthetic identity')
                self.assertEqual((root / 'dns-config-upgrade-before/nginx.conf').read_bytes(), before)
                self.assertEqual((root / 'dns-config-upgrade-before/manifest.json').read_bytes(), original_manifest)


if __name__ == '__main__': unittest.main()
