import importlib.util
import io
from pathlib import Path
import tarfile
import unittest
import tempfile
from unittest.mock import patch


def module(name):
    spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(name+'.py'))
    result=importlib.util.module_from_spec(spec);spec.loader.exec_module(result);return result


backup=module('patient-file-backup');check=module('production-go-live');deploy=module('deploy-hostinger')


class DurableFileOperations(unittest.TestCase):
    def test_failed_snapshot_always_unpauses_app_and_never_claims_restore(self):
        for failing in ['database','files',None]:
            calls=[]
            def run(args,**kwargs):
                calls.append(args)
                if failing=='database' and args[:2]==['docker','exec']:raise RuntimeError('synthetic dump failure')
                if failing=='files' and args[0]=='python3' and args[2]=='backup':raise RuntimeError('synthetic archive failure')
            with tempfile.TemporaryDirectory() as temporary,patch.object(deploy,'run',side_effect=run):
                if failing:
                    with self.assertRaises(RuntimeError):deploy.backup_operational_data(Path(temporary),{'PATIENT_FILE_LOCAL_DURABLE':'true'})
                else:deploy.backup_operational_data(Path(temporary),{'PATIENT_FILE_LOCAL_DURABLE':'true'})
            self.assertEqual(calls[0],['docker','pause',deploy.CONTAINER])
            self.assertIn(['docker','unpause',deploy.CONTAINER],calls)
            if failing:self.assertFalse(any(c[0]=='python3' and c[2]=='drill' for c in calls))
            else:self.assertEqual(calls[-1][2],'drill')

    def test_restore_rejects_links_special_files_absolute_and_traversal(self):
        for name,kind in [('../outside',tarfile.REGTYPE),('/outside',tarfile.REGTYPE),('./link',tarfile.SYMTYPE),('./hardlink',tarfile.LNKTYPE),('./device',tarfile.CHRTYPE)]:
            with self.subTest(name=name):
                stream=io.BytesIO()
                with tarfile.open(fileobj=stream,mode='w') as out:
                    entry=tarfile.TarInfo(name);entry.type=kind;out.addfile(entry)
                stream.seek(0)
                with tarfile.open(fileobj=stream) as source,self.assertRaises(ValueError):backup.validate_archive(source)

    def test_only_explicit_owned_writable_volume_is_backed_up(self):
        current={'Config':{'Env':['PATIENT_FILE_LOCAL_DURABLE=true','PATIENT_FILE_STORAGE_ROOT=/data/patient-files']},
            'Mounts':[{'Destination':'/data/patient-files','Type':'volume','RW':True,'Name':'owned-files'}]}
        with patch.object(backup,'inspect',return_value={'Labels':{backup.LABEL:'patient-files'}}):
            self.assertEqual(backup.owned_volume(current),'owned-files')
            for field,value in [('Type','bind'),('RW',False),('Destination','/other')]:
                changed={**current,'Mounts':[{**current['Mounts'][0],field:value}]}
                with self.assertRaises(ValueError):backup.owned_volume(changed)
        with patch.object(backup,'inspect',return_value={'Labels':{}}),self.assertRaises(ValueError):backup.owned_volume(current)

    def test_restore_has_no_network_or_worker_and_never_mounts_source(self):
        command=backup.command('sha256:'+'a'*64,'unique-restore',True)
        self.assertIn('none',command);self.assertIn('--read-only',command)
        self.assertIn('--cap-drop',command);self.assertIn('volume-nocopy',' '.join(command))
        self.assertIn('-i',command)  # Docker must actually forward the verified archive pipe.
        self.assertNotIn('--privileged',command);self.assertNotIn('--volumes-from',command)

    def test_go_live_uses_resolved_env_exact_image_uid_and_only_file_volume(self):
        sha='a'*40
        current={'Image':'sha256:'+'b'*64,'Config':{'User':'node','Labels':{'org.opencontainers.image.revision':sha},
            'Env':['AUTH_SECRET="literal$quoted"','EMPTY=','PATIENT_FILE_LOCAL_DURABLE=true','PATIENT_FILE_STORAGE_ROOT=/data/patient-files']},
            'Mounts':[{'Destination':'/data/patient-files','Type':'volume','RW':True,'Name':'owned-files'},
                      {'Destination':'/other-secret','Type':'bind','RW':False,'Source':'/private'}]}
        args,env=check.command(current,Path('/canonical'),sha)
        self.assertIn(current['Image'],args);self.assertIn('node',args);self.assertIn('/dev/stdin',args)
        self.assertIn(b'AUTH_SECRET="literal$quoted"\nEMPTY=\n',env)
        self.assertNotIn('literal',' '.join(args));self.assertNotIn('/other-secret',' '.join(args));self.assertNotIn('--volumes-from',args)
        for user in ['','root','0:0']:
            with self.assertRaises(ValueError):check.command({**current,'Config':{**current['Config'],'User':user}},Path('/canonical'),sha)
        with self.assertRaises(ValueError):check.command(current,Path('/canonical'),'c'*40)


if __name__=='__main__':unittest.main()
