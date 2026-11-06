import importlib.util
from pathlib import Path
import tempfile
import unittest
import os

spec=importlib.util.spec_from_file_location('optional_services',Path(__file__).with_name('optional-services.py'))
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class ServiceConfigurationTests(unittest.TestCase):
    def setUp(self):
        names=['orthanc','medplum-db','medplum-cache','medplum-admin','medplum-admin-client-id','medplum-admin-client-secret',
               'medplum-signing-key','chatwoot','chatwoot-db','chatwoot-cache','novu','novu-db','novu-cache','novu-jwt','novu-store']
        keys={name:'synthetic-'+name for name in names};keys['owner-email']='owner@example.test'
        images={name:'example/'+name+'@sha256:'+'a'*64 for name in [*module.IMAGES,'ohif']}
        self.config=module.configuration(keys,images)

    def test_private_databases_and_explicit_loopback_only_ports(self):
        for name,service in self.config['services'].items():
            for binding in service.get('ports',[]):self.assertTrue(binding.startswith('127.0.0.1:'))
            if name.endswith('-db') or name.endswith('-cache'):
                self.assertNotIn('ports',service)
                self.assertNotIn('gateway',service['networks'])
                for network in service['networks']:self.assertTrue(self.config['networks'][network]['internal'])

    def test_generated_services_are_opt_in_bounded_and_independent_of_the_core(self):
        for name,service in self.config['services'].items():
            self.assertEqual(len(service['profiles']),1)
            self.assertIn(service['profiles'][0],module.GROUPS)
            self.assertIn('mem_limit',service);self.assertLessEqual(service['cpus'],1)
            self.assertIn('@sha256:',service['image'])
            self.assertNotIn('DATABASE_URL',service.get('environment',{}))
        mounts=[mount for service in self.config['services'].values() for mount in service.get('volumes',[])]
        self.assertFalse(any('/opt/namecheap-migration' in mount or 'codexdentist-db' in mount for mount in mounts))

    def test_service_auth_and_internal_novu_bridge_are_present(self):
        services=self.config['services']
        self.assertEqual(services['orthanc']['environment']['ORTHANC__AUTHENTICATION_ENABLED'],'true')
        self.assertEqual(services['chatwoot']['environment']['ENABLE_ACCOUNT_SIGNUP'],'false')
        self.assertEqual(services['medplum']['environment']['MEDPLUM_REGISTER_ENABLED'],'false')
        self.assertEqual(services['medplum']['environment']['MEDPLUM_EMAIL_PROVIDER'],'none')
        self.assertIn('codexdentist-novu',services['novu']['networks']['novu']['aliases'])
        self.assertEqual(services['novu-worker']['networks'],['novu'])
        self.assertEqual(services['novu']['environment']['AWS_ACCESS_KEY_ID'],'')

    def test_configuration_files_are_atomic_and_private(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'credentials.json'
            module.write_private(path,{'secret':'synthetic'})
            self.assertEqual(path.read_text().strip(),'{\n  "secret": "synthetic"\n}')
            self.assertFalse(path.with_suffix('.json.tmp').exists())
            if os.name=='posix':self.assertEqual(path.stat().st_mode & 0o777,0o600)

if __name__=='__main__':unittest.main()
