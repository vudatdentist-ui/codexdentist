#!/usr/bin/env python3
"""Cold snapshot and isolated restore drill for the owned optional service stack.

Only codexdentist-optional containers/volumes are stopped or archived. Core clinic
services are never accessed. Restore containers have private networks, no host
ports and no application/message workers. The original volumes are never reused
as restore targets. Keep the root-private snapshot with the core DB/vault backup.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
import re
from pathlib import Path
import secrets
import subprocess
import tarfile
import time

PROFILES = ['imaging','medplum','chatwoot','novu']
TABLES = {'medplum-db':['User','Project','ClientApplication','Patient'],
          'chatwoot-db':['users','accounts','inboxes','contacts','conversations']}

def run(*args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)

def output(*args):
    return run(*args,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True).stdout.strip()

def compose(path, profiles):
    command = ['docker','compose','-f',str(path)]
    for profile in profiles:
        command += ['--profile',profile]
    return command

def container(project, service):
    return project+'-'+service+'-1'

def counts(project, config, keys):
    result = {}
    for service,tables in TABLES.items():
        if service not in config['services']:continue
        env = config['services'][service]['environment']
        for table in tables:
            sql = 'SELECT count(*) FROM "'+table+'"'
            result[service+'/'+table] = output('docker','exec',container(project,service),'psql','-U',env['POSTGRES_USER'],
                '-d',env['POSTGRES_DB'],'-At','-c',sql)
    if 'novu-db' in config['services']:
        result['novu-db/collections'] = output('docker','exec',container(project,'novu-db'),'mongosh','--quiet',
            '--username','novu','--password',keys['novu-db'],'--authenticationDatabase','admin','--eval',
            'JSON.stringify(db.getSiblingDB("novu").getCollectionNames().sort().map(n=>[n,db.getSiblingDB("novu").getCollection(n).countDocuments({})]))')
    return result

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action',choices=['backup','drill'])
    parser.add_argument('--directory',default='/opt/codexdentist-optional')
    parser.add_argument('--snapshot',help='Existing completed snapshot for drill')
    parser.add_argument('--profiles',nargs='+',choices=PROFILES,help='Required for backup; only explicitly selected profiles are paused/copied.')
    args = parser.parse_args()
    directory = Path(args.directory).resolve()
    if os.geteuid()!=0 or directory.stat().st_uid!=0 or directory.stat().st_mode & 0o077:
        raise SystemExit('Root-owned mode-0700 service directory required.')
    config_file = directory/'compose.json'
    config = json.loads(config_file.read_text())
    assert config['name']=='codexdentist-optional', 'Unexpected source project'
    keys = json.loads((directory/'secrets.json').read_text())
    os.umask(0o077)
    if args.action=='backup':
        assert args.profiles, 'Select the profiles to back up'
        profiles=args.profiles
        config['services']={name:service for name,service in config['services'].items() if any(p in profiles for p in service['profiles'])}
        used={mount.split(':')[0] for service in config['services'].values() for mount in service.get('volumes',[])}
        config['volumes']={name:value for name,value in config['volumes'].items() if name in used}
        stamp=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'-'+secrets.token_hex(4)
        backup=directory/'backups'/stamp
        backup.mkdir(parents=True,mode=0o700)
        (backup/'compose.json').write_text(json.dumps(config))
        with tarfile.open(backup/'private-configuration.tar.gz','w:gz') as archive:
            for file in ['secrets.json','image-lock.json','acceptance.json','bootstrap-output']:
                path=directory/file
                if path.exists():archive.add(path,arcname=file)
        running=[name for name in output('docker','ps','--filter','label=com.docker.compose.project=codexdentist-optional','--format','{{.Names}}').splitlines()
            if name in {container(config['name'],service) for service in config['services']}]
        writers=[name for name in running if not any(name==container(config['name'],s) for s in ['medplum-db','chatwoot-db','novu-db'])]
        manifest={'project':config['name'],'profiles':profiles,'createdAt':stamp,'volumes':{},'counts':{},'files':{}}
        try:
            if writers:run('docker','stop',*writers,stdout=subprocess.DEVNULL)
            manifest['counts']=counts(config['name'],config,keys)
            databases=[name for name in running if name not in writers]
            if databases:run('docker','stop',*databases,stdout=subprocess.DEVNULL)
            for short in config['volumes']:
                full=config['name']+'_'+short
                found=subprocess.run(['docker','volume','inspect',full],capture_output=True,text=True)
                if found.returncode:continue  # An explicitly unstarted profile has no data.
                volume=json.loads(found.stdout)[0]
                assert volume.get('Labels',{}).get('com.docker.compose.project')==config['name'], 'Foreign source volume'
                source=Path(volume['Mountpoint']).resolve()
                assert source.name=='_data' and source.parent.name==full, 'Unexpected volume mountpoint'
                target=backup/(short+'.tar.gz')
                run('tar','-czf',str(target),'-C',str(source),'.',stdout=subprocess.DEVNULL)
                manifest['volumes'][short]=target.name
        finally:
            # Even a failed snapshot must restore service availability. No volume
            # is deleted and an incomplete directory has no completed manifest.
            run(*compose(config_file,profiles),'up','-d',stdout=subprocess.DEVNULL)
        for path in backup.iterdir():
            if path.is_file():
                with path.open('rb') as stream:
                    manifest['files'][path.name]=hashlib.file_digest(stream,'sha256').hexdigest()
        (backup/'manifest.json').write_text(json.dumps(manifest,indent=2))
        print('Completed root-private cold snapshot:',backup)
        return
    backup=Path(args.snapshot or '').resolve()
    assert backup.is_relative_to(directory/'backups') and backup.parent==directory/'backups', 'Snapshot outside owned backup directory'
    manifest=json.loads((backup/'manifest.json').read_text())
    assert manifest['project']==config['name']
    profiles=manifest['profiles']
    assert profiles and all(profile in PROFILES for profile in profiles)
    for file,digest in manifest['files'].items():
        path=(backup/file).resolve()
        assert path.parent==backup and path.is_file(), 'Unsafe snapshot file'
        with path.open('rb') as stream:assert hashlib.file_digest(stream,'sha256').hexdigest()==digest, 'Snapshot checksum mismatch'
    # Use the exact captured settings/keys, not current rotated service credentials.
    config=json.loads((backup/'compose.json').read_text())
    with tarfile.open(backup/'private-configuration.tar.gz','r:gz') as archive:
        keys=json.load(archive.extractfile('secrets.json'))
    project='codexdentist-restore-'+secrets.token_hex(8)
    assert project.startswith('codexdentist-restore-') and project!=manifest['project']
    config['name']=project
    for service in config['services'].values():
        service.pop('ports',None)
        service['restart']='no'
    for name in config['networks']:config['networks'][name]={'internal':True}
    config['volumes']={name:{} for name in config['volumes']}
    drill=backup/('drill-'+project+'.json')
    drill.write_text(json.dumps(config))
    created=[]
    try:
        for short,file in manifest['volumes'].items():
            assert re.fullmatch('[a-z0-9][a-z0-9_-]{0,63}',short) and file in manifest['files'], 'Unsafe volume archive'
            full=project+'_'+short
            run('docker','volume','create','--label','com.codexdentist.restore='+project,
                '--label','com.docker.compose.project='+project,'--label','com.docker.compose.volume='+short,full,stdout=subprocess.DEVNULL)
            created.append(full)
            destination=Path(json.loads(output('docker','volume','inspect',full))[0]['Mountpoint']).resolve()
            assert destination.name=='_data' and destination.parent.name==full
            with tarfile.open(backup/file,'r:gz') as archive:
                archive.extractall(destination,filter='data')
        # No API, queue, mail or notification worker runs from restored records.
        services=[name for name in ['medplum-db','chatwoot-db','novu-db','orthanc'] if name in config['services']]
        run(*compose(drill,profiles),'up','-d','--no-deps',*services,stdout=subprocess.DEVNULL)
        ready=False
        for attempt in range(60):
            try:
                restored=counts(project,config,keys)
                ready=True;break
            except subprocess.CalledProcessError:
                time.sleep(1)
        assert ready and restored==manifest['counts'], 'Restored provider record counts differ'
        # Orthanc must open its restored index and authenticated HTTP listener.
        probe='import json,os,urllib.request,base64; users=json.loads(os.environ["ORTHANC__REGISTERED_USERS"]); u,p=next(iter(users.items())); r=urllib.request.Request("http://127.0.0.1:8042/system",headers={"Authorization":"Basic "+base64.b64encode((u+":"+p).encode()).decode()}); print(json.load(urllib.request.urlopen(r))["Name"])'
        if 'orthanc' in services:
            name=output('docker','exec',container(project,'orthanc'),'python3','-c',probe)
            assert name=='Codexdentist private archive','Restored PACS identity mismatch'
        (backup/'restore-proof.json').write_text(json.dumps({'project':project,'countsMatch':True,'privatePacsOpened':True,'sourceVolumesUntouched':True},indent=2))
        print('PASS isolated restore: both PostgreSQL stores, MongoDB counts and authenticated PACS index; original volumes untouched')
    finally:
        run(*compose(drill,profiles),'down','--remove-orphans',stdout=subprocess.DEVNULL)
        for full in created:
            assert full.startswith(project+'_')
            run('docker','volume','rm',full,stdout=subprocess.DEVNULL)

if __name__=='__main__':
    try:
        main()
    except subprocess.CalledProcessError as error:
        # Driver argv can include database credentials. Never print it in a traceback.
        raise SystemExit('Provider backup/restore command failed (exit '+str(error.returncode)+').') from None
