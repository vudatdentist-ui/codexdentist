import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from contextlib import ExitStack

spec = importlib.util.spec_from_file_location('bootstrap', Path(__file__).with_name('owned-signing-bootstrap.py'))
bootstrap = importlib.util.module_from_spec(spec); spec.loader.exec_module(bootstrap)


class SigningBootstrap(unittest.TestCase):
    def credentials(self):
        return [{'purpose': purpose, 'userId': index, 'teamId': index, 'tokenId': index,
            'apiToken': 'api_' + str(index) * 16} for index, purpose in enumerate(['main', 'qa'], 3)]

    def test_separate_accounts_and_acknowledged_keys_are_required(self):
        values = self.credentials(); self.assertEqual(bootstrap.credentials(values), values)
        for key in ['purpose', 'userId', 'teamId', 'tokenId', 'apiToken']:
            changed = json.loads(json.dumps(values)); changed[1][key] = changed[0][key]
            with self.subTest(key=key), self.assertRaises(ValueError): bootstrap.credentials(changed)
        for changed in [[], values[:1], [{**values[0], 'userId': True}, values[1]],
                [None, values[1]], [{**values[0], 'apiToken': None}, values[1]],
                [{**values[0], 'apiToken': 'bad-token'}, values[1]]]:
            with self.assertRaises(ValueError): bootstrap.credentials(changed)

    def test_success_and_uncertainty_both_restore_exact_closed_config(self):
        for failure in [None, 'create', 'invalid-ack', 'inspect']:
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as temporary, ExitStack() as stack:
                root = Path(temporary); expected = {'services': {'app': {'environment': {'NEXT_PUBLIC_DISABLE_SIGNUP': 'true'}}}}
                before = json.dumps(expected).encode(); (root / 'compose.json').write_bytes(before)
                events = []
                def write(path, value, app_readable=False):
                    with path.open('xb') as output: output.write(value)
                def client(value, record=None):
                    events.append(value['action'])
                    if value['action'] == 'review': return {'seedOnly': True, 'envelopes': 0, 'teams': 2}
                    if value['action'] == 'create':
                        self.assertEqual(json.loads((root / 'compose.json').read_text())['services']['app']['environment']['NEXT_PUBLIC_DISABLE_SIGNUP'], 'false')
                        if failure == 'create': raise RuntimeError('Synthetic lost API acknowledgement')
                        return {'pass': True, 'externalMailSent': False, 'separateTeams': True,
                            'completed': [] if failure == 'invalid-ack' else self.credentials()}
                    if failure == 'inspect': raise RuntimeError('Synthetic API inspection failure')
                    return {'pass': True, 'separateTeams': True, 'signupClosed': True, 'apiAvailable': True}
                stack.enter_context(patch.object(bootstrap.signing, 'installation', return_value=expected))
                for name in ['status', 'health']: stack.enter_context(patch.object(bootstrap.signing, name))
                stack.enter_context(patch.object(bootstrap.signing, 'private', side_effect=write))
                stack.enter_context(patch.object(bootstrap, 'private_members'))
                stack.enter_context(patch.object(bootstrap, 'temporary_runtime'))
                stack.enter_context(patch.object(bootstrap, 'client', side_effect=client))
                stack.enter_context(patch.object(bootstrap.recovery, 'backup', return_value=root / 'snapshot'))
                stack.enter_context(patch.object(bootstrap.recovery, 'drill'))
                stack.enter_context(patch.object(bootstrap, 'replace', side_effect=lambda path, value: path.write_bytes(value)))
                stack.enter_context(patch.object(bootstrap, 'apply', side_effect=lambda directory: events.append('apply')))
                if failure:
                    with self.assertRaises((RuntimeError, ValueError)): bootstrap.bootstrap(root)
                    self.assertFalse((root / 'bootstrap.completed.json').exists())
                else:
                    bootstrap.bootstrap(root); self.assertTrue((root / 'bootstrap.completed.json').exists())
                self.assertEqual((root / 'compose.json').read_bytes(), before)
                self.assertTrue((root / 'bootstrap.intent.json').exists())
                self.assertEqual(events.count('apply'), 2)
                with self.assertRaises(ValueError): bootstrap.bootstrap(root)

    def test_private_client_preserves_partial_tokens_before_raising(self):
        with tempfile.TemporaryDirectory() as temporary:
            record = Path(temporary) / 'private-result.json'; partial = b'{"pass":false,"completed":[{"apiToken":"synthetic-private-ack"}]}'
            result = type('Result', (), {'returncode': 1, 'stdout': partial, 'stderr': b'private provider detail'})()
            def write(path, data):
                with path.open('xb') as output: output.write(data)
            with patch.object(bootstrap.subprocess, 'run', return_value=result), patch.object(bootstrap.signing, 'private', side_effect=write):
                with self.assertRaises(RuntimeError): bootstrap.client({'action': 'create'}, record)
            self.assertEqual(record.read_bytes(), partial)


if __name__ == '__main__': unittest.main()
