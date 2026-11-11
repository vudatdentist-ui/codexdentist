import importlib.util
import json
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('retire', Path(__file__).with_name('owned-signing-retire-qa.py'))
retire = importlib.util.module_from_spec(spec); spec.loader.exec_module(retire)


class SyntheticQaRetirement(unittest.TestCase):
    def fixture(self):
        manifest = {'project': 'codexdentist-core-qa-' + 'a' * 12, 'syntheticOnly': True, 'productionCoreAttached': False, 'image': 'synthetic-image'}
        compose = {'name': manifest['project'], 'services': {'core': {'image': manifest['image'],
            'environment': {'NOTIFICATION_DELIVERY_MODE': 'disabled'},
            'networks': {'private': {}, 'api': {}, 'callback': {'aliases': ['codexdentist-signing-core']}},
            'volumes': ['synthetic-files:/data/patient-files']}, 'database': {'volumes': ['synthetic-db:/data']}, 'ui': {}},
            'networks': {'private': {'internal': True}, 'api': {'external': True},
            'callback': {'external': True, 'name': 'codexdentist-signing-callback_core'}}, 'volumes': {'synthetic-db': {}}}
        return manifest, compose

    def test_retirement_removes_only_the_callback_alias_and_network_preserving_all_data(self):
        manifest, compose = self.fixture(); before = json.loads(json.dumps(compose)); updated = retire.plan(manifest, compose)
        expected = json.loads(json.dumps(compose)); del expected['services']['core']['networks']['callback']; del expected['networks']['callback']
        self.assertEqual(updated, expected); self.assertEqual(compose, before)

    def test_production_unknown_scope_and_replayed_retirement_are_denied(self):
        for mutation in ['production', 'not-synthetic', 'retired', 'wrong-project', 'extra-service', 'mail-enabled', 'foreign-callback', 'different-image']:
            manifest, compose = self.fixture()
            if mutation == 'production': manifest['productionCoreAttached'] = True
            if mutation == 'not-synthetic': manifest['syntheticOnly'] = False
            if mutation == 'retired': manifest['retired'] = True
            if mutation == 'wrong-project': manifest['project'] = 'namecheap-migration'
            if mutation == 'extra-service': compose['services']['foreign'] = {}
            if mutation == 'mail-enabled': compose['services']['core']['environment']['NOTIFICATION_DELIVERY_MODE'] = 'owned-mail'
            if mutation == 'foreign-callback': compose['networks']['callback']['name'] = 'foreign'
            if mutation == 'different-image': compose['services']['core']['image'] = 'foreign'
            with self.subTest(mutation=mutation), self.assertRaises(ValueError): retire.plan(manifest, compose)


if __name__ == '__main__': unittest.main()
