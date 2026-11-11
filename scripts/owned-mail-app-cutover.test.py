import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('cutover', Path(__file__).with_name('owned-mail-app-cutover.py'))
cutover = importlib.util.module_from_spec(spec); spec.loader.exec_module(cutover)
spec = importlib.util.spec_from_file_location('trust', Path(__file__).with_name('runtime-public-ca.py'))
trust = importlib.util.module_from_spec(spec); spec.loader.exec_module(trust)


class AppMailCutover(unittest.TestCase):
    def test_verifier_forwards_only_the_exact_readonly_public_ca(self):
        plain = {'Config': {'Env': []}, 'Mounts': []}
        self.assertEqual(trust.public_ca_arguments(plain), [])
        current = {'Config': {'Env': ['NODE_EXTRA_CA_CERTS=' + trust.TARGET]},
            'Mounts': [{'Type': 'bind', 'Source': trust.SOURCE, 'Destination': trust.TARGET, 'RW': False}]}
        self.assertEqual(trust.public_ca_arguments(current), ['--mount',
            'type=bind,source=' + trust.SOURCE + ',target=' + trust.TARGET + ',readonly'])
        for kind in ['foreign-env', 'private-key', 'writable', 'volume', 'missing']:
            changed = json.loads(json.dumps(current))
            if kind == 'foreign-env': changed['Config']['Env'] = ['NODE_EXTRA_CA_CERTS=/secrets/private.key']
            if kind == 'private-key': changed['Mounts'][0]['Source'] = '/opt/codexdentist-owned-mail/secrets/gateway.key.pem'
            if kind == 'writable': changed['Mounts'][0]['RW'] = True
            if kind == 'volume': changed['Mounts'][0]['Type'] = 'volume'
            if kind == 'missing': changed['Mounts'] = []
            with self.subTest(kind=kind), self.assertRaises(ValueError): trust.public_ca_arguments(changed)

    def test_verifier_accepts_only_reviewed_readonly_combined_mail_and_signing_ca(self):
        current = {'Config': {'Env': ['NODE_EXTRA_CA_CERTS=' + trust.SERVICE_TARGET]},
            'Mounts': [{'Type': 'bind', 'Source': trust.SERVICE_SOURCE, 'Destination': trust.SERVICE_TARGET, 'RW': False}]}
        self.assertEqual(trust.public_ca_arguments(current), ['--mount',
            'type=bind,source=' + trust.SERVICE_SOURCE + ',target=' + trust.SERVICE_TARGET + ',readonly'])
        for update in [{'Source': trust.SOURCE}, {'Source': '/opt/codexdentist-owned-signing-gateway/gateway.key.pem'},
                {'RW': True}, {'Type': 'volume'}]:
            changed = json.loads(json.dumps(current)); changed['Mounts'][0].update(update)
            with self.assertRaises(ValueError): trust.public_ca_arguments(changed)

    def test_compose_patch_preserves_other_apps_and_durable_volume(self):
        original = '''services:
  other:
    image: unrelated:preserved
  codexdentist:
    image: codexdentist:existing
    env_file:
      - ./env/codexdentist.env
    networks:
      - data
      - egress
    volumes:
      - type: volume
        source: patient_files
        target: /data/patient-files
        volume:
          nocopy: true
  after:
    image: other:preserved
networks:
  data:
    internal: true
  egress:
    internal: false
'''
        proposed = cutover.compose_text(original)
        added = ('      - type: bind\n        source: ' + str(cutover.CA_SOURCE) + '\n        target: ' + cutover.CA_TARGET + '\n        read_only: true\n')
        removed = proposed.replace(added, '').replace('      - ' + cutover.NETWORK_KEY + '\n', '').replace(
            '  ' + cutover.NETWORK_KEY + ':\n    external: true\n    name: ' + cutover.NETWORK + '\n', '')
        self.assertEqual(removed, original)
        # Both valid YAML sequence styles exist on the owned host.
        compact = original.replace('      - ', '    - ').replace('        source:', '      source:').replace('        target:', '      target:').replace('        volume:', '      volume:').replace('          nocopy:', '        nocopy:')
        self.assertIn('    - ' + cutover.NETWORK_KEY + '\n', cutover.compose_text(compact))
        with self.assertRaises(ValueError): cutover.compose_text(proposed)
        for changed in [original.replace('  codexdentist:', '  renamed:'), original.replace('    volumes:', '    other_mounts:'), original.replace('    networks:', '    other_networks:')]:
            with self.assertRaises(ValueError): cutover.compose_text(changed)

    def test_dotenv_updates_preserve_all_unrelated_quoted_secrets(self):
        original = 'AUTH_SECRET="synthetic-$literal=secret"\nRESEND_API_KEY=old-preserved\nNOTIFICATION_DELIVERY_MODE=resend\n'
        changed = cutover.environment_text(original, {'NOTIFICATION_DELIVERY_MODE': 'owned-mail', 'OWNED_MAIL_SIGNING_SECRET': 'a' * 64})
        self.assertIn('AUTH_SECRET="synthetic-$literal=secret"\n', changed); self.assertIn('RESEND_API_KEY=old-preserved\n', changed)
        self.assertEqual(changed.count('NOTIFICATION_DELIVERY_MODE='), 1)
        with self.assertRaises(ValueError): cutover.environment_text(original + ' export NOTIFICATION_DELIVERY_MODE=resend\n', {'NOTIFICATION_DELIVERY_MODE': 'owned-mail'})
        for value in ['unsafe\nnew=key', 'dotenv${interpolation}', '"quoted"']:
            with self.assertRaises(ValueError): cutover.environment_text(original, {'OWNED_MAIL_SIGNING_SECRET': value})

    def test_resolved_configuration_rejects_any_unrelated_mutation(self):
        before = {'services': {'codexdentist': {'environment': {'AUTH_SECRET': 'preserved'}, 'networks': {'data': None}, 'volumes': []},
            'other': {'image': 'unchanged'}}, 'networks': {'data': {'internal': True}}}
        updates = {'NOTIFICATION_DELIVERY_MODE': 'owned-mail'}
        after = json.loads(json.dumps(before)); service = after['services']['codexdentist']
        service['environment'].update(updates); service['networks'][cutover.NETWORK_KEY] = None
        service['volumes'].append({'type': 'bind', 'source': str(cutover.CA_SOURCE), 'target': cutover.CA_TARGET,
            'read_only': True})
        after['networks'][cutover.NETWORK_KEY] = {'name': cutover.NETWORK, 'ipam': {}, 'external': True}
        cutover.equivalent_config(before, after, updates)
        for mode in ['secret', 'other-app', 'writable-ca', 'external-egress']:
            changed = json.loads(json.dumps(after))
            if mode == 'secret': changed['services']['codexdentist']['environment']['AUTH_SECRET'] = 'changed'
            if mode == 'other-app': changed['services']['other']['image'] = 'changed'
            if mode == 'writable-ca': changed['services']['codexdentist']['volumes'][0]['read_only'] = False
            if mode == 'external-egress': changed['networks'][cutover.NETWORK_KEY]['name'] = 'foreign'
            with self.subTest(mode=mode), self.assertRaises(ValueError): cutover.equivalent_config(before, changed, updates)

    def test_runtime_validation_rejects_secret_image_mount_or_network_changes(self):
        before = {'Image': 'sha256:reviewed', 'Config': {'Env': ['AUTH_SECRET=preserved', 'NOTIFICATION_DELIVERY_MODE=resend']},
            'Mounts': [{'Destination': '/data/patient-files', 'Source': 'preserved-volume', 'Type': 'volume', 'RW': True}],
            'NetworkSettings': {'Networks': {'data': {}}}}
        after = json.loads(json.dumps(before)); updates = {'NOTIFICATION_DELIVERY_MODE': 'owned-mail'}
        after['Config']['Env'] = ['AUTH_SECRET=preserved', 'NOTIFICATION_DELIVERY_MODE=owned-mail']
        after['Mounts'].append({'Destination': cutover.CA_TARGET, 'Source': str(cutover.CA_SOURCE), 'Type': 'bind', 'RW': False})
        after['NetworkSettings']['Networks'][cutover.NETWORK] = {}
        cutover.validate_runtime(before, after, updates)
        for kind in ['image', 'secret', 'new-env', 'data', 'foreign-network', 'writable-ca']:
            changed = json.loads(json.dumps(after))
            if kind == 'image': changed['Image'] = 'sha256:foreign'
            if kind == 'secret': changed['Config']['Env'][0] = 'AUTH_SECRET=replaced'
            if kind == 'new-env': changed['Config']['Env'].append('UNEXPECTED=value')
            if kind == 'data': changed['Mounts'][0]['Source'] = 'wrong-volume'
            if kind == 'foreign-network': changed['NetworkSettings']['Networks']['foreign'] = {}
            if kind == 'writable-ca': changed['Mounts'][1]['RW'] = True
            with self.subTest(kind=kind), self.assertRaises(ValueError): cutover.validate_runtime(before, changed, updates)

    def test_rollback_restores_only_its_own_configuration_and_retains_attention_evidence(self):
        for foreign in [None, 'compose', 'environment']:
            with self.subTest(foreign=foreign), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary); compose = root / 'compose.yml'; environment = root / 'app.env'; marker = root / 'needs-attention.json'
                compose.write_bytes(b'new-compose'); environment.write_bytes(b'new-environment'); marker.write_text('retained operation')
                if foreign == 'compose': compose.write_bytes(b'concurrent-compose')
                if foreign == 'environment': environment.write_bytes(b'concurrent-environment')
                before = (compose.read_bytes(), environment.read_bytes())
                with patch.object(cutover, 'COMPOSE', compose), patch.object(cutover, 'replace', side_effect=lambda path, value: path.write_bytes(value)), \
                        patch.object(cutover, 'recreate') as recreate, patch.object(cutover, 'wait') as wait:
                    if foreign:
                        with self.assertRaises(ValueError): cutover.restore_if_owned(environment, b'old-env', b'new-environment', b'old-compose', b'new-compose', 'synthetic-secret')
                        self.assertEqual((compose.read_bytes(), environment.read_bytes()), before); recreate.assert_not_called()
                    else:
                        cutover.restore_if_owned(environment, b'old-env', b'new-environment', b'old-compose', b'new-compose', 'synthetic-secret')
                        self.assertEqual((compose.read_bytes(), environment.read_bytes()), (b'old-compose', b'old-env')); recreate.assert_called_once(); wait.assert_called_once_with('synthetic-secret', 'resend')
                    self.assertEqual(marker.read_text(), 'retained operation')


if __name__ == '__main__': unittest.main()
