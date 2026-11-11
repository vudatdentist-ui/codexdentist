#!/usr/bin/env python3
"""Actual Compose recreation regression; no mail, credentials or production volumes."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import uuid


def main():
    parser = argparse.ArgumentParser(); parser.add_argument('--image', required=True); parser.add_argument('--output', required=True); args = parser.parse_args()
    if os.geteuid() != 0: raise ValueError('Root-owned isolated Docker proof required')
    os.umask(0o077)
    spec = importlib.util.spec_from_file_location('runtime_mail', Path(__file__).with_name('owned-mail-attachments.py'))
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    root = Path(args.output).resolve(); source = Path(__file__).resolve().parent.parent
    if root.exists() or root == source or source in root.parents: raise ValueError('Fresh private output outside source required')
    root.mkdir(mode=0o700, parents=True)
    project = 'codexdentist-mail-runtime-test-' + uuid.uuid4().hex
    module.mail.PROJECT = project
    image = json.loads(module.mail.run(['docker', 'image', 'inspect', args.image]))[0]['Id']
    compose = {'name': project, 'services': {'smtp': {'image': image, 'user': '1000:1000', 'read_only': True,
        'mem_limit': '128m', 'cpus': 0.1, 'pids_limit': 64,
        'cap_drop': ['ALL'], 'security_opt': ['no-new-privileges:true'], 'logging': {'driver': 'none'},
        'entrypoint': ['node', '-e', 'setInterval(()=>{},60000)'], 'networks': ['private']}}, 'networks': {'private': {'internal': True}}}
    config = root / 'compose.json'; config.write_text(json.dumps(compose))
    command = ['docker', 'compose', '--project-directory', str(root), '-f', str(config)]
    try:
        module.mail.run(command + ['up', '-d', '--pull', 'never'])
        before = json.loads(module.mail.run(['docker', 'inspect', project + '-smtp-1']))[0]
        module.mail.run(command + ['up', '-d', '--force-recreate', '--pull', 'never'])
        after = json.loads(module.mail.run(['docker', 'inspect', project + '-smtp-1']))[0]
        if before['Id'] == after['Id']: raise ValueError('Actual replacement required')
        module.same_runtime(before, after)
        proof = {'pass': True, 'actualComposeReplacement': True, 'sameImageEnvironmentPrivateNetworks': True,
            'traceFormat': 'service-instance' if after['Config']['Labels'].get('com.docker.compose.replace') == 'smtp-1' else 'prior-id', 'mailSubmitted': False}
    finally:
        found = subprocess.run(['docker', 'inspect', project + '-smtp-1'], capture_output=True)
        if found.returncode == 0 and json.loads(found.stdout)[0]['Config']['Labels'].get('com.docker.compose.project') != project:
            raise ValueError('Preserve foreign runtime fixture')
        module.mail.run(command + ['down', '--remove-orphans'])
    (root / 'accepted.json').write_text(json.dumps(proof)); print(json.dumps(proof))


if __name__ == '__main__': main()
