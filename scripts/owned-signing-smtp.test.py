import importlib.util
import json
from contextlib import ExitStack
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('smtp', Path(__file__).with_name('owned-signing-smtp.py'))
smtp = importlib.util.module_from_spec(spec); spec.loader.exec_module(smtp)


class MainOnlySigningSmtp(unittest.TestCase):
    def test_smtp_network_rejects_external_or_foreign_members(self):
        for mutation in [None, 'external', 'foreign']:
            network = {'Internal': mutation != 'external', 'Containers': {'mail-gateway': {}, 'mail-smtp': {}, 'app': {}}}
            if mutation == 'foreign': network['Containers']['foreign'] = {}
            def run(args):
                if args[1] == 'network': return json.dumps([network]).encode()
                return json.dumps([{'Id': {'codexdentist-owned-mail-gateway-1': 'mail-gateway',
                    'codexdentist-owned-mail-smtp-1': 'mail-smtp', smtp.signing.PROJECT + '-app-1': 'app'}[args[-1]]}]).encode()
            with patch.object(smtp.signing, 'run', side_effect=run):
                if mutation:
                    with self.assertRaises(ValueError): smtp.smtp_network(True)
                else: smtp.smtp_network(True)

    def test_smtp_stage_adds_only_app_internal_network_and_public_trust_while_global_mail_stays_capture(self):
        keys = {name: format(index, '064x') for index, name in enumerate(['database', 'cache', 'auth', 'encryption', 'secondary', 'certificate'], 1)}
        before = smtp.signing.configuration(keys, True); after = smtp.signing.configuration(keys, True, True)
        for name in ['database', 'cache', 'capture']: self.assertEqual(before['services'][name], after['services'][name])
        self.assertEqual(after['networks']['smtp'], {'external': True, 'name': smtp.signing.SMTP_NETWORK})
        app = after['services']['app']; env = app['environment']
        self.assertEqual(env['NEXT_PRIVATE_SMTP_HOST'], 'capture'); self.assertEqual(env['NEXT_PRIVATE_SMTP_PORT'], '1025')
        self.assertEqual(env['NODE_EXTRA_CA_CERTS'], '/secrets/provider-trust.cert.pem')
        self.assertEqual(app['networks'], ['private', 'smtp']); self.assertFalse(app.get('ports'))
        for mount in app['volumes'][-2:]:
            self.assertTrue(mount['read_only']); self.assertTrue(mount['source'].endswith('trust.cert.pem'))
        for callback, enabled in [(False, True), (True, 'true')]:
            with self.assertRaises(ValueError): smtp.signing.configuration(keys, callback, enabled)

    def test_admin_success_and_lost_ack_restore_closed_signup_and_reject_replay(self):
        for lost_ack in [False, True]:
            with self.subTest(lost_ack=lost_ack), tempfile.TemporaryDirectory() as temporary, ExitStack() as stack:
                root = Path(temporary)
                expected = {'services': {'app': {'environment': {'NEXT_PUBLIC_DISABLE_SIGNUP': 'true', 'NODE_EXTRA_CA_CERTS': '/secrets/callback-trust.cert.pem'}}}}
                before = json.dumps(expected).encode(); (root / 'compose.json').write_bytes(before)
                calls = []
                def private(path, value, app_readable=False):
                    with path.open('xb') as output: output.write(value)
                def client(value, record=None):
                    calls.append(value['action'])
                    if value['action'] == 'review': return {'pass': True, 'dedicatedAdminAbsent': True}
                    if value['action'] == 'create-admin':
                        self.assertEqual(json.loads((root / 'compose.json').read_text())['services']['app']['environment']['NEXT_PUBLIC_DISABLE_SIGNUP'], 'false')
                        if lost_ack: raise ValueError('Synthetic lost API response')
                    return {'pass': True, 'adminId': 5, 'ordinaryPrincipalsPreserved': True, 'globalAndQaMailCaptured': True, 'externalMailSent': False}
                for target, name, value in [(smtp.signing, 'ROOT', root), (smtp.signing, 'installation', None), (smtp.signing, 'status', None),
                        (smtp.signing, 'health', None), (smtp, 'members', None), (smtp, 'wait_ready', None), (smtp, 'recreate', None),
                        (smtp, 'principals', None), (smtp.recovery, 'backup', None), (smtp.recovery, 'drill', None)]:
                    if name == 'ROOT': stack.enter_context(patch.object(target, name, value))
                    else: stack.enter_context(patch.object(target, name, return_value=expected if name == 'installation' else root / 'snapshot' if name == 'backup' else [] if name == 'principals' else None))
                stack.enter_context(patch.object(smtp.signing, 'private', side_effect=private))
                stack.enter_context(patch.object(smtp.bootstrap, 'replace', side_effect=lambda path, value: path.write_bytes(value)))
                stack.enter_context(patch.object(smtp, 'client', side_effect=client))
                if lost_ack:
                    with self.assertRaises(ValueError): smtp.prepare_admin()
                else: smtp.prepare_admin()
                self.assertEqual((root / 'compose.json').read_bytes(), before)
                self.assertEqual((root / 'smtp-admin.completed.json').exists(), not lost_ack)
                with self.assertRaises(FileExistsError): smtp.prepare_admin()
                self.assertEqual(calls.count('create-admin'), 1)

    def test_partial_provider_mutation_ack_is_preserved_before_failure(self):
        with tempfile.TemporaryDirectory() as temporary:
            record = Path(temporary) / 'result.json'
            partial = b'{"pass":false,"step":"bind-main-transport","transportId":"email_transport_synthetic"}'
            result = type('Result', (), {'returncode': 1, 'stdout': partial, 'stderr': b'private upstream error'})()
            def private(path, data):
                with path.open('xb') as output: output.write(data)
            with patch.object(smtp.subprocess, 'run', return_value=result), patch.object(smtp.signing, 'private', side_effect=private):
                with self.assertRaises(ValueError): smtp.client({}, record)
            self.assertEqual(record.read_bytes(), partial)


if __name__ == '__main__': unittest.main()
