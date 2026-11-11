#!/usr/bin/env python3
"""Independent check under the exact app UID, image, environment and data mount."""
import json
import importlib.util
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import tarfile

ROOT = Path('/opt/codexdentist-deploy')
CONTAINER = 'namecheap-migration-codexdentist-1'
spec = importlib.util.spec_from_file_location('public_ca', Path(__file__).with_name('runtime-public-ca.py'))
public_ca = importlib.util.module_from_spec(spec); spec.loader.exec_module(public_ca)


def command(current, source, sha):
    if not re.fullmatch('[a-f0-9]{40}', sha) or current['Config'].get('Labels', {}).get('org.opencontainers.image.revision') != sha:
        raise ValueError('Running revision differs from reviewed source')
    user = current['Config'].get('User')
    if user not in ['node', '1000', '1000:1000']:
        raise ValueError('Expected the unprivileged app runtime user')
    environment = current['Config']['Env']
    if any('\n' in value or '\r' in value for value in environment):
        raise ValueError('Multiline environment cannot use Docker env-file transfer')
    env = dict(value.split('=', 1) for value in environment)
    args = ['docker', 'run', '--rm', '--user', user, '--read-only', '--cap-drop', 'ALL',
        '--security-opt', 'no-new-privileges', '--network', 'container:' + CONTAINER, '--env-file', '/dev/stdin']
    if env.get('PATIENT_FILE_LOCAL_DURABLE') == 'true':
        root = env.get('PATIENT_FILE_STORAGE_ROOT')
        mounts = [m for m in current['Mounts'] if m['Destination'] == root]
        if root != '/data/patient-files' or len(mounts) != 1 or mounts[0]['Type'] != 'volume' or not mounts[0]['RW'] or not re.fullmatch('[a-zA-Z0-9_-]+', mounts[0]['Name']):
            raise ValueError('Exact durable file volume missing')
        args += ['--mount', f'type=volume,source={mounts[0]["Name"]},target={root},volume-nocopy']
    for relative in ['scripts', 'docs', 'src', '.gitignore']:
        args += ['--mount', f'type=bind,source={source / relative},target=/app/{relative},readonly']
    args += public_ca.public_ca_arguments(current)
    return args + ['--entrypoint', 'node', current['Image'], 'scripts/go-live-check.mjs'], ('\n'.join(environment) + '\n').encode()


def main():
    os.umask(0o077)
    if os.geteuid() != 0 or len(sys.argv) != 2:
        raise ValueError('Reviewed root-owned execution and exact revision required')
    sha = sys.argv[1]
    if not re.fullmatch('[a-f0-9]{40}', sha):
        raise ValueError('Invalid revision')
    source = ROOT / 'releases' / sha
    if subprocess.check_output(['git', '-C', str(source), 'rev-parse', 'HEAD'], text=True).strip() != sha or subprocess.check_output(['git', '-C', str(source), 'status', '--porcelain'], text=True).strip():
        raise ValueError('Canonical release source must be clean')
    current = json.loads(subprocess.check_output(['docker', 'inspect', CONTAINER]))[0]
    # Deployment checkouts are root-private. Project only public tracked code
    # into readable bind roots; never chmod the original checkout or forward .git.
    with tempfile.TemporaryDirectory(prefix='go-live-code-', dir=ROOT) as temporary:
        projection = Path(temporary) / 'source'
        projection.mkdir(mode=0o755)
        with tempfile.TemporaryFile() as stream:
            subprocess.run(['git', '-C', str(source), 'archive', sha, 'scripts', 'docs', 'src', '.gitignore'], stdout=stream, check=True)
            stream.seek(0)
            with tarfile.open(fileobj=stream) as archive:
                archive.extractall(projection, filter='data')
        for item in [projection, *projection.rglob('*')]:
            if item.is_symlink():
                raise ValueError('Unexpected link in reviewed code projection')
            item.chmod(0o755 if item.is_dir() else 0o644)
        args, environment = command(current, projection, sha)
        result = subprocess.run(args, input=environment, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    (ROOT / ('go-live-' + sha + '.log')).write_bytes(result.stdout)
    if result.returncode:
        raise RuntimeError('Go-live failed; inspect the private audit log')
    print('Production go-live check passed for', sha)


if __name__ == '__main__':
    main()
