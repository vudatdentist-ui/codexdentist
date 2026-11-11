#!/usr/bin/env python3
"""Retire only the accepted synthetic core's production callback alias."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess

ROOT = Path('/opt/codexdentist-signing-core-qa')
spec = importlib.util.spec_from_file_location('qa_signing', Path(__file__).with_name('owned-signing-services.py'))
signing = importlib.util.module_from_spec(spec); spec.loader.exec_module(signing)
spec = importlib.util.spec_from_file_location('qa_bootstrap', Path(__file__).with_name('owned-signing-bootstrap.py'))
bootstrap = importlib.util.module_from_spec(spec); spec.loader.exec_module(bootstrap)


def plan(manifest, original):
    if manifest.get('syntheticOnly') is not True or manifest.get('productionCoreAttached') is not False or manifest.get('retired') or not re.fullmatch('codexdentist-core-qa-[a-f0-9]{12}', manifest.get('project', '')):
        raise ValueError('Exact active synthetic QA fixture required')
    if original.get('name') != manifest['project'] or set(original.get('services', {})) != {'core', 'database', 'ui'}:
        raise ValueError('Only the owned synthetic core project may retire')
    core = original['services']['core']
    if core.get('image') != manifest['image'] or core.get('environment', {}).get('NOTIFICATION_DELIVERY_MODE') != 'disabled' or core.get('networks') != {'private': {}, 'api': {}, 'callback': {'aliases': ['codexdentist-signing-core']}}:
        raise ValueError('Synthetic core image, mail guard or callback scope differs')
    if original['networks'].get('callback') != {'external': True, 'name': 'codexdentist-signing-callback_core'}:
        raise ValueError('Exact private callback network required')
    updated = json.loads(json.dumps(original))
    del updated['services']['core']['networks']['callback']; del updated['networks']['callback']
    return updated


def retire(apply=False):
    if ROOT.is_symlink() or ROOT.stat().st_uid != 0 or ROOT.stat().st_mode & 0o077: raise ValueError('Private synthetic fixture custody required')
    before = (ROOT / 'compose.json').read_bytes(); before_manifest = (ROOT / 'manifest.json').read_bytes()
    manifest = json.loads(before_manifest); proposed = json.dumps(plan(manifest, json.loads(before))).encode()
    if (ROOT / 'retirement').exists(): raise FileExistsError('Review retained retirement evidence instead of replaying')
    # Re-run the actual read-only database/file/CMS proof before stopping it.
    result = subprocess.run(['python3', str(Path(__file__).with_name('owned-signing-core-acceptance.py'))], capture_output=True)
    if result.returncode or json.loads((ROOT / 'full-core-acceptance.json').read_text()).get('pass') is not True:
        raise ValueError('Fresh complete core acceptance required before retirement')
    containers = {}
    for name in ['core', 'database', 'ui']:
        info = json.loads(signing.run(['docker', 'inspect', manifest['project'] + '-' + name + '-1']))[0]
        if info['Config'].get('Labels', {}).get('com.docker.compose.project') != manifest['project'] or not info['State']['Running']:
            raise ValueError('Exact live synthetic service identity required')
        containers[name] = info['Id']
    print(json.dumps({'freshFullCoreAcceptance': True, 'syntheticOnly': True, 'dataAndVolumesPreserved': True, 'apply': apply}), flush=True)
    if not apply: return
    state = ROOT / 'retirement'; state.mkdir(mode=0o700)
    signing.private(state / 'compose.before.json', before); signing.private(state / 'manifest.before.json', before_manifest)
    signing.private(state / 'intent.json', json.dumps({'project': manifest['project'], 'containers': containers,
        'acceptedProofSha256': hashlib.sha256((ROOT / 'full-core-acceptance.json').read_bytes()).hexdigest()}).encode())
    signing.run(['docker', 'compose', '--project-directory', str(ROOT), '-f', str(ROOT / 'compose.json'), 'stop', '--timeout', '30'])
    for identity in containers.values():
        info = json.loads(signing.run(['docker', 'inspect', identity]))[0]
        if info['State']['Running'] or info['Config']['Labels'].get('com.docker.compose.project') != manifest['project']:
            raise ValueError('Preserve uncertain synthetic retirement state')
    if (ROOT / 'compose.json').read_bytes() != before or (ROOT / 'manifest.json').read_bytes() != before_manifest:
        raise ValueError('Preserve concurrent QA configuration changes')
    # Remove one stopped, identity-pinned container. Persistent database/files
    # and stopped database/UI containers remain; no volume deletion is used.
    signing.run(['docker', 'rm', containers['core']])
    bootstrap.replace(ROOT / 'compose.json', proposed)
    bootstrap.replace(ROOT / 'manifest.json', json.dumps({**manifest, 'retired': True, 'callbackAliasRetired': True}).encode())
    network = json.loads(signing.run(['docker', 'network', 'inspect', 'codexdentist-signing-callback_core']))[0]
    if containers['core'] in network.get('Containers', {}): raise ValueError('Retired callback endpoint still exists')
    signing.private(state / 'accepted.json', json.dumps({'pass': True, 'syntheticOnly': True, 'callbackAliasRetired': True,
        'databaseAndFilesPreserved': True, 'appWorkersStopped': True, 'externalMailSent': False}).encode())
    print('PASS accepted synthetic QA core retired; callback alias released, database/files/private evidence preserved.')


def main():
    parser = argparse.ArgumentParser(); parser.add_argument('--apply', action='store_true'); args = parser.parse_args()
    if not hasattr(os, 'geteuid') or os.geteuid() != 0: raise ValueError('Reviewed root-owned retirement required')
    os.umask(0o077)
    import fcntl
    paths = [Path('/opt/codexdentist-deploy/deploy.lock'), Path('/opt/codexdentist-owned-signing/operations.lock'),
        Path('/opt/codexdentist-signing-callback/operations.lock'), ROOT / 'operations.lock']
    from contextlib import ExitStack
    with ExitStack() as stack:
        for path in paths: fcntl.flock(stack.enter_context(path.open('a')), fcntl.LOCK_EX | fcntl.LOCK_NB)
        retire(args.apply)


if __name__ == '__main__': main()
