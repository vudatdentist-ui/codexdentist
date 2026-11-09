import importlib.util
from pathlib import Path
import unittest

spec=importlib.util.spec_from_file_location('owned_mail',Path(__file__).with_name('owned-mail-services.py'))
mail=importlib.util.module_from_spec(spec);spec.loader.exec_module(mail)


class OwnedMailDeployment(unittest.TestCase):
    def test_initial_runtime_is_private_and_cannot_send_external_mail(self):
        config=mail.configuration('sha256:'+'a'*64)
        self.assertEqual(config['name'],'codexdentist-owned-mail')
        self.assertEqual(set(config['services']),{'gateway','smtp'})
        self.assertTrue(all(network['internal']for network in config['networks'].values()))
        self.assertEqual(set(config['services']['smtp']['networks']),{'smtp'})
        self.assertEqual(set(config['services']['gateway']['networks']),{'gateway','smtp'})
        self.assertEqual(config['services']['gateway']['environment']['OWNED_MAIL_TEST_ONLY'],'true')
        for service in config['services'].values():
            self.assertFalse(service.get('ports'));self.assertTrue(service['read_only']);self.assertEqual(service['user'],'1000:1000')
            self.assertEqual(service['cap_drop'],['ALL']);self.assertFalse(service.get('privileged'))
            self.assertEqual(service['cpus'],1.0);self.assertEqual(service['mem_limit'],'384m')
            self.assertFalse(any('DATABASE_URL'in key or key in ['AUTH_SECRET','JOB_SECRET'] for key in service.get('environment',{})))

    def test_keys_are_private_files_and_volumes_never_copy_ephemeral_root_data(self):
        config=mail.configuration('sha256:'+'a'*64)
        env=config['services']['gateway']['environment']
        for key in ['OWNED_MAIL_SIGNING_SECRET_FILE','OWNED_MAIL_ENCRYPTION_KEY_FILE','OWNED_MAIL_TLS_KEY_FILE']:
            self.assertTrue(env[key].startswith('/secrets/'))
        self.assertNotIn('OWNED_MAIL_SIGNING_SECRET',env);self.assertNotIn('OWNED_MAIL_ENCRYPTION_KEY',env)
        for service in config['services'].values():
            for mount in service['volumes']:
                if mount['type']=='volume':self.assertTrue(mount['volume']['nocopy'])
                else:self.assertTrue(mount['read_only']);self.assertTrue(mount['source'].startswith('./'))
        for name,volume in config['volumes'].items():self.assertEqual(volume['labels']['com.codexdentist.mail'],name)

    def test_images_are_pinned_and_maddy_exposes_only_one_private_tls_listener(self):
        for image in ['latest','codexdentist:main','sha256:short','sha256:'+'a'*64+';bad']:
            with self.assertRaises(ValueError):mail.configuration(image)
        self.assertRegex(mail.MADDY,r'^ghcr.io/foxcpp/maddy@sha256:[a-f0-9]{64}$')
        text=(Path(__file__).parent/'owned-mail/maddy.conf').read_text()
        self.assertEqual(text.count('smtp tls://0.0.0.0:2465'),1)
        self.assertNotIn('tcp://0.0.0.0:25',text);self.assertNotIn('imap ',text)
        self.assertIn('source no-reply@codexdentist.com',text);self.assertIn('Sender not permitted',text)
        self.assertIn('requiretls_override no',text);self.assertIn('min_tls_level encrypted',text)


if __name__=='__main__':unittest.main()
