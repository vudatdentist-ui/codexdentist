import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('gateway', Path(__file__).with_name('owned-signing-gateway.py'))
gateway = importlib.util.module_from_spec(spec); spec.loader.exec_module(gateway)


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


if __name__ == '__main__': unittest.main()
