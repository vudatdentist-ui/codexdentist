import importlib.util
from pathlib import Path
import unittest
import json
import tempfile
import hashlib
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('owned_mail',Path(__file__).with_name('owned-mail-services.py'))
mail=importlib.util.module_from_spec(spec);spec.loader.exec_module(mail)
spec=importlib.util.spec_from_file_location('mail_backup',Path(__file__).with_name('owned-mail-backup.py'))
backup=importlib.util.module_from_spec(spec);spec.loader.exec_module(backup)
spec=importlib.util.spec_from_file_location('mail_linux',Path(__file__).with_name('owned-mail-linux.py'))
linux=importlib.util.module_from_spec(spec);spec.loader.exec_module(linux)
spec=importlib.util.spec_from_file_location('mail_activation',Path(__file__).with_name('owned-mail-activation.py'))
activation=importlib.util.module_from_spec(spec);spec.loader.exec_module(activation)


class OwnedMailDeployment(unittest.TestCase):
    def test_only_smtp_gets_an_outbound_route_after_explicit_activation(self):
        config=mail.configuration('sha256:'+'a'*64,True)
        self.assertFalse(config['networks']['outbound']['internal'])
        self.assertEqual(set(config['services']['smtp']['networks']),{'smtp','outbound'})
        self.assertEqual(set(config['services']['gateway']['networks']),{'smtp','gateway'})
        self.assertEqual(config['services']['gateway']['environment']['OWNED_MAIL_TEST_ONLY'],'false')
        self.assertTrue(config['networks']['gateway']['internal']);self.assertTrue(config['networks']['smtp']['internal'])
        for value in ['false',1,None]:
            with self.assertRaises(ValueError):mail.configuration('sha256:'+'a'*64,value)

    def sender_fixture(self):
        records=[{'name':'codexdentist.com','type':'TXT','value':'v=spf1 ip4:187.127.116.53 ~all'},
            {'name':'cdx202611._domainkey.codexdentist.com','type':'TXT','value':'v=DKIM1; k=rsa; p=synthetic-key'}]
        answers={('codexdentist.com',16):[json.dumps(records[0]['value'])],('cdx202611._domainkey.codexdentist.com',16):[json.dumps(records[1]['value'])],
            ('srv1907391.hstgr.cloud',1):['187.127.116.53'],('53.116.127.187.in-addr.arpa',12):['srv1907391.hstgr.cloud.']}
        return records,answers

    def test_public_sender_requires_one_spf_exact_dkim_key_and_forward_reverse_identity(self):
        records,answers=self.sender_fixture();lookup=lambda name,kind:answers[(name,kind)]
        self.assertEqual(activation.verify_sender(records,'synthetic-key','srv1907391.hstgr.cloud',lookup),{'spf':True,'dkim':True,'forwardReverse':True})
        for key,value in [(('codexdentist.com',16),answers[('codexdentist.com',16)]*2),
                (('cdx202611._domainkey.codexdentist.com',16),['"v=DKIM1; k=rsa; p=foreign-key"']),
                (('srv1907391.hstgr.cloud',1),['127.0.1.1']),
                (('53.116.127.187.in-addr.arpa',12),['foreign.example.'])]:
            changed={**answers,key:value}
            with self.subTest(key=key),self.assertRaises(ValueError):activation.verify_sender(records,'synthetic-key','srv1907391.hstgr.cloud',lambda name,kind:changed[(name,kind)])
        with self.assertRaises(ValueError):activation.verify_sender(records,'wrong-persistent-key','srv1907391.hstgr.cloud',lookup)
        self.assertEqual(activation.txt('"first " "second"'),'first second')

    def activation_fixture(self,root):
        revision='a'*40;source=root/'releases'/revision/'scripts/owned-mail';source.mkdir(parents=True)
        template=(Path(__file__).parent/'owned-mail/maddy.conf').read_text();(source/'maddy.conf').write_text(template)
        pin={'version':1,'revision':revision,'gatewayImage':'sha256:'+'a'*64,'smtpImage':mail.MADDY,'outboundHostname':'srv1907391.hstgr.cloud',
            'outboundEnabled':False,'sourceConfigSha256':hashlib.sha256(template.encode()).hexdigest()}
        directory=root/'installation';directory.mkdir()
        (directory/'maddy.conf').write_text(template.replace('hostname mail.codexdentist.com','hostname '+pin['outboundHostname']))
        (directory/'manifest.json').write_text(json.dumps(pin));(directory/'compose.json').write_text(json.dumps(mail.configuration(pin['gatewayImage'])))
        return directory,pin

    def test_initial_activation_failures_preserve_config_and_restart_the_original_stage(self):
        from contextlib import ExitStack
        for failure in ['dns','backup','queue','start','readiness',None]:
            with self.subTest(failure=failure),tempfile.TemporaryDirectory()as temp:
                root=Path(temp);directory,pin=self.activation_fixture(root);before={name:(directory/name).read_bytes()for name in ['compose.json','manifest.json']};events=[]
                def step(name):
                    def action(*args):
                        events.append(name)
                        if failure==name and events.count(name)==1:raise RuntimeError('synthetic '+name)
                        return {'verified':True}if name=='dns'else root/'snapshot'
                    return action
                with ExitStack()as stack:
                    stack.enter_context(patch.object(activation,'RELEASES',root/'releases'))
                    for name,method in [('dns','sender_dns'),('backup','cold_snapshot'),('queue','empty_initial_queues'),('start','apply'),('readiness','ready')]:
                        stack.enter_context(patch.object(activation,method,side_effect=step(name)))
                    stack.enter_context(patch.object(activation,'status'))
                    stack.enter_context(patch.object(activation.mail,'run',side_effect=lambda args:events.append('stop')))
                    # Replace the Linux O_NOFOLLOW I/O boundary only; preserve
                    # exclusive creation while exercising rollback on Windows.
                    def write(path,value,app_readable=False):
                        with path.open('xb')as output:output.write(value)
                    stack.enter_context(patch.object(activation.mail,'write_private',side_effect=write))
                    stack.enter_context(patch.object(activation,'replace_private',side_effect=lambda path,value:path.write_bytes(value)))
                    if failure:
                        with self.assertRaisesRegex(RuntimeError,'synthetic '+failure):activation.activate(directory)
                        self.assertEqual({name:(directory/name).read_bytes()for name in before},before)
                        self.assertFalse((directory/'outbound-stage-verified.json').exists())
                        if failure in ['queue','start','readiness']:self.assertEqual(events[-1],'start')
                        if failure in ['dns','backup']:self.assertNotIn('stop',events)
                    else:
                        activation.activate(directory)
                        self.assertLess(events.index('dns'),events.index('backup'));self.assertLess(events.index('backup'),events.index('stop'))
                        self.assertTrue(json.loads((directory/'manifest.json').read_text())['outboundEnabled'])
                        proof=json.loads((directory/'outbound-stage-verified.json').read_text());self.assertFalse(proof['externalDeliveryAccepted']);self.assertFalse(proof['coreConfigurationChanged'])
                        with self.assertRaises(ValueError):activation.activate(directory)

    def test_private_key_evidence_cannot_enter_the_build_tree(self):
        with tempfile.TemporaryDirectory()as temp:
            source=Path(temp)/'source';source.mkdir()
            for output in [source,source/'output/mail',source/'output/../private-mail']:
                with self.assertRaisesRegex(ValueError,'outside the source'):linux.private_output(source,output)
            self.assertEqual(linux.private_output(source,Path(temp)/'private-mail'),Path(temp)/'private-mail')

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
        self.assertIn('max_message_size 80M',text);self.assertIn('buffer auto 1M /data/buffer',text)

    def test_backup_failure_restarts_every_previously_active_worker(self):
        for restart_failure in [False,True]:
            with self.subTest(restart_failure=restart_failure),tempfile.TemporaryDirectory()as temp:
                root=Path(temp);(root/'secrets').mkdir()
                for name in ['compose.json','maddy.conf']:(root/name).write_text('{}')
                (root/'manifest.json').write_text(json.dumps({'gatewayImage':'sha256:'+'a'*64,'smtpImage':mail.MADDY}))
                (root/'secrets/encryption.key').write_text('synthetic only')
                def inspect(kind,name):
                    if kind=='volume':return {'Labels':{'com.codexdentist.mail':name.split('_',1)[1]}}
                    return {'Image':'sha256:'+'a'*64,'Config':{'Image':mail.MADDY},'State':{'Running':True}}
                calls=[]
                def run(args):
                    calls.append(args)
                    if restart_failure and args[:2]==['docker','start']and args[-1].endswith('-smtp-1'):raise RuntimeError('synthetic restart failure')
                with patch.object(backup,'ROOT',root),patch.object(backup,'inspect',side_effect=inspect),patch.object(backup.files,'run',side_effect=run),patch.object(backup.files,'inventory',side_effect=RuntimeError('synthetic archive failure')):
                    with self.assertRaisesRegex(RuntimeError,'restart failed'if restart_failure else'archive failure'):backup.backup()
                self.assertEqual([args[-1]for args in calls if args[1]=='stop'],['codexdentist-owned-mail-gateway-1','codexdentist-owned-mail-smtp-1'])
                self.assertEqual([args[-1]for args in calls if args[1]=='start'],['codexdentist-owned-mail-smtp-1','codexdentist-owned-mail-gateway-1'])


if __name__=='__main__':unittest.main()
