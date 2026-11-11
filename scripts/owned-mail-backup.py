#!/usr/bin/env python3
"""Cold owned-mail snapshots; restored queues are checked without mail workers."""
import argparse
import datetime
import importlib.util
import json
import os
import re
from pathlib import Path
import shutil
import subprocess
import tarfile
import uuid

ROOT=Path('/opt/codexdentist-owned-mail')
PROJECT='codexdentist-owned-mail'
spec=importlib.util.spec_from_file_location('private_files',Path(__file__).with_name('patient-file-backup.py'))
files=importlib.util.module_from_spec(spec);spec.loader.exec_module(files)


def inspect(kind,name):return json.loads(files.run(['docker',kind,'inspect',name]))[0]


def validate_snapshot(snapshot):
    if snapshot.resolve()!=snapshot or snapshot.parent!=ROOT/'backups' or snapshot.is_symlink() or snapshot.stat().st_uid!=0 or snapshot.stat().st_mode&0o077:
        raise ValueError('Exact private mail snapshot required')


def attachment_records(directory, pin):
    revision = pin.get('configRevision')
    if revision is None: return []
    if not isinstance(revision, str) or not re.fullmatch('[a-f0-9]{40}', revision): raise ValueError('Exact attachment configuration revision required')
    prefix = 'attachment-upgrade-' + revision[:12]
    root = directory / prefix
    if root.is_symlink() or not root.is_dir(): raise ValueError('Private accepted attachment records required')
    names = ['accepted.json', 'intent.json', 'maddy.before.conf', 'manifest.before.json']
    if any((root / name).is_symlink() or not (root / name).is_file() for name in names): raise ValueError('Complete attachment recovery records required')
    proof = json.loads((root / 'accepted.json').read_text())
    if proof.get('pass') is not True or proof.get('actualSmtpSizeAndDenialVerified') is not True or (root / 'rolled-back.json').exists():
        raise ValueError('Accepted live attachment transition required')
    return [prefix + '/' + name for name in names + [name for name in ['runtime.before.json', 'runtime.after.json'] if (root / name).is_file()]]


def backup():
    pin=json.loads((ROOT/'manifest.json').read_text());transition=attachment_records(ROOT,pin)
    services={name:inspect('container',PROJECT+'-'+name+'-1')for name in ['gateway','smtp']}
    if services['gateway']['Image']!=pin['gatewayImage'] or services['smtp']['Config']['Image']!=pin['smtpImage']:
        raise ValueError('Running mail image differs from its installation pin')
    for name in ['gateway-data','smtp-data']:
        volume=inspect('volume',PROJECT+'_'+name)
        if volume.get('Labels',{}).get('com.codexdentist.mail')!=name:raise ValueError('Mail volume ownership differs')
    active=[name for name,info in services.items()if info['State']['Running']]
    parent=ROOT/'backups';parent.mkdir(mode=0o700,exist_ok=True)
    snapshot=parent/(datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'-'+uuid.uuid4().hex[:8]);snapshot.mkdir(mode=0o700)
    manifest={'version':1,'gatewayImage':pin['gatewayImage'],'smtpImage':pin['smtpImage'],'volumes':{},'files':{}}
    try:
        # Stop producers first, then the MTA; never stop the clinic application.
        for name in active:files.run(['docker','stop','--time','30',PROJECT+'-'+name+'-1'])
        for name in ['compose.json','maddy.conf','manifest.json'] + transition:
            source=ROOT/name
            if source.is_symlink()or not source.is_file():raise ValueError('Unsafe private mail configuration')
            (snapshot/name).parent.mkdir(mode=0o700,parents=True,exist_ok=True)
            shutil.copyfile(source,snapshot/name);(snapshot/name).chmod(0o600)
        if (ROOT/'secrets').is_symlink()or not(ROOT/'secrets').is_dir():raise ValueError('Unsafe private mail secrets')
        shutil.copytree(ROOT/'secrets',snapshot/'secrets',symlinks=True)
        for item in (snapshot/'secrets').rglob('*'):
            if item.is_symlink()or not item.is_file():raise ValueError('Unexpected link in mail secrets')
            item.chmod(0o600)
        for item in snapshot.rglob('*'):
            if item.is_file():manifest['files'][item.relative_to(snapshot).as_posix()]=files.checksum(item)
        for name in ['gateway-data','smtp-data']:
            volume=PROJECT+'_'+name;image=pin['gatewayImage']
            before=files.inventory(image,volume);target=snapshot/(name+'.tar')
            with target.open('xb')as output:
                result=subprocess.run(files.command(image,volume)+['tar',image,'--numeric-owner','-cpf','-','-C','/snapshot','.'],stdout=output,stderr=subprocess.PIPE)
                if result.returncode:raise RuntimeError('Mail archive failed; preserve source volume')
            target.chmod(0o600)
            with tarfile.open(target)as archive:files.validate_archive(archive)
            if files.inventory(image,volume)!=before:raise RuntimeError('Cold mail volume changed during snapshot')
            manifest['volumes'][name]={'sha256':files.checksum(target),'entries':before}
        (snapshot/'backup-manifest.json').write_text(json.dumps(manifest));(snapshot/'backup-manifest.json').chmod(0o600)
    finally:
        restart_errors=[]
        for name in reversed(active):
            try:files.run(['docker','start',PROJECT+'-'+name+'-1'])
            except Exception as error:restart_errors.append(error)
        if restart_errors:raise RuntimeError('Owned mail restart failed; inspect both services and preserve snapshot')from restart_errors[0]
    print('Owned mail cold snapshot completed; both original volumes and keys preserved:',snapshot)
    return snapshot


