#!/usr/bin/env python3
"""Opt-in private CPU inference. No cloud key, core DB, public route or patient data.

Only bootstrap has outbound networking, to fetch the explicitly pinned model.
The runtime mounts downloaded models read-only on an internal Docker network.
"""
import argparse
import importlib.util
import ipaddress
import json
import os
from pathlib import Path
import re
import subprocess
import time
import urllib.request
import uuid

IMAGE = 'ollama/ollama:0.40.15'
MODEL = 'qwen3:4b'
VOLUME = 'codexdentist-local-ai_models'


def run(*args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)


def configuration(image):
    assert re.fullmatch(r'ollama/ollama@sha256:[a-f0-9]{64}', image)
    return {'name': 'codexdentist-local-ai', 'services': {'ollama': {
        'image': image, 'profiles': ['local-ai'], 'restart': 'unless-stopped',
        'read_only': True, 'cap_drop': ['ALL'], 'security_opt': ['no-new-privileges:true'],
        'mem_limit': '5g', 'cpus': 3, 'pids_limit': 128,
        'environment': {'OLLAMA_HOST': '0.0.0.0:11434', 'OLLAMA_NO_CLOUD': '1',
                        'OLLAMA_NOHISTORY': 'true', 'OLLAMA_DEBUG_LOG_REQUESTS': 'false',
                        'OLLAMA_NUM_PARALLEL': '1', 'OLLAMA_MAX_QUEUE': '2',
                        'OLLAMA_MAX_LOADED_MODELS': '1', 'OLLAMA_CONTEXT_LENGTH': '8192',
                        'OLLAMA_KEEP_ALIVE': '2m'},
        'volumes': ['models:/root/.ollama:ro'], 'tmpfs': ['/tmp:rw,nosuid,size=128m'],
        'networks': {'private': {'aliases': ['codexdentist-ollama']}},
        'logging': {'driver': 'json-file', 'options': {'max-size': '5m', 'max-file': '2'}}}},
        'volumes': {'models': {'external': True, 'name': VOLUME}},
        'networks': {'private': {'internal': True}}}


def api(base, path, payload=None):
    request = urllib.request.Request(base + path,
        data=json.dumps(payload).encode() if payload is not None else None,
        headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(request, timeout=15) as response:
        return json.load(response)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['bootstrap', 'up', 'status'])
    parser.add_argument('--directory', default='/opt/codexdentist-local-ai')
    args = parser.parse_args()
    if os.name != 'posix' or os.geteuid() != 0:
        raise SystemExit('Trusted root Linux operator required')
    directory = Path(args.directory).resolve()
    if directory.exists() and (not directory.is_dir() or directory.stat().st_uid != 0 or directory.stat().st_mode & 0o077):
        raise SystemExit('Root-private service directory required')
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.umask(0o077)
    # Reuse the existing atomic private writer, without starting any sidecar.
    spec = importlib.util.spec_from_file_location('optional_services', Path(__file__).with_name('optional-services.py'))
    helpers = importlib.util.module_from_spec(spec); spec.loader.exec_module(helpers)
    import fcntl
    with (directory / 'operator.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        pin_file = directory / 'model-lock.json'
        if args.action == 'bootstrap':
            if pin_file.exists():
                raise SystemExit('Model is already pinned; use status/up. Model replacement requires review.')
            run('docker', 'pull', IMAGE, stdout=subprocess.DEVNULL)
            image = json.loads(run('docker', 'image', 'inspect', IMAGE, '--format', '{{json .RepoDigests}}',
                capture_output=True, text=True).stdout)[0]
            configuration(image)  # Validate before starting any container.
            # Only this script owns this named cache; never adopt foreign data.
            found = subprocess.run(['docker', 'volume', 'inspect', VOLUME], capture_output=True, text=True)
            if found.returncode == 0:
                volume = json.loads(found.stdout)[0]
                assert volume.get('Labels', {}).get('com.codexdentist.local-ai') == 'models'
            else:
                run('docker', 'volume', 'create', '--label', 'com.codexdentist.local-ai=models', VOLUME, stdout=subprocess.DEVNULL)
            name = 'codexdentist-local-ai-bootstrap-' + uuid.uuid4().hex[:12]
            created = False
            try:
                run('docker', 'run', '-d', '--name', name, '--network', 'bridge', '--memory', '5g', '--cpus', '3',
                    '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
                    '-e', 'OLLAMA_NO_CLOUD=1', '-v', VOLUME + ':/root/.ollama', image, 'serve', stdout=subprocess.DEVNULL)
                created = True
                data = json.loads(run('docker', 'inspect', name, capture_output=True, text=True).stdout)[0]
                address = data['NetworkSettings']['Networks']['bridge']['IPAddress']
                assert ipaddress.ip_address(address).is_private
                base = 'http://' + address + ':11434'
                for attempt in range(60):
                    try:
                        api(base, '/api/version'); break
                    except OSError:
                        time.sleep(1)
                else:
                    raise SystemExit('Model bootstrap server did not start')
                run('docker', 'exec', name, 'ollama', 'pull', MODEL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                models = api(base, '/api/tags')['models']
                model = next(value for value in models if value['name'] == MODEL)
                assert re.fullmatch(r'[a-f0-9]{64}', model['digest'])
                details = api(base, '/api/show', {'model': MODEL})
                assert 'Apache License' in details.get('license', '') and '2.0' in details['license']
                helpers.write_private(pin_file, {'image': image, 'model': MODEL, 'digest': model['digest'], 'license': 'Apache-2.0'})
                print('Pinned owned local model and image; no application configuration changed.')
            finally:
                if created:
                    subprocess.run(['docker', 'rm', '-f', name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        pin = json.loads(pin_file.read_text())
        assert pin['model'] == MODEL and re.fullmatch(r'[a-f0-9]{64}', pin['digest'])
        compose = directory / 'compose.json'
        helpers.write_private(compose, configuration(pin['image']))
        command = ['docker', 'compose', '-f', str(compose), '--profile', 'local-ai']
        if args.action == 'up':
            run(*command, 'up', '-d')
        elif args.action == 'status':
            inspected = json.loads(run('docker', 'inspect', 'codexdentist-local-ai-ollama-1', capture_output=True, text=True).stdout)[0]
            assert inspected['Config']['Image'] == pin['image'] and 'OLLAMA_NO_CLOUD=1' in inspected['Config']['Env']
            assert inspected['HostConfig']['ReadonlyRootfs'] is True
            assert all(not mount['RW'] for mount in inspected['Mounts'] if mount['Type'] == 'volume')
            assert not inspected['HostConfig']['PortBindings']
            networks = list(inspected['NetworkSettings']['Networks'])
            assert networks == ['codexdentist-local-ai_private']
            network = json.loads(run('docker', 'network', 'inspect', networks[0], capture_output=True, text=True).stdout)[0]
            assert network['Internal'] is True
            address = inspected['NetworkSettings']['Networks'][networks[0]]['IPAddress']
            assert ipaddress.ip_address(address).is_private
            models = api('http://' + address + ':11434', '/api/tags')['models']
            assert any(value['name'] == MODEL and value['digest'] == pin['digest'] for value in models)
            print('PASS pinned local model, internal-only runtime network and no cloud dependency.')


if __name__ == '__main__':
    try:
        main()
    except (AssertionError, KeyError, StopIteration, OSError, subprocess.SubprocessError):
        raise SystemExit('Local inference preparation failed; core configuration is unchanged.') from None
