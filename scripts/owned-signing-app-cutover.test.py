import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('cutover', Path(__file__).with_name('owned-signing-app-cutover.py'))
cutover = importlib.util.module_from_spec(spec); spec.loader.exec_module(cutover)


class PrivateSigningAttachment(unittest.TestCase):
    def test_attention_or_existing_core_connections_block_before_provider_reads_or_configuration_writes(self):
        for stage in ['attention', 'existing-connection']:
            with tempfile.TemporaryDirectory() as directory:
                root = Path(directory); sha = 'a' * 40
                (root / 'current.json').write_text(json.dumps({'sha': sha}))
                if stage == 'attention': (root / 'needs-attention.json').write_text('preserve-foreign-operation')
                before = {'Config': {'Labels': {'org.opencontainers.image.revision': sha}, 'Env': [
                    'NOTIFICATION_DELIVERY_MODE=owned-mail', 'NODE_EXTRA_CA_CERTS=' + cutover.trust.TARGET]}}
                calls = []
                def run(args):
                    calls.append(args)
                    if args[:2] == ['docker', 'inspect']: return json.dumps([before]).encode()
                    raise ValueError('Synthetic existing signing connection')
                with patch.object(cutover, 'ROOT', root), patch.object(cutover.mail, 'run', side_effect=run), patch.object(cutover.smtp.signing, 'status') as provider:
                    with self.assertRaises(ValueError): cutover.cutover(sha, True)
                    provider.assert_not_called()
                    self.assertEqual(len(calls), 0 if stage == 'attention' else 2)
                if stage == 'attention': self.assertEqual((root / 'needs-attention.json').read_text(), 'preserve-foreign-operation')

    def test_compose_patch_converts_existing_sequence_without_changing_other_services_or_mounts(self):
        before = '''services:
  other:
    image: unrelated:preserved
  codexdentist:
    image: codexdentist:existing
    networks:
    - data
    - egress
    - owned_mail_gateway
    volumes:
    - type: volume
      source: patient_files
      target: /data/patient-files
    - type: bind
      source: /opt/codexdentist-owned-mail/core-trust/gateway.cert.pem
      target: /run/codexdentist-mail-ca.pem
      read_only: true
  after:
    image: other:preserved
networks:
  data:
    internal: true
  egress:
    internal: false
'''
        after = cutover.compose_text(before)
        self.assertIn('      data: null\n      egress: null\n      owned_mail_gateway: null\n', after)
        self.assertIn('          - codexdentist-signing-core\n', after)
        self.assertIn('      source: patient_files\n', after)
        self.assertIn('  other:\n    image: unrelated:preserved\n', after)
        self.assertIn('  after:\n    image: other:preserved\n', after)
        self.assertEqual(after.count('target: /run/codexdentist-mail-ca.pem'), 1)
        for changed in [after, before.replace('    - data\n', '      data:\n        aliases: [foreign]\n'), before.replace('networks:\n  data:', 'different:\n  data:')]:
            with self.assertRaises(ValueError): cutover.compose_text(changed)

    def fixture(self):
        before = {'services': {'codexdentist': {'image': 'sha256:preserved', 'environment': {'AUTH_SECRET': 'preserved'},
            'networks': {'data': None}, 'volumes': [{'type': 'volume', 'source': 'preserved', 'target': '/data/patient-files'}]},
            'other': {'image': 'unrelated'}}, 'networks': {'data': {'internal': True}}}
        after = json.loads(json.dumps(before)); core = after['services']['codexdentist']; core['environment'].update(cutover.UPDATES)
        for key, name in cutover.NETWORKS.items():
            after['networks'][key] = {'external': True, 'name': name, 'ipam': {}}
            core['networks'][key] = {'aliases': [cutover.ALIAS]} if 'callback' in key else None
        core['volumes'].append({'type': 'bind', 'source': cutover.trust.SERVICE_SOURCE, 'target': cutover.trust.SERVICE_TARGET, 'read_only': True})
        return before, after

    def test_resolved_compose_requires_exact_signing_delta_and_preserves_all_data_secrets_and_other_apps(self):
        before, after = self.fixture(); cutover.equivalent_config(before, after)
        for mutation in ['image', 'secret', 'other-app', 'mount', 'alias', 'external-network']:
            changed = json.loads(json.dumps(after)); core = changed['services']['codexdentist']
            if mutation == 'image': core['image'] = 'different'
            if mutation == 'secret': core['environment']['AUTH_SECRET'] = 'changed'
            if mutation == 'other-app': changed['services']['other']['image'] = 'changed'
            if mutation == 'mount': core['volumes'][0]['source'] = 'different'
            if mutation == 'alias': core['networks']['owned_signing_callback_core']['aliases'] = ['foreign']
            if mutation == 'external-network': changed['networks']['owned_signing_api']['name'] = 'foreign'
            with self.subTest(mutation=mutation), self.assertRaises(ValueError): cutover.equivalent_config(before, changed)

    def test_duplicate_qa_core_alias_is_denied_even_when_the_container_is_stopped(self):
        for alias in [cutover.ALIAS, 'retired-synthetic-core']:
            def run(args):
                if args[1] == 'network': return json.dumps([{'Internal': True, 'Containers': {'synthetic': {}}}]).encode()
                return json.dumps([{'State': {'Running': False}, 'NetworkSettings': {'Networks': {
                    cutover.NETWORKS['owned_signing_callback_core']: {'Aliases': [alias]}}}}]).encode()
            with patch.object(cutover.mail, 'run', side_effect=run):
                if alias == cutover.ALIAS:
                    with self.assertRaises(ValueError): cutover.callback_alias_available()
                else: cutover.callback_alias_available()

    def test_live_runtime_requires_same_image_environment_storage_and_exact_callback_alias(self):
        before = {'Image': 'sha256:preserved', 'Config': {'Env': ['AUTH_SECRET=preserved', 'NODE_EXTRA_CA_CERTS=' + cutover.trust.TARGET]},
            'Mounts': [{'Destination': '/data/patient-files', 'Type': 'volume', 'Source': 'patient-files', 'RW': True}],
            'NetworkSettings': {'Networks': {'data': {}}}}
        after = json.loads(json.dumps(before))
        after['Config']['Env'] = ['AUTH_SECRET=preserved'] + [key + '=' + value for key, value in cutover.UPDATES.items()]
        for key, name in cutover.NETWORKS.items(): after['NetworkSettings']['Networks'][name] = {'Aliases': [cutover.ALIAS] if 'callback' in key else []}
        after['Mounts'].append({'Destination': cutover.trust.SERVICE_TARGET, 'Source': cutover.trust.SERVICE_SOURCE, 'Type': 'bind', 'RW': False})
        cutover.validate_runtime(before, after)
        for mutation in ['image', 'environment', 'storage', 'alias', 'writable-ca', 'foreign-network']:
            changed = json.loads(json.dumps(after))
            if mutation == 'image': changed['Image'] = 'sha256:foreign'
            if mutation == 'environment': changed['Config']['Env'][0] = 'AUTH_SECRET=changed'
            if mutation == 'storage': changed['Mounts'][0]['Source'] = 'changed'
            if mutation == 'alias': changed['NetworkSettings']['Networks'][cutover.NETWORKS['owned_signing_callback_core']]['Aliases'] = []
            if mutation == 'writable-ca': changed['Mounts'][1]['RW'] = True
            if mutation == 'foreign-network': changed['NetworkSettings']['Networks']['foreign'] = {}
            with self.subTest(mutation=mutation), self.assertRaises(ValueError): cutover.validate_runtime(before, changed)


if __name__ == '__main__': unittest.main()
