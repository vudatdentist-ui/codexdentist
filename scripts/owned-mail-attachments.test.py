import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('attachments', Path(__file__).with_name('owned-mail-attachments.py'))
attachments = importlib.util.module_from_spec(spec); spec.loader.exec_module(attachments)


class BoundedSignedPdfMail(unittest.TestCase):
    def test_mail_recovery_preserves_active_attachment_acknowledgements_and_rejects_partial_or_rolled_back_state(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); revision = 'b' * 40; pin = {'configRevision': revision}
            self.assertEqual(attachments.backup.attachment_records(root, {}), [])
            with self.assertRaises(ValueError): attachments.backup.attachment_records(root, pin)
            state = root / ('attachment-upgrade-' + revision[:12]); state.mkdir()
            for name in ['intent.json', 'maddy.before.conf', 'manifest.before.json']:
                (state / name).write_text('preserved private fixture')
            with self.assertRaises(ValueError): attachments.backup.attachment_records(root, pin)
            (state / 'accepted.json').write_text(json.dumps({'pass': True, 'actualSmtpSizeAndDenialVerified': True}))
            records = attachments.backup.attachment_records(root, pin)
            self.assertEqual(len(records), 4); self.assertIn(state.name + '/accepted.json', records)
            (state / 'runtime.before.json').write_text('{}'); self.assertEqual(len(attachments.backup.attachment_records(root, pin)), 5)
            (state / 'rolled-back.json').write_text('{}')
            with self.assertRaises(ValueError): attachments.backup.attachment_records(root, pin)
            with self.assertRaises(ValueError): attachments.backup.attachment_records(root, {'configRevision': '../foreign'})

    def test_signing_activation_requires_complete_attachment_acceptance_and_actual_smtp_probe(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); revision = 'a' * 40
            (root / 'manifest.json').write_text(json.dumps({'configRevision': revision}))
            state = root / ('attachment-upgrade-' + revision[:12]); state.mkdir(); record = state / 'accepted.json'
            keys = ['pass', 'sameImagesAndPrivateMounts', 'gatewayRequestLimitUnchanged', 'privateDiskBuffering', 'actualSmtpSizeAndDenialVerified', 'noMessageSent']
            with patch.object(attachments.mail, 'ROOT', root), patch.object(attachments.activation, 'validate_stage'), patch.object(attachments, 'probe_limit') as probe:
                with self.assertRaises(ValueError): attachments.require_accepted()
                for key in keys:
                    record.write_text(json.dumps({name: name != key for name in keys}))
                    with self.assertRaises(ValueError): attachments.require_accepted()
                probe.assert_not_called()
                record.write_text(json.dumps(dict.fromkeys(keys, True))); attachments.require_accepted(); probe.assert_called_once()

    def test_recreated_container_may_only_change_generated_hostname_and_network_endpoint_values(self):
        before = {'Id': 'old-container', 'Name': '/' + attachments.mail.PROJECT + '-smtp-1', 'Image': 'same-image', 'Config': {'Hostname': 'old-id', 'Env': ['preserved=secret'], 'User': '1000:1000', 'Labels': {
            'com.docker.compose.project': attachments.mail.PROJECT, 'com.docker.compose.service': 'smtp', 'com.docker.compose.container-number': '1', 'com.docker.compose.replace': 'older-container'}},
            'HostConfig': {'ReadonlyRootfs': True, 'Mounts': ['private-preserved'], 'PortBindings': {}},
            'NetworkSettings': {'Networks': {'private': {'EndpointID': 'old'}, 'outbound': {}}}}
        after = json.loads(json.dumps(before)); after['Config']['Hostname'] = 'new-id'; after['Config']['Labels']['com.docker.compose.replace'] = before['Id']; after['NetworkSettings']['Networks']['private']['EndpointID'] = 'new'
        attachments.same_runtime(before, after)
        after['Config']['Labels']['com.docker.compose.replace'] = 'smtp-1'; attachments.same_runtime(before, after)
        for mutation in ['image', 'env', 'mount', 'public-port', 'network', 'foreign-replacement', 'project', 'service', 'number', 'name']:
            changed = json.loads(json.dumps(after))
            if mutation == 'image': changed['Image'] = 'changed'
            if mutation == 'env': changed['Config']['Env'] = ['changed=secret']
            if mutation == 'mount': changed['HostConfig']['Mounts'] = ['different']
            if mutation == 'public-port': changed['HostConfig']['PortBindings'] = {'2465/tcp': [{}]}
            if mutation == 'network': changed['NetworkSettings']['Networks']['foreign'] = {}
            if mutation == 'foreign-replacement': changed['Config']['Labels']['com.docker.compose.replace'] = 'foreign'
            if mutation == 'project': changed['Config']['Labels']['com.docker.compose.project'] = 'foreign'
            if mutation == 'service': changed['Config']['Labels']['com.docker.compose.service'] = 'gateway'
            if mutation == 'number': changed['Config']['Labels']['com.docker.compose.container-number'] = '2'
            if mutation == 'name': changed['Name'] = '/foreign-smtp-1'
            with self.subTest(mutation=mutation), self.assertRaises(ValueError): attachments.same_runtime(before, changed)

    def test_transition_preserves_sender_tls_dns_queue_and_other_policy(self):
        after = Path(__file__).with_name('owned-mail').joinpath('maddy.conf').read_text()
        before = after.replace('    max_message_size 80M\n', '    max_message_size 96K\n').replace(
            '    buffer auto 1M /data/buffer\n', '    buffer ram\n')
        attachments.exact_delta(before, after)
        for changed in [after.replace('80M', '800M'), after.replace('cdx202611', 'foreign'),
                after.replace('min_tls_level encrypted', 'min_tls_level none'), after.replace('no-reply@codexdentist.com', '*'),
                after.replace('smtp tls://', 'smtp tcp://'), after.replace('/data/buffer', '/tmp/public-buffer')]:
            with self.assertRaises(ValueError): attachments.exact_delta(before, changed)
        with self.assertRaises(ValueError): attachments.exact_delta(after, after)


if __name__ == '__main__': unittest.main()
