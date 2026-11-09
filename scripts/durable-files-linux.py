#!/usr/bin/env python3
"""Disposable Linux/volume/S3/PostgreSQL acceptance; never joins core networks."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import time
import uuid


def run(args, **kwargs):
    result = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, **kwargs)
    if result.returncode:
        raise RuntimeError(result.stdout.decode(errors='replace'))
    return result.stdout


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--image',required=True)
    parser.add_argument('--source',required=True);parser.add_argument('--output',required=True);args=parser.parse_args()
    os.umask(0o077)
    source=Path(args.source).resolve();output=Path(args.output).resolve()/uuid.uuid4().hex;output.mkdir(parents=True,mode=0o700)
    assert (source/'scripts/durable-files-migration-native.mjs').is_file()
    image=json.loads(run(['docker','image','inspect',args.image]))[0]['Id']
    token=uuid.uuid4().hex;volume='codexdentist-files-test-'+token;postgres='codexdentist-files-pg-'+token;carrier='codexdentist-files-carrier-'+token
    label='com.codexdentist.test='+token;created=[]
    mount=f'type=volume,source={volume},target=/data/patient-files,volume-nocopy'
    run(['docker','volume','create','--label',label,'--label','com.codexdentist.storage=patient-files',volume])
    try:
        run(['docker','run','--rm','--network','none','--user','0:0','--mount',mount,'--entrypoint','sh',image,'-c',
            'chown 1000:1000 /data/patient-files && chmod 700 /data/patient-files'])
        common=['docker','run','--rm','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--memory','768m','--cpus','2',
            '--mount',f'type=bind,source={source},target=/proof,readonly','-w','/proof','-e','NODE_ENV=test','-e','DURABLE_FILE_NATIVE_TEST=true',
            '-e','PATIENT_FILE_LOCAL_DURABLE=true','-e','PATIENT_FILE_STORAGE_ROOT=/data/patient-files',
            '-e','DATABASE_URL=postgresql://postgres:synthetic-test-only@127.0.0.1:5432/durable_files_native_test']
        entry=['--entrypoint','node',image,'--disable-warning=MODULE_TYPELESS_PACKAGE_JSON','--experimental-transform-types',
            '--experimental-loader','./scripts/ts-alias-loader.mjs']
        for case,user,volume_mount,reject in [('private','1000:1000',mount,False),('readonly','1000:1000',mount+',readonly',True),
            ('root','0:0',mount,True),('unmounted','1000:1000',None,True)]:
            result=run(common+['--network','none','--user',user]+(['--mount',volume_mount] if volume_mount else [])+entry+
                ['scripts/durable-files-native.mjs']+(['--expect-rejected'] if reject else []))
            (output/(case+'.log')).write_bytes(result);print('PASS native volume',case,flush=True)
        run(['docker','run','-d','--name',postgres,'--label',label,'--network','none','--memory','512m','--cpus','1',
            '--tmpfs','/var/lib/postgresql/data:size=256m','-e','POSTGRES_PASSWORD=synthetic-test-only',
            '-e','POSTGRES_DB=durable_files_native_test','postgres:17-alpine']);created.append(postgres)
        for _ in range(60):
            ready=subprocess.run(['docker','exec',postgres,'pg_isready','-U','postgres','-d','durable_files_native_test'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
            if ready.returncode==0:break
            time.sleep(1)
        else:raise RuntimeError('Disposable PostgreSQL not ready')
        result=run(common+['--network','container:'+postgres,'--user','1000:1000','--mount',mount]+entry+
            ['scripts/durable-files-migration-native.mjs'])
        (output/'migration.log').write_bytes(result);print(result.decode().splitlines()[-1],flush=True)
        # Exercise the actual backup/drill implementation against only this carrier.
        run(['docker','run','-d','--name',carrier,'--label',label,'--network','none','--read-only','--user','1000:1000',
            '--mount',mount,'-e','PATIENT_FILE_LOCAL_DURABLE=true','-e','PATIENT_FILE_STORAGE_ROOT=/data/patient-files',
            '--entrypoint','sleep',image,'120']);created.append(carrier)
        spec=importlib.util.spec_from_file_location('private_backup',source/'scripts/patient-file-backup.py')
        backup=importlib.util.module_from_spec(spec);spec.loader.exec_module(backup);backup.CONTAINER=carrier
        run(['docker','pause',carrier])
        try:backup.backup(output/'snapshot')
        finally:run(['docker','unpause',carrier])
        backup.drill(output/'snapshot')
        print('PASS isolated complete file snapshot and checksum/private-mode restore',flush=True)
    finally:
        for name in reversed(created):
            current=json.loads(run(['docker','inspect',name]))[0]
            assert current['Config']['Labels'].get('com.codexdentist.test')==token
            run(['docker','rm','-f',name])
        current=json.loads(run(['docker','volume','inspect',volume]))[0]
        assert current['Labels'].get('com.codexdentist.test')==token
        run(['docker','volume','rm',volume])


if __name__=='__main__':main()
