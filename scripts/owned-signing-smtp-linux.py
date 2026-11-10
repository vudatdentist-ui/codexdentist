"""Called inside the existing unique native CE gate; never touches owned mail."""
import json
import os
from pathlib import Path
import subprocess


def exercise(load, signing, recovery, bootstrap, gateway, callback, directory):
    smtp = load('smtp_native', 'owned-signing-smtp.py')
    smtp.signing = signing; smtp.recovery = recovery; smtp.bootstrap = bootstrap
    smtp.GATEWAY_PROJECT = gateway.PROJECT; smtp.CALLBACK_PROJECT = callback.PROJECT
    fixture = directory / 'synthetic-smtp'; fixture.mkdir(mode=0o700)
    secrets = fixture / 'secrets'; secrets.mkdir(mode=0o700)
    smtp.MAIL_ROOT = fixture
    signing.SMTP_NETWORK = signing.PROJECT + '-synthetic-smtp'
    network = signing.SMTP_NETWORK; container = network + '-receiver'
    smtp.SMTP_MEMBERS = [container]
    command = ['docker', 'compose', '--project-directory', str(directory), '-f', str(directory / 'compose.json')]
    signing.run(['docker', 'network', 'create', '--internal', '--label', 'com.codexdentist.smtp-proof=' + signing.PROJECT, network])
    try:
        signing.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-sha256',
            '-subj', '/CN=codexdentist-mail-smtp', '-addext', 'subjectAltName=DNS:codexdentist-mail-smtp',
            '-keyout', str(fixture / 'server.key.pem'), '-out', str(fixture / 'server.cert.pem')])
        (secrets / 'smtp.cert.pem').write_bytes((fixture / 'server.cert.pem').read_bytes())
        (fixture / 'receiver.cjs').write_bytes(Path(__file__).with_name('owned-signing-smtp-native.cjs').read_bytes())
        os.chown(fixture, 1001, 1001)
        for name in ['server.key.pem', 'server.cert.pem', 'receiver.cjs']:
            os.chown(fixture / name, 1001, 1001); (fixture / name).chmod(0o600)
        signing.run(['docker', 'run', '-d', '--name', container, '--label', 'com.codexdentist.smtp-proof=' + signing.PROJECT,
            '--network', network, '--network-alias', 'codexdentist-mail-smtp', '--read-only', '--user', '1001:1001',
            '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--memory', '128m', '--log-driver', 'none',
            '--mount', 'type=bind,source=' + str(fixture) + ',target=/proof', '--entrypoint', 'node', signing.IMAGES['app'], '/proof/receiver.cjs'])
        smtp.prepare_admin(); smtp.enable()
        accepted = smtp.client(smtp.admin_input(directory, 'inspect'))
        if accepted.get('globalAndQaMailCaptured') is not True: raise ValueError('SMTP tenant separation failed')
        # The actual provider process can verify strict SMTP TLS; withholding
        # the reviewed public trust must reject the same receiver.
        denied = "require('nodemailer').createTransport({host:'codexdentist-mail-smtp',port:2465,secure:true,connectionTimeout:5000}).verify().then(()=>process.exit(1)).catch(e=>process.exit(['DEPTH_ZERO_SELF_SIGNED_CERT','UNABLE_TO_VERIFY_LEAF_SIGNATURE','SELF_SIGNED_CERT_IN_CHAIN'].includes(e.code)?0:1))"
        signing.run(['docker', 'exec', '-e', 'NODE_EXTRA_CA_CERTS=', signing.PROJECT + '-app-1', 'node', '-e', denied])
        credentials = json.loads((directory / 'bootstrap.credentials.json').read_text())
        source = Path(__file__).with_name('owned-signing-smtp-envelopes.cjs').read_text()
        result = subprocess.run(['docker', 'exec', '-i', signing.PROJECT + '-app-1', 'node', '-e', source],
            input=json.dumps(credentials).encode(), capture_output=True)
        signing.private(directory / 'smtp-envelope-proof.json', result.stdout[:65536])
        if result.returncode or json.loads(result.stdout).get('pass') is not True: raise ValueError('Actual per-organization mail delivery failed')
        messages = [json.loads(line) for line in (fixture / 'messages.jsonl').read_text().splitlines()]
        if not messages or any(row['recipient'] != '<synthetic-main-signer@example.test>' or row['bytes'] < 100 for row in messages):
            raise ValueError('QA/global mail escaped into main SMTP transport')
        # Recovery includes the exact trust bundle and encrypted transport DB.
        snapshot = recovery.backup(); recovery.drill(snapshot)
        return {'dedicatedAdminAndOrdinaryPrincipals': True, 'mainOnlyTlsSmtp': True,
            'qaMailCaptured': True, 'untrustedSmtpCertificateDenied': True, 'smtpConfigurationColdRestore': True}
    except BaseException:
        raise


def cleanup(signing, directory):
    network = signing.PROJECT + '-synthetic-smtp'; container = network + '-receiver'
    command = ['docker', 'compose', '--project-directory', str(directory), '-f', str(directory / 'compose.json')]
    if (directory / 'compose.json').is_file():
        # The app is the only signing service permitted on this extra network.
        # Stop it before removing the synthetic receiver and labelled network.
        subprocess.run(command + ['stop', '--timeout', '30', 'app'], capture_output=True, check=True)
        result = subprocess.run(['docker', 'inspect', container], capture_output=True)
        if result.returncode == 0:
            if json.loads(result.stdout)[0]['Config']['Labels'].get('com.codexdentist.smtp-proof') != signing.PROJECT:
                raise ValueError('SMTP receiver ownership differs')
            signing.run(['docker', 'rm', '-f', container])
        # Disconnect the stopped app; outer gate owns its final removal.
        result = subprocess.run(['docker', 'network', 'inspect', network], capture_output=True)
        if result.returncode == 0:
            info = json.loads(result.stdout)[0]
            if info['Labels'].get('com.codexdentist.smtp-proof') != signing.PROJECT: raise ValueError('SMTP network ownership differs')
            for identity, row in info.get('Containers', {}).items():
                if row.get('Name') != signing.PROJECT + '-app-1': raise ValueError('Preserve foreign SMTP network member')
                signing.run(['docker', 'network', 'disconnect', network, identity])
            signing.run(['docker', 'network', 'rm', network])
