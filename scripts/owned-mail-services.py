#!/usr/bin/env python3
"""Opt-in owned SMTP: prepare private keys, no published port or core DB access."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import subprocess

MADDY = 'ghcr.io/foxcpp/maddy@sha256:e1074e92a452b84d1135ebe8ab831c5f541d33dcbd39e38fab740a53bbf2f97c'
PROJECT = 'codexdentist-owned-mail'
ROOT = Path('/opt/codexdentist-owned-mail')


def run(args, **kwargs):
    result = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, **kwargs)
    if result.returncode:
        raise RuntimeError('Owned mail operator command failed; inspect private state, preserve existing data')
    return result.stdout


def configuration(gateway_image):
    if not re.fullmatch(r'sha256:[a-f0-9]{64}', gateway_image):
        raise ValueError('Pin the built gateway image by its exact local digest')
    limits = dict(restart='unless-stopped', user='1000:1000', read_only=True, cap_drop=['ALL'],
        security_opt=['no-new-privileges:true'], pids_limit=128, cpus=1.0, mem_limit='384m',
        tmpfs=['/tmp:rw,nosuid,noexec,size=32m,uid=1000,gid=1000,mode=0700'],
        logging={'driver':'json-file','options':{'max-size':'2m','max-file':'2'}})
    secrets_names=['signing.secret','encryption.key','gateway.key.pem','gateway.cert.pem','smtp.cert.pem']
    gateway = {**limits, 'image':gateway_image, 'environment':{
        'OWNED_MAIL_DATA_ROOT':'/data/mail', 'OWNED_MAIL_FROM':'no-reply@codexdentist.com',
        'OWNED_MAIL_TEST_ONLY':'true', 'OWNED_MAIL_SMTP_HOST':'codexdentist-mail-smtp', 'OWNED_MAIL_SMTP_PORT':'2465',
        'OWNED_MAIL_SIGNING_SECRET_FILE':'/secrets/signing.secret', 'OWNED_MAIL_ENCRYPTION_KEY_FILE':'/secrets/encryption.key',
        'OWNED_MAIL_TLS_KEY_FILE':'/secrets/gateway.key.pem', 'OWNED_MAIL_TLS_CERT_FILE':'/secrets/gateway.cert.pem',
        'OWNED_MAIL_SMTP_CA_FILE':'/secrets/smtp.cert.pem'},
        'volumes':[{'type':'volume','source':'gateway-data','target':'/data/mail','volume':{'nocopy':True}}] + [
            {'type':'bind','source':'./secrets/'+name,'target':'/secrets/'+name,'read_only':True} for name in secrets_names],
        'networks':{'gateway':{'aliases':['codexdentist-mail-gateway']},'smtp':{}}, 'depends_on':['smtp']}
    smtp = {**limits, 'image':MADDY, 'entrypoint':['sh','-c','umask 077; exec maddy --config /conf/maddy.conf run'],
        'volumes':[{'type':'volume','source':'smtp-data','target':'/data','volume':{'nocopy':True}},
            {'type':'bind','source':'./maddy.conf','target':'/conf/maddy.conf','read_only':True}] + [
            {'type':'bind','source':'./secrets/'+name,'target':'/secrets/'+name,'read_only':True} for name in ['smtp.key.pem','smtp.cert.pem']],
        # No outbound network until a separate DNS/delivery review. Prepare/up
        # cannot send messages out of this isolated private mail network.
        'networks':{'smtp':{'aliases':['codexdentist-mail-smtp']}}}
    return {'name':PROJECT,'services':{'gateway':gateway,'smtp':smtp},
        'networks':{'gateway':{'internal':True},'smtp':{'internal':True}},
        'volumes':{name:{'name':PROJECT+'_'+name,'labels':{'com.codexdentist.mail':name}}for name in ['gateway-data','smtp-data']}}


def write_private(target, data, app_readable=False):
    fd=os.open(target,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'wb')as output:
        output.write(data);output.flush();os.fsync(output.fileno())
    if app_readable:
        os.chown(target,1000,1000)


def prepare(directory, base_image, hostname):
    if not re.fullmatch(r'codexdentist:[a-f0-9]{40}',base_image) or not re.fullmatch(r'[a-z0-9][a-z0-9.-]{1,251}[a-z0-9]',hostname):
        raise ValueError('Reviewed app image and verified outbound hostname required')
    revision=base_image.split(':',1)[1]
    source=Path('/opt/codexdentist-deploy/releases')/revision
    if run(['git','-C',str(source),'rev-parse','HEAD']).decode().strip()!=revision or run(['git','-C',str(source),'status','--porcelain']).strip():
        raise ValueError('Clean exact-revision source required')
    image=json.loads(run(['docker','image','inspect',base_image]))[0]
    if image['Config'].get('Labels',{}).get('org.opencontainers.image.revision')!=revision:
        raise ValueError('Base image identity differs')
    run(['docker','run','--rm','--network','none','--read-only','--cap-drop','ALL','--entrypoint','node',base_image,'-e',
        'if(require("nodemailer/package.json").version!=="10.4.0")process.exitCode=1;require("node:sqlite")'])
    if directory.exists():
        raise ValueError('Existing owned mail installation must be verified/upgraded, never replaced by prepare')
    directory.mkdir(mode=0o700)
    private=directory/'secrets';private.mkdir(mode=0o700)
    write_private(private/'signing.secret',secrets.token_hex(32).encode(),True)
    write_private(private/'encryption.key',__import__('base64').b64encode(secrets.token_bytes(32)),True)
    for name in ['gateway','smtp']:
        identity='codexdentist-mail-'+name
        key,cert=private/(name+'.key.pem'),private/(name+'.cert.pem')
        run(['openssl','req','-x509','-newkey','rsa:3072','-nodes','-sha256','-days','365',
            '-subj','/CN='+identity,'-addext','subjectAltName=DNS:'+identity,'-keyout',str(key),'-out',str(cert)])
        for target in [key,cert]:target.chmod(0o600);os.chown(target,1000,1000)
    template=(source/'scripts/owned-mail/maddy.conf').read_text()
    if template.count('hostname mail.codexdentist.com')!=1:
        raise ValueError('Outbound hostname template differs')
    write_private(directory/'maddy.conf',template.replace('hostname mail.codexdentist.com','hostname '+hostname).encode(),True)
    tag='codexdentist-mail-gateway:'+revision
    run(['docker','build','--network','none','--build-arg','BASE_IMAGE='+base_image,'-f',str(source/'scripts/owned-mail/Dockerfile'),'-t',tag,str(source)])
    built=json.loads(run(['docker','image','inspect',tag]))[0]['Id']
    config=configuration(built)
    write_private(directory/'compose.json',json.dumps(config).encode())
    write_private(directory/'manifest.json',json.dumps({'version':1,'revision':revision,'gatewayImage':built,'smtpImage':MADDY,
        'outboundHostname':hostname,'outboundEnabled':False,'sourceConfigSha256':hashlib.sha256(template.encode()).hexdigest()}).encode())
    # Initialise only brand-new labelled volumes, without Docker copy-up.
    for name,target in [('gateway-data','/data/mail'),('smtp-data','/data')]:
        volume=PROJECT+'_'+name
        existing=subprocess.run(['docker','volume','inspect',volume],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        if existing.returncode==0:
            raise ValueError('Preserve pre-existing mail volume; review its identity and data')
        run(['docker','volume','create','--label','com.codexdentist.mail='+name,volume])
        run(['docker','run','--rm','--network','none','--read-only','--user','0:0','--cap-drop','ALL','--cap-add','CHOWN','--cap-add','FOWNER',
            '--mount',f'type=volume,source={volume},target={target},volume-nocopy','--entrypoint','node',base_image,'-e',
            'const fs=require("fs"),p='+json.dumps(target)+';if(fs.readdirSync(p).length)throw Error();fs.chmodSync(p,0o700);fs.chownSync(p,1000,1000)'])
    print('Prepared private TLS, independent mail keys and isolated labelled volumes; no core change or outbound delivery.')


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action',choices=['prepare','up','status']);parser.add_argument('--directory',default=str(ROOT))
    parser.add_argument('--base-image');parser.add_argument('--hostname');args=parser.parse_args()
    if os.geteuid()!=0:raise ValueError('Root-owned operator execution required')
    os.umask(0o077);directory=Path(args.directory)
    if directory!=ROOT:raise ValueError('Use only the explicitly owned installation directory')
    if args.action=='prepare':prepare(directory,args.base_image or '',args.hostname or '');return
    if directory.is_symlink()or directory.stat().st_uid!=0 or directory.stat().st_mode&0o077:
        raise ValueError('Private owned installation required')
    pin=json.loads((directory/'manifest.json').read_text())
    expected=configuration(pin['gatewayImage'])
    if json.loads((directory/'compose.json').read_text())!=expected or pin['outboundEnabled']:
        raise ValueError('Prepared configuration changed; requires a separately reviewed activation')
    if args.action=='up':
        source=Path('/opt/codexdentist-deploy/releases')/pin['revision']
        original=(source/'scripts/owned-mail/maddy.conf').read_text()
        if hashlib.sha256(original.encode()).hexdigest()!=pin['sourceConfigSha256'] or (directory/'maddy.conf').read_text()!=original.replace('hostname mail.codexdentist.com','hostname '+pin['outboundHostname']):
            raise ValueError('Preserve changed SMTP configuration for review')
        run(['docker','compose','--project-directory',str(directory),'-f',str(directory/'compose.json'),'up','-d','--pull','never'])
        print('Started only private test-restricted mail services; no published ports, external network or core configuration change.')
    else:
        for name in ['gateway','smtp']:
            info=json.loads(run(['docker','inspect',PROJECT+'-'+name+'-1']))[0]
            if not info['State']['Running'] or info['HostConfig'].get('PortBindings') or not info['HostConfig']['ReadonlyRootfs'] or info['Config']['User']!='1000:1000':
                raise ValueError('Mail isolation/runtime guard failed')
            if info['Config']['Image']!=expected['services'][name]['image']:
                raise ValueError('Running mail image differs from its reviewed pin')
            wanted={PROJECT+'_'+key for key in expected['services'][name]['networks']}
            if set(info['NetworkSettings']['Networks'])!=wanted:
                raise ValueError('Unexpected mail network membership')
            for network in info['NetworkSettings']['Networks']:
                if not json.loads(run(['docker','network','inspect',network]))[0]['Internal']:
                    raise ValueError('Unexpected outbound mail network before activation')
        print('PASS prepared private mail services: unprivileged, read-only root, no public port or outbound network.')


if __name__=='__main__':main()
