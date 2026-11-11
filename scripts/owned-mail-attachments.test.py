import importlib.util
import json
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('attachments', Path(__file__).with_name('owned-mail-attachments.py'))
attachments = importlib.util.module_from_spec(spec); spec.loader.exec_module(attachments)


class BoundedSignedPdfMail(unittest.TestCase):
    def test_recreated_container_may_only_change_generated_hostname_and_network_endpoint_values(self):
        before = {'Id': 'old-container', 'Image': 'same-image', 'Config': {'Hostname': 'old-id', 'Env': ['preserved=secret'], 'User': '1000:1000', 'Labels': {'com.docker.compose.replace': 'older-container'}},
            'HostConfig': {'ReadonlyRootfs': True, 'Mounts': ['private-preserved'], 'PortBindings': {}},
            'NetworkSettings': {'Networks': {'private': {'EndpointID': 'old'}, 'outbound': {}}}}
        after = json.loads(json.dumps(before)); after['Config']['Hostname'] = 'new-id'; after['Config']['Labels']['com.docker.compose.replace'] = before['Id']; after['NetworkSettings']['Networks']['private']['EndpointID'] = 'new'
        attachments.same_runtime(before, after)
        for mutation in ['image', 'env', 'mount', 'public-port', 'network', 'foreign-replacement']:
            changed = json.loads(json.dumps(after))
            if mutation == 'image': changed['Image'] = 'changed'
            if mutation == 'env': changed['Config']['Env'] = ['changed=secret']
            if mutation == 'mount': changed['HostConfig']['Mounts'] = ['different']
            if mutation == 'public-port': changed['HostConfig']['PortBindings'] = {'2465/tcp': [{}]}
            if mutation == 'network': changed['NetworkSettings']['Networks']['foreign'] = {}
            if mutation == 'foreign-replacement': changed['Config']['Labels']['com.docker.compose.replace'] = 'foreign'
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