def drill(snapshot):
    validate_snapshot(snapshot)
    manifest=json.loads((snapshot/'backup-manifest.json').read_text())
    if manifest['version']!=1 or set(manifest['volumes'])!={'gateway-data','smtp-data'}:
        raise ValueError('Mail restore manifest differs')
    for name in ['compose.json','maddy.conf','manifest.json','secrets/encryption.key','secrets/signing.secret']:
        if name not in manifest['files']:raise ValueError('Missing mail configuration/key checksum')
    restored_pin=json.loads((snapshot/'manifest.json').read_text())
    if restored_pin.get('configRevision') is not None:
        for name in attachment_records(snapshot, restored_pin):
            if name not in manifest['files']:raise ValueError('Attachment recovery acknowledgement missing from checksums')
    for name,digest in manifest['files'].items():
        relative=Path(name)
        if relative.is_absolute()or '..'in relative.parts or (snapshot/relative).is_symlink()or files.checksum(snapshot/relative)!=digest:
            raise ValueError('Mail configuration/key checksum differs')
    image=manifest['gatewayImage']
    if not __import__('re').fullmatch('sha256:[a-f0-9]{64}',image):raise ValueError('Invalid restore image')
    # Check key custody too, without printing any credential or decrypting mail.
    if len(__import__('base64').b64decode((snapshot/'secrets/encryption.key').read_bytes(),validate=True))!=32 or len((snapshot/'secrets/signing.secret').read_bytes())<32:
        raise ValueError('Private mail key snapshot invalid')
    for name,expected in manifest['volumes'].items():
        target=snapshot/(name+'.tar')
        if files.checksum(target)!=expected['sha256']:raise ValueError('Mail archive checksum differs')
        with tarfile.open(target)as archive:files.validate_archive(archive)
        volume='codexdentist-mail-restore-'+uuid.uuid4().hex
        files.run(['docker','volume','create','--label','com.codexdentist.restore='+volume,volume])
        try:
            with target.open('rb')as data:files.run(files.command(image,volume,True)+['tar',image,'--numeric-owner','-xpf','-','-C','/snapshot'],stdin=data)
            if files.inventory(image,volume)!=expected['entries']:raise RuntimeError('Restored mail bytes/private modes differ')
            if name=='gateway-data' and any(row[0]=='queue.sqlite'for row in expected['entries']):
                check='''const{DatabaseSync}=require("node:sqlite"),fs=require("fs"),crypto=require("crypto");
const db=new DatabaseSync("/snapshot/queue.sqlite");
try{if(db.prepare("PRAGMA integrity_check").get().integrity_check!=="ok")throw Error();
const probe=Buffer.from(db.prepare("SELECT value FROM mail_meta WHERE name='key-check'").get().value);
const key=Buffer.from(fs.readFileSync(0,"utf8").trim(),"base64");if(key.length!==32||probe[0]!==1)throw Error();
const cipher=crypto.createDecipheriv("aes-256-gcm",key,probe.subarray(1,13));
cipher.setAAD(Buffer.from("mail-store\\nkey-check\\nversion-1"));cipher.setAuthTag(probe.subarray(13,29));
if(JSON.parse(Buffer.concat([cipher.update(probe.subarray(29)),cipher.final()]).toString("utf8")).version!==1)throw Error();
}finally{db.close()}'''
                args=files.command(image,volume)
                # SQLite may need to recover its WAL/shared-memory files. Only
                # this disposable restored volume is writable, as UID 1000;
                # the source snapshot/queue and root filesystem remain untouched.
                args=[value.removesuffix(',readonly')if value.startswith('type=volume,')else value for value in args]
                files.run(args[:-1]+['--user','1000:1000','-i',args[-1],'node',image,'-e',check],input=(snapshot/'secrets/encryption.key').read_bytes())
        finally:
            if inspect('volume',volume).get('Labels',{}).get('com.codexdentist.restore')!=volume:raise ValueError('Restore volume ownership differs')
            files.run(['docker','volume','rm',volume])
    (snapshot/'restore-verified').write_text('Both mail volumes, all checksums, private modes, key presence and SQLite integrity verified without mail workers/network\n')
    print('Owned mail restore passed; no restored worker or delivery started.')


def main():
    parser=argparse.ArgumentParser();parser.add_argument('action',choices=['backup','drill']);parser.add_argument('--snapshot');args=parser.parse_args()
    if os.geteuid()!=0 or ROOT.is_symlink()or ROOT.stat().st_uid!=0 or ROOT.stat().st_mode&0o077:raise ValueError('Private root-owned mail installation required')
    os.umask(0o077)
    import fcntl
    with(ROOT/'operations.lock').open('a')as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        if args.action=='backup':
            if args.snapshot:raise ValueError('Backup creates its own unique snapshot')
            drill(backup())
        else:
            if not args.snapshot:raise ValueError('Explicit completed snapshot required')
            drill(Path(args.snapshot))


if __name__=='__main__':main()
