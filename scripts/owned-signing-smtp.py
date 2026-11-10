#!/usr/bin/env python3
"""Private main-only owned SMTP; global and QA mail remain captured."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import secrets
import subprocess


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module


signing = load('smtp_signing', 'owned-signing-services.py')
recovery = load('smtp_recovery', 'owned-signing-backup.py')
bootstrap = load('smtp_bootstrap', 'owned-signing-bootstrap.py')
MAIL_ROOT = Path('/opt/codexdentist-owned-mail')
GATEWAY_PROJECT = 'codexdentist-owned-signing-gateway'
CALLBACK_PROJECT = 'codexdentist-signing-callback'
SMTP_MEMBERS = ['codexdentist-owned-mail-gateway-1', 'codexdentist-owned-mail-smtp-1']
ADMIN_RECORDS = ['smtp-admin.intent.json', 'smtp-admin.api-result.json', 'smtp-admin.completed.json']
SMTP_RECORDS = ['smtp.intent.json', 'smtp.api-result.json', 'smtp.completed.json']


def client(value, record=None):
    shared = Path(__file__).with_name('owned-signing-bootstrap-client.cjs').read_text()
    code = Path(__file__).with_name('owned-signing-smtp-client.cjs').read_text().replace(
        "require('./owned-signing-bootstrap-client.cjs')", "(()=>{const module={exports:{}};" + shared + ";return module.exports})()", 1)
    code += "\nmodule.exports.run(JSON.parse(require('node:fs').readFileSync(0,'utf8'))).then(r=>{console.log(JSON.stringify(r));if(!r.pass)process.exitCode=1}).catch(()=>{console.log(JSON.stringify({pass:false}));process.exitCode=1});"
    result = subprocess.run(['docker', 'exec', '-i', signing.PROJECT + '-app-1', 'node', '-e', code],
        input=json.dumps(value).encode(), capture_output=True)
    if record: signing.private(record, result.stdout[:65536])
    if result.returncode or len(result.stdout) > 65536:
        raise ValueError('Private SMTP operation failed; preserve intent and partial acknowledgement, never replay creation')
    value = json.loads(result.stdout)
    if value.get('pass') is not True: raise ValueError('Private SMTP acceptance failed')
    return value


def principals(directory):
    credentials = bootstrap.credentials(json.loads((directory / 'bootstrap.credentials.json').read_text()))
    return [{key: row[key] for key in ['purpose', 'userId', 'teamId']} | {
        'email': dict((purpose, email) for purpose, email, _ in bootstrap.ACCOUNTS)[row['purpose']]} for row in credentials]


def members():
    wanted = {json.loads(signing.run(['docker', 'inspect', name]))[0]['Id'] for name in [
        *[signing.PROJECT + '-' + name + '-1' for name in ['app', 'database', 'cache', 'capture']],
        GATEWAY_PROJECT + '-proxy-1', CALLBACK_PROJECT + '-proxy-1']}
    network = json.loads(signing.run(['docker', 'network', 'inspect', signing.PROJECT + '_private']))[0]
    if network['Internal'] is not True or set(network['Containers']) != wanted:
        raise ValueError('Only the six reviewed private signing services may join admin signup')


def recreate():
    signing.run(['docker', 'compose', '--project-directory', str(signing.ROOT), '-f', str(signing.ROOT / 'compose.json'),
        'up', '-d', '--no-deps', '--force-recreate', '--pull', 'never', 'app'])


def smtp_network(add_app=False):
    network = json.loads(signing.run(['docker', 'network', 'inspect', signing.SMTP_NETWORK]))[0]
    names = SMTP_MEMBERS + ([signing.PROJECT + '-app-1'] if add_app else [])
    wanted = {json.loads(signing.run(['docker', 'inspect', name]))[0]['Id'] for name in names}
    if network['Internal'] is not True or set(network.get('Containers', {})) != wanted:
        raise ValueError('Preserve unexpected SMTP network exposure or membership')


def prepare_admin():
    directory = signing.ROOT
    expected = signing.installation(directory); signing.status(directory); signing.health(directory); members()
    if expected['services']['app']['environment'].get('NODE_EXTRA_CA_CERTS') != '/secrets/callback-trust.cert.pem':
        raise ValueError('Configure dedicated admin before the SMTP network transition')
    if any((directory / name).exists() for name in ADMIN_RECORDS): raise FileExistsError('Retained admin evidence requires review')
    value = {'action': 'review', 'password': secrets.token_hex(32), 'principals': principals(directory)}
    if client(value) != {'pass': True, 'dedicatedAdminAbsent': True}: raise ValueError('Private admin review differs')
    recovery.signing = signing; recovery.ROOT = directory
    snapshot = recovery.backup(); recovery.drill(snapshot)
    before = (directory / 'compose.json').read_bytes()
    value['action'] = 'create-admin'
    signing.private(directory / ADMIN_RECORDS[0], json.dumps({**value, 'snapshotBefore': str(snapshot)}).encode())
    temporary = json.loads(json.dumps(expected)); temporary['services']['app']['environment']['NEXT_PUBLIC_DISABLE_SIGNUP'] = 'false'
    proposed = json.dumps(temporary).encode()
    try:
        bootstrap.replace(directory / 'compose.json', proposed); recreate(); members()
        # This client also waits for the actual app readiness after recreation.
        wait_ready()
        accepted = client(value, directory / ADMIN_RECORDS[1])
    finally:
        current = (directory / 'compose.json').read_bytes()
        if current == proposed: bootstrap.replace(directory / 'compose.json', before)
        elif current != before: raise ValueError('Preserve concurrent provider configuration; private signup needs review')
        recreate(); signing.status(directory); signing.health(directory)
    inspected = client({**value, 'action': 'inspect-admin'})
    if inspected != accepted: raise ValueError('Dedicated admin acknowledgement differs')
    signing.private(directory / ADMIN_RECORDS[2], json.dumps(accepted).encode())
    print('PASS dedicated private instance admin: captured verification, ordinary main/QA roles unchanged, signup closed, no API token.')


def wait_ready():
    signing.run(['docker', 'exec', signing.PROJECT + '-app-1', 'node', '-e',
        "(async()=>{for(let n=0;n<180;n++){try{const r=await fetch('http://localhost:3000/api/health',{signal:AbortSignal.timeout(2000)});if(r.ok&&(await r.json()).status==='ok')return}catch{}await new Promise(r=>setTimeout(r,1000))}process.exit(1)})()"])


def admin_input(directory, action):
    if json.loads((directory / ADMIN_RECORDS[2]).read_text()).get('pass') is not True:
        raise ValueError('Accepted dedicated admin required')
    intent = json.loads((directory / ADMIN_RECORDS[0]).read_text())
    return {'action': action, 'password': intent['password'], 'principals': principals(directory)}


def enable():
    directory = signing.ROOT
    expected = signing.installation(directory); signing.status(directory); signing.health(directory)
    client(admin_input(directory, 'inspect-admin'))
    if any((directory / name).exists() for name in SMTP_RECORDS + ['smtp-trust.cert.pem', 'provider-trust.cert.pem']):
        raise FileExistsError('Retained SMTP transition requires review; never replay')
    if expected['services']['app']['environment'].get('NODE_EXTRA_CA_CERTS') != '/secrets/callback-trust.cert.pem':
        raise ValueError('Accepted callback trust required before SMTP')
    certificate = MAIL_ROOT / 'secrets/smtp.cert.pem'
    if certificate.is_symlink() or not certificate.is_file(): raise ValueError('Owned SMTP public certificate required')
    signing.run(['openssl', 'x509', '-in', str(certificate), '-noout', '-checkend', '86400', '-checkhost', 'codexdentist-mail-smtp'])
    smtp_network()
    before = (directory / 'compose.json').read_bytes(); before_manifest = (directory / 'manifest.json').read_bytes()
    recovery.signing = signing; recovery.ROOT = directory
    snapshot = recovery.backup(); recovery.drill(snapshot)
    if (directory / 'compose.json').read_bytes() != before or (directory / 'manifest.json').read_bytes() != before_manifest:
        raise ValueError('Preserve concurrent provider transition')
    value = admin_input(directory, 'configure')
    signing.private(directory / SMTP_RECORDS[0], json.dumps({**value, 'snapshotBefore': str(snapshot),
        'beforeCompose': json.loads(before), 'beforeManifest': json.loads(before_manifest)}).encode())
    public = certificate.read_bytes(); bundle = (directory / 'callback-trust.cert.pem').read_bytes().rstrip() + b'\n' + public
    pin = json.loads(before_manifest); pin['smtpCertificateSha256'] = hashlib.sha256(public).hexdigest(); pin['externalMail'] = True
    proposed = json.dumps(signing.configuration(json.loads((directory / 'keys.json').read_text()), True, True)).encode()
    proposed_manifest = json.dumps(pin).encode()
    mutated = False
    try:
        signing.private(directory / 'smtp-trust.cert.pem', public, True)
        signing.private(directory / 'provider-trust.cert.pem', bundle, True)
        bootstrap.replace(directory / 'compose.json', proposed); bootstrap.replace(directory / 'manifest.json', proposed_manifest)
        recreate(); signing.status(directory); signing.health(directory); smtp_network(True)
        # After this boundary provider mutations may have committed even if
        # their response was lost. Preserve the trust/network and inspect; do
        # not roll back a committed transport or automatically release jobs.
        mutated = True
        accepted = client(value, directory / SMTP_RECORDS[1])
        if client(admin_input(directory, 'inspect')) != accepted: raise ValueError('Main SMTP acknowledgement differs')
    except BaseException:
        if mutated: raise ValueError('Preserve SMTP intent/runtime; inspect provider transport before recovery or retry')
        for path, original, proposal in [(directory / 'compose.json', before, proposed),
                (directory / 'manifest.json', before_manifest, proposed_manifest)]:
            if path.is_symlink() or path.read_bytes() not in [original, proposal]: raise ValueError('Preserve concurrent SMTP transition')
        for name, content in [('smtp-trust.cert.pem', public), ('provider-trust.cert.pem', bundle)]:
            path = directory / name
            if path.is_symlink() or (path.exists() and path.read_bytes() != content): raise ValueError('Preserve changed SMTP public trust')
        bootstrap.replace(directory / 'compose.json', before); bootstrap.replace(directory / 'manifest.json', before_manifest)
        for name in ['smtp-trust.cert.pem', 'provider-trust.cert.pem']:
            (directory / name).unlink(missing_ok=True)
        recreate(); signing.status(directory); signing.health(directory)
        raise
    signing.private(directory / SMTP_RECORDS[2], json.dumps(accepted).encode())
    print('PASS encrypted main-only owned TLS SMTP; QA/global mail captured, no email sent by acceptance.')


def main():
    parser = argparse.ArgumentParser(description=__doc__); parser.add_argument('action', choices=['prepare-admin', 'enable', 'inspect']); args = parser.parse_args()
    if not hasattr(os, 'geteuid') or os.geteuid() != 0: raise ValueError('Root-owned SMTP operator required')
    os.umask(0o077); signing.installation(signing.ROOT)
    import fcntl
    with (signing.ROOT / 'operations.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if args.action == 'prepare-admin': prepare_admin()
        elif args.action == 'enable': enable()
        else:
            signing.status(signing.ROOT); signing.health(signing.ROOT); smtp_network(True); client(admin_input(signing.ROOT, 'inspect'))
            print('PASS encrypted main-only SMTP and separate ordinary main/QA provider identities.')


if __name__ == '__main__': main()
