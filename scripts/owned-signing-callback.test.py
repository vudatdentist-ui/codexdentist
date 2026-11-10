import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from contextlib import ExitStack
from types import SimpleNamespace
import json

spec=importlib.util.spec_from_file_location('callback',Path(__file__).with_name('owned-signing-callback.py'))
callback=importlib.util.module_from_spec(spec);spec.loader.exec_module(callback)


class CallbackBoundary(unittest.TestCase):
    def test_internal_tls_boundary_never_mounts_core_or_provider_credentials(self):
        config=callback.configuration();proxy=config['services']['proxy']
        self.assertEqual(set(config['services']),{'proxy'});self.assertFalse(proxy.get('ports'));self.assertFalse(proxy.get('environment'))
        self.assertEqual(proxy['user'],'101:101');self.assertTrue(proxy['read_only']);self.assertEqual(proxy['logging'],{'driver':'none'})
        self.assertEqual(proxy['cap_drop'],['ALL']);self.assertEqual(proxy['ulimits']['nofile'],{'soft':4096,'hard':4096})
        self.assertTrue(config['networks']['core']['internal']);self.assertNotIn('coolify',str(config))
        self.assertEqual(config['networks']['provider']['name'],'codexdentist-owned-signing_private')
        self.assertEqual({v['target'] for v in proxy['volumes']},{'/etc/nginx/nginx.conf','/secrets/callback.key.pem','/secrets/callback.cert.pem'})
        self.assertTrue(all(v['read_only'] for v in proxy['volumes']))

    def test_only_post_connection_callback_is_forwarded_with_no_secret_logging(self):
        text=callback.template().decode()
        self.assertIn('ssl_protocols TLSv1.2 TLSv1.3;',text)
        self.assertIn('^/api/integrations/documenso/webhooks/[A-Za-z0-9_-]+$',text)
        self.assertIn('limit_except POST { deny all; }',text);self.assertIn('location / { return 404; }',text)
        self.assertIn('client_max_body_size 2m;',text);self.assertIn('proxy_read_timeout 9s;',text)
        self.assertIn('access_log off;',text);self.assertIn('error_log /dev/null crit;',text)
        self.assertNotIn('x-documenso-secret',text.lower());self.assertNotIn('proxy_set_header Authorization',text)
        self.assertIn('http://codexdentist-signing-core:3000',text)
        for name in ['client_body','proxy','fastcgi','uwsgi','scgi']:
            self.assertIn(name+'_temp_path /tmp/',text)

    def test_prepare_never_replaces_existing_callback_identity(self):
        with tempfile.TemporaryDirectory() as temporary,patch.object(callback,'ROOT',Path(temporary)),patch.object(callback.gateway,'run') as run:
            with self.assertRaises(ValueError):callback.prepare()
            run.assert_not_called()

    def test_foreign_provider_or_synthetic_project_is_refused(self):
        for project in ['foreign','codexdentist-signing-test-'+'a'*31,'codexdentist-signing-test-'+'z'*32]:
            with patch.object(callback,'PROVIDER_PROJECT',project):
                with self.assertRaises(ValueError):callback.configuration()
        with patch.object(callback,'PROJECT','foreign'):
            with self.assertRaises(ValueError):callback.configuration()

    def test_provider_trust_failure_restores_exact_files_and_preserves_foreign_edits(self):
        for failure in [None,'probe','concurrent']:
            with self.subTest(failure=failure),tempfile.TemporaryDirectory() as temporary,ExitStack() as stack:
                root=Path(temporary);provider=root/'provider';provider.mkdir();(root/'callback.cert.pem').write_bytes(b'Synthetic public certificate')
                before_compose=b'{"synthetic":"original"}';before_manifest=b'{"applicationConnected":false}'
                (provider/'compose.json').write_bytes(before_compose);(provider/'manifest.json').write_bytes(before_manifest);(provider/'keys.json').write_text('{}')
                def private(path,value,app_readable=False):
                    with path.open('xb') as out:out.write(value)
                signing=SimpleNamespace(ROOT=provider,PROJECT='synthetic-provider',private=private,configuration=lambda keys,enabled:{'synthetic':'callback-enabled'},status=lambda root:None,health=lambda root:None)
                stack.enter_context(patch.object(callback,'ROOT',root))
                stack.enter_context(patch.object(callback.gateway,'replace',side_effect=lambda path,value,uid=0:path.write_bytes(value)))
                def run(args):
                    if args[:2]==['docker','exec'] and failure:
                        if failure=='concurrent':(provider/'compose.json').write_bytes(b'foreign compose edit')
                        raise ValueError('Synthetic callback probe failure')
                    return b''
                stack.enter_context(patch.object(callback.gateway,'run',side_effect=run))
                if failure:
                    with self.assertRaises(ValueError):callback.apply_provider_trust(signing,root/'snapshot',before_compose,before_manifest)
                    if failure=='concurrent':self.assertEqual((provider/'compose.json').read_bytes(),b'foreign compose edit')
                    else:
                        self.assertEqual((provider/'compose.json').read_bytes(),before_compose)
                        self.assertEqual((provider/'manifest.json').read_bytes(),before_manifest)
                        self.assertFalse((provider/'callback-trust.cert.pem').exists())
                    self.assertFalse((provider/'callback-trust-accepted.json').exists())
                else:
                    callback.apply_provider_trust(signing,root/'snapshot',before_compose,before_manifest)
                    self.assertTrue((provider/'callback-trust-accepted.json').exists())
                    self.assertFalse(json.loads((provider/'manifest.json').read_text())['applicationConnected'])
                self.assertEqual((provider/'callback-trust-before/compose.json').read_bytes(),before_compose)

    def test_webhook_provisioning_uses_distinct_accounts_and_retains_intent_before_calls(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary)
            (root/'bootstrap.credentials.json').write_text(json.dumps([{'purpose':purpose,'userId':index,'teamId':index} for index,purpose in enumerate(['main','qa'],3)]))
            (root/'bootstrap.intent.json').write_text(json.dumps({'accounts':[{'purpose':purpose,'email':'signing-'+('operator' if purpose=='main' else 'qa')+'@codexdentist.com','password':'b'*64} for purpose in ['main','qa']]}))
            def private(path,value,app_readable=False):
                with path.open('xb') as output:output.write(value)
            signing=SimpleNamespace(ROOT=root,installation=lambda path:None,private=private)
            calls=[]
            def client(module,row):
                self.assertTrue((root/('webhook.'+row['purpose']+'.intent.json')).is_file());calls.append(row)
                return{'pass':True,'purpose':row['purpose'],'teamId':row['teamId'],'connectionId':row['connectionId'],'webhookId':'synthetic_'+row['purpose']}
            bindings=[{'purpose':purpose,'connectionId':'synthetic_connection_'+purpose,'secret':char*64} for purpose,char in [('main','a'),('qa','c')]]
            with patch.object(callback,'webhook_client',side_effect=client):
                callback.provision_webhooks(signing,[bindings[0]])
                with self.assertRaises(ValueError):callback.provision_webhooks(signing,[{**bindings[1],'secret':bindings[0]['secret']}])
                callback.provision_webhooks(signing,[bindings[1]])
                self.assertEqual([row['action'] for row in calls],['create','inspect','create','inspect'])
                self.assertEqual(len({row['teamId'] for row in calls}),2)
                with self.assertRaises(FileExistsError):callback.provision_webhooks(signing,bindings)
                self.assertEqual(len(calls),4,'A retained intent prevents creation replay')
            for purpose in ['main','qa']:self.assertEqual(len((root/('webhook.'+purpose+'.api-result.jsonl')).read_text().splitlines()),1)


if __name__=='__main__':unittest.main()
