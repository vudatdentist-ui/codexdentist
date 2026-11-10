import importlib.util
import json
from pathlib import Path
import tempfile
import tarfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('signing', Path(__file__).with_name('owned-signing-services.py'))
signing = importlib.util.module_from_spec(spec); spec.loader.exec_module(signing)
spec = importlib.util.spec_from_file_location('recovery', Path(__file__).with_name('owned-signing-backup.py'))
recovery = importlib.util.module_from_spec(spec); spec.loader.exec_module(recovery)
spec = importlib.util.spec_from_file_location('signing_linux', Path(__file__).with_name('owned-signing-linux.py'))
linux = importlib.util.module_from_spec(spec); spec.loader.exec_module(linux)


class OwnedSigningRuntime(unittest.TestCase):
    def keys(self):
        return {name: format(index, '064x') for index, name in enumerate(
            ['database', 'cache', 'auth', 'encryption', 'secondary', 'certificate'], 1)}

    def test_private_runtime_has_no_publication_core_credentials_or_remote_mail(self):
        config = signing.configuration(self.keys())
        self.assertEqual(set(config['services']), {'app', 'database', 'cache', 'capture'})
        self.assertEqual(config['networks'], {'private': {'internal': True}})
        for service in config['services'].values():
            self.assertEqual(service['networks'], ['private']); self.assertFalse(service.get('ports'))
            self.assertEqual(service['logging'], {'driver': 'none'})
            self.assertEqual(service['cap_drop'], ['ALL']); self.assertFalse(service.get('privileged'))
            self.assertNotIn('DATABASE_URL', service.get('environment', {}))
            self.assertNotIn('AUTH_SECRET', service.get('environment', {}))
            self.assertNotIn('JOB_SECRET', service.get('environment', {}))
        app = config['services']['app']; env = app['environment']
        self.assertEqual(app['user'], '1001:1001'); self.assertTrue(app['read_only'])
        self.assertEqual(env['NEXT_PUBLIC_DISABLE_SIGNUP'], 'true')
        self.assertEqual(env['DOCUMENSO_DISABLE_TELEMETRY'], 'true')
        self.assertEqual(env['NEXT_PRIVATE_SMTP_HOST'], 'capture')
        self.assertEqual(env['TZ'], 'Asia/Ho_Chi_Minh')
        self.assertEqual(env['NEXT_PRIVATE_SIGNING_TRANSPORT'], 'local')
        self.assertNotIn('NEXT_PRIVATE_LICENSE_KEY', env)
        self.assertIn('-h', config['services']['database']['healthcheck']['test'])
        self.assertEqual(config['services']['cache']['user'], '999:1000')
        self.assertNotIn('cap_add', config['services']['cache'])

    def test_images_are_immutable_and_only_expected_state_is_writable(self):
        config = signing.configuration(self.keys())
        for image in signing.IMAGES.values(): self.assertRegex(image, r'^[a-z/]+@sha256:[a-f0-9]{64}$')
        for name, service in config['services'].items():
            for mount in service.get('volumes', []):
                if mount['type'] == 'volume':
                    self.assertTrue(mount['volume']['nocopy']); self.assertIn(name, ['database', 'cache'])
                elif mount['target'] == '/app/.documenso-license.json':
                    self.assertFalse(mount['read_only']); self.assertEqual(mount['source'], './license-cache.json')
                else:
                    self.assertEqual(mount['target'], '/secrets/signing.p12'); self.assertTrue(mount['read_only'])
        for name, volume in config['volumes'].items():
            self.assertEqual(volume['labels'], {'com.codexdentist.signing': name})
            self.assertEqual(volume['name'], signing.PROJECT + '_' + name)

    def test_prepare_refuses_existing_directory_or_volume_before_writing_keys(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with self.assertRaises(ValueError): signing.prepare(root)
            result = type('Result', (), {'returncode': 0})()
            with patch.object(signing.subprocess, 'run', return_value=result):
                with self.assertRaises(ValueError): signing.prepare(root / 'new')
            self.assertFalse((root / 'new').exists())

    def test_secrets_are_exact_generated_hex_never_partial_or_injected(self):
        for keys in [{}, {**self.keys(), 'database': 'short'}, {**self.keys(), 'cache': 'z' * 64},
                {**self.keys(), 'auth': 'a' * 63 + '\n'}, {**self.keys(), 'unknown': 'a' * 64},
                {name: 'a' * 64 for name in self.keys()}]:
            with self.assertRaises(ValueError): signing.configuration(keys)

    def test_private_proof_outputs_cannot_enter_the_source_tree_or_replace_evidence(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); source = root / 'source'; source.mkdir()
            for output in [source, source / 'output/keys', source / 'output/../private']:
                with self.assertRaises(ValueError): linux.private_output(source, output)
            self.assertEqual(linux.private_output(source, root / 'fresh'), root / 'fresh')
            with self.assertRaises(ValueError): linux.private_output(source, root)

    def test_runtime_status_fails_closed_on_exposure_or_provider_mutation(self):
        config = signing.configuration(self.keys())
        def info(name):
            service = config['services'][name]
            return {'State': {'Running': True}, 'Config': {'Image': service['image'], 'User': service.get('user', ''),
                'Env': [key + '=' + value for key, value in service.get('environment', {}).items()]},
                'HostConfig': {'PortBindings': {}, 'Privileged': False, 'ReadonlyRootfs': service.get('read_only', False),
                    'LogConfig': {'Type': 'none'}, 'CapDrop': ['ALL'], 'SecurityOpt': ['no-new-privileges']},
                'NetworkSettings': {'Networks': {signing.PROJECT + '_private': {}}}}
        for mutation in [None, 'public-port', 'external-network', 'signup', 'logs', 'root', 'restarting']:
            with self.subTest(mutation=mutation):
                values = {name: info(name) for name in config['services']}; app = values['app']
                if mutation == 'public-port': app['HostConfig']['PortBindings'] = {'3000/tcp': [{}]}
                if mutation == 'external-network': app['NetworkSettings']['Networks']['unrelated'] = {}
                if mutation == 'signup': app['Config']['Env'] = [value.replace('DISABLE_SIGNUP=true', 'DISABLE_SIGNUP=false') for value in app['Config']['Env']]
                if mutation == 'logs': app['HostConfig']['LogConfig']['Type'] = 'json-file'
                if mutation == 'root': app['Config']['User'] = '0:0'
                if mutation == 'restarting': app['State']['Restarting'] = True
                def run(args):
                    if args[1] == 'network': return json.dumps([{'Internal': True}]).encode()
                    name = args[-1].removeprefix(signing.PROJECT + '-').removesuffix('-1')
                    return json.dumps([values[name]]).encode()
                with patch.object(signing, 'installation', return_value=config), patch.object(signing, 'run', side_effect=run):
                    if mutation:
                        with self.assertRaises(ValueError): signing.status(Path('unused'))
                    else: signing.status(Path('unused'))

    def test_restore_archives_deny_links_devices_and_path_traversal(self):
        for name, kind in [('../outside', tarfile.REGTYPE), ('/absolute', tarfile.REGTYPE),
                ('key', tarfile.SYMTYPE), ('data', tarfile.LNKTYPE), ('pipe', tarfile.FIFOTYPE), ('device', tarfile.CHRTYPE)]:
            row = tarfile.TarInfo(name); row.type = kind
            archive = type('Archive', (), {'getmembers': lambda self: [row]})()
            with self.subTest(name=name), self.assertRaises(ValueError): recovery.validate_archive(archive)
        row = tarfile.TarInfo('./base/16384/123'); row.type = tarfile.REGTYPE
        recovery.validate_archive(type('Archive', (), {'getmembers': lambda self: [row]})())

    def test_failed_signing_snapshot_restarts_every_original_service(self):
        for failed_restart in [False, True]:
            with self.subTest(failed_restart=failed_restart), tempfile.TemporaryDirectory() as directory:
                root = Path(directory); (root / 'keys.json').write_text(json.dumps(self.keys()))
                calls = []
                def inspect(kind, name):
                    if kind == 'volume': return {'Labels': {'com.codexdentist.signing': name.removeprefix(signing.PROJECT + '_')}}
                    return {'State': {'Running': True}}
                def run(args, **kwargs):
                    calls.append(args)
                    if failed_restart and args[:2] == ['docker', 'start'] and args[-1].endswith('-database-1'):
                        raise RuntimeError('Synthetic database restart failure')
                    return b''
                with patch.object(recovery, 'ROOT', root), patch.object(recovery, 'inspect', side_effect=inspect), \
                        patch.object(recovery.signing, 'status'), patch.object(recovery.signing, 'run', side_effect=run), \
                        patch.object(recovery, 'counts', side_effect=RuntimeError('Synthetic snapshot failure')):
                    with self.assertRaisesRegex(RuntimeError, 'restart failed' if failed_restart else 'snapshot failure'): recovery.backup()
                self.assertEqual([args[-1] for args in calls if args[:2] == ['docker', 'start']], [
                    signing.PROJECT + '-' + name + '-1' for name in ['database', 'cache', 'capture', 'app']])


if __name__ == '__main__': unittest.main()
