#!/usr/bin/env python3
"""Real pinned MTA acceptance on disposable networkless volumes; no core access."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import time
import uuid

spec=importlib.util.spec_from_file_location('owned_mail',Path(__file__).with_name('owned-mail-services.py'))
mail=importlib.util.module_from_spec(spec);spec.loader.exec_module(mail)


def run(args):
    result=subprocess.run(args,capture_output=True)
    if result.returncode:raise RuntimeError(result.stdout.decode(errors='replace')+result.stderr.decode(errors='replace'))
    return result.stdout


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--image',required=True);parser.add_argument('--source',required=True);parser.add_argument('--output',required=True);args=parser.parse_args()
    source=Path(args.source).resolve();assert(source/'scripts/owned-mail-maddy-native.mjs').is_file()
    if not hasattr(os,'geteuid')or os.geteuid()!=0:raise ValueError('Run this disposable Linux backup/restore gate as root; no production credentials are used')
    output=Path(args.output).resolve()/uuid.uuid4().hex;output.mkdir(parents=True,mode=0o700)
    image=json.loads(run(['docker','image','inspect',args.image]))[0]['Id'];run(['docker','pull',mail.MADDY])
    token=uuid.uuid4().hex;project='cdx-mail-'+token
    names={'accept':project+'_gateway-data','data':project+'_smtp-data'};containers=[];volumes=[]
    node=project+'-gateway-1';mta=project+'-smtp-1';namespace=project+'-namespace'
    try:
        run(['docker','run','-d','--name',namespace,'--label','com.codexdentist.mail-test='+token,'--network','none',
            '--read-only','--user','1000:1000','--cap-drop','ALL','--security-opt','no-new-privileges',
            '--memory','64m','--cpus','0.1','--entrypoint','node',image,'-e','setInterval(()=>{},60000)']);containers.append(namespace)
        for kind,name in names.items():
            run(['docker','volume','create','--label','com.codexdentist.mail-test='+token,'--label','com.codexdentist.mail='+('gateway-data'if kind=='accept'else'smtp-data'),name]);volumes.append(name)
            run(['docker','run','--rm','--network','none','--user','0:0','--mount',f'type=volume,source={name},target=/init,volume-nocopy',
                '--entrypoint','node',image,'-e','const fs=require("fs");fs.chmodSync("/init",0o700);fs.chownSync("/init",1000,1000)'])
        run(['docker','run','-d','--name',node,'--label','com.codexdentist.mail-test='+token,'--network','container:'+namespace,'--read-only',
            '--user','1000:1000','--cap-drop','ALL','--security-opt','no-new-privileges','--memory','512m','--cpus','1',
            '--tmpfs','/tmp:rw,nosuid,size=64m,uid=1000,gid=1000,mode=0700',
            '--mount',f'type=bind,source={source},target=/proof,readonly',
            '--mount',f'type=volume,source={names["accept"]},target=/accept,volume-nocopy',
            '--mount',f'type=volume,source={names["data"]},target=/maddy-data,volume-nocopy,readonly',
            '-w','/proof','-e','OWNED_MAIL_NATIVE_TEST=true','--entrypoint','node',image,'scripts/owned-mail-maddy-native.mjs']);containers.append(node)
        for _ in range(60):
            ready=subprocess.run(['docker','exec',node,'test','-f','/accept/ready'],capture_output=True)
            if ready.returncode==0:break
            if not json.loads(run(['docker','inspect',node]))[0]['State']['Running']:raise RuntimeError('Private synthetic fixture exited before MTA start')
            time.sleep(1)
        else:raise RuntimeError('Private synthetic fixture did not become ready')
        run(['docker','run','-d','--name',mta,'--label','com.codexdentist.mail-test='+token,'--network','container:'+namespace,
            '--read-only','--user','1000:1000','--cap-drop','ALL','--security-opt','no-new-privileges','--memory','256m','--cpus','1',
            '--tmpfs','/tmp:rw,nosuid,size=32m,uid=1000,gid=1000,mode=0700',
            '--mount',f'type=volume,source={names["accept"]},target=/accept,volume-nocopy,readonly',
            '--mount',f'type=volume,source={names["data"]},target=/data,volume-nocopy',
            '--entrypoint','sh',mail.MADDY,'-c','umask 077; exec maddy --config /accept/maddy.conf run']);containers.append(mta)
        for _ in range(90):
            info=json.loads(run(['docker','inspect',node]))[0]
            if not info['State']['Running']:break
            time.sleep(1)
        else:raise RuntimeError('MTA fixture exceeded its bounded acceptance time')
        for name in containers:
            logs=subprocess.run(['docker','logs',name],capture_output=True);(output/(name+'.log')).write_bytes(logs.stdout+logs.stderr)
        if info['State']['ExitCode']!=0:raise RuntimeError('Synthetic real-MTA acceptance failed; inspect its private test logs: '+str(output))
        run(['docker','cp',node+':/accept/result.json',str(output/'result.json')])
        result=json.loads((output/'result.json').read_text());assert result['pass']and result['externalNetwork']is False
        # Exercise the real stopped-worker backup and restore with these two
        # labelled synthetic services/volumes, never the production installation.
        if os.geteuid()==0:
            spec=importlib.util.spec_from_file_location('mail_backup',source/'scripts/owned-mail-backup.py')
            backup=importlib.util.module_from_spec(spec);spec.loader.exec_module(backup)
            installation=output/'installation';installation.mkdir(mode=0o700);(installation/'secrets').mkdir(mode=0o700)
            (installation/'manifest.json').write_text(json.dumps({'version':1,'gatewayImage':image,'smtpImage':mail.MADDY}))
            (installation/'compose.json').write_text('{}');(installation/'maddy.conf').write_text('synthetic acceptance only\n')
            for name in ['encryption.key','signing.secret']:
                run(['docker','cp',node+':/accept/'+name,str(installation/'secrets'/name)]);(installation/'secrets'/name).chmod(0o600)
            backup.ROOT=installation;backup.PROJECT=project
            snapshot=backup.backup();backup.drill(snapshot)
            for target in [snapshot/'gateway-data.tar',snapshot/'secrets/signing.secret']:
                original=target.read_bytes()
                try:
                    target.write_bytes(original+b'corrupted synthetic snapshot')
                    try:backup.drill(snapshot)
                    except ValueError:pass
                    else:raise AssertionError('Corrupted mail snapshot must fail closed')
                finally:target.write_bytes(original)
            print('PASS actual mail volume/key snapshot and isolated SQLite-key/queue restore without workers or network.')
        print('PASS pinned real Maddy TLS, durable queue, DKIM cryptographic signature/tamper check, sender denial and exact idempotent delivery; no external network.')
    finally:
        for name in reversed(containers):
            info=json.loads(run(['docker','inspect',name]))[0];assert info['Config']['Labels'].get('com.codexdentist.mail-test')==token
            run(['docker','rm','-f',name])
        for name in volumes:
            info=json.loads(run(['docker','volume','inspect',name]))[0];assert info['Labels'].get('com.codexdentist.mail-test')==token
            run(['docker','volume','rm',name])


if __name__=='__main__':main()
