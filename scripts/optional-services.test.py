import importlib.util
from pathlib import Path
import tempfile
import unittest
import os
import io
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('optional_services',Path(__file__).with_name('optional-services.py'))
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
runner_spec=importlib.util.spec_from_file_location('owned_app_runner',Path(__file__).with_name('run-owned-app-command.py'))
runner=importlib.util.module_from_spec(runner_spec)
runner_spec.loader.exec_module(runner)

class RunningEnvironmentTests(unittest.TestCase):
    def configuration(self):
        return {'Id':'b'*64,'Image':'sha256:'+'c'*64,'State':{'Running':True},
                'Config':{'Labels':{'org.opencontainers.image.revision':'a'*40},
                          'Env':['AUTH_SECRET=resolved-secret-$-value','QUOTED="intentional-quotes"','EMPTY=']}}

    def test_resolved_secrets_are_lossless_and_absent_from_argv(self):
        value=self.configuration()
        argv,pipe=runner.command_plan(value,'a'*40,Path('/review-source'),['node','scripts/probe.mjs'])
        self.assertEqual(pipe,b'AUTH_SECRET=resolved-secret-$-value\nQUOTED="intentional-quotes"\nEMPTY=\n')
        self.assertNotIn('resolved-secret',' '.join(argv))
        self.assertIn('/dev/stdin',argv)
        self.assertIn('container:'+'b'*64,argv)
        self.assertIn('sha256:'+'c'*64,argv)
        self.assertNotIn('--privileged',argv)

    def test_multiline_values_and_wrong_revision_fail_before_running(self):
        value=self.configuration()
        with self.assertRaises(ValueError):runner.command_plan(value,'d'*40,Path('/source'),['node'])
        value['Config']['Env']=['AUTH_SECRET=first\nSECOND=injected']
        with self.assertRaises(ValueError):runner.command_plan(value,'a'*40,Path('/source'),['node'])

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
            self.assertNotIn('traefik.enable',service.get('labels',{}))
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

    def test_owned_account_is_insufficient_while_installation_onboarding_is_open(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);(root/'bootstrap-output').mkdir()
            (root/'bootstrap-output/chatwoot-config.json').write_text('{"accountId":"1","apiToken":"synthetic"}')
            account=io.BytesIO(b'{"id":1}');account.status=200
            onboarding=io.BytesIO(b'first-run form');onboarding.status=200
            onboarding.geturl=lambda:'http://127.0.0.1:23803/installation/onboarding'
            with patch.object(module.urllib.request,'urlopen',side_effect=[account,onboarding]):
                with self.assertRaisesRegex(SystemExit,'onboarding is still open'):
                    module.verify_chatwoot_before_publication(root)

if __name__=='__main__':unittest.main()
