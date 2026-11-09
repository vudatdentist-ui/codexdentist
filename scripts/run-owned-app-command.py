#!/usr/bin/env python3
"""Run a reviewed maintenance command with the running app's exact environment.

Compose dotenv quoting differs from docker run --env-file. Never feed the source
dotenv file to a credential-writing command. Values below come from Docker's
effective configuration and travel through a private pipe, never argv or disk.
"""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess


def command_plan(container, revision, source, command, provider_config=None):
    if not re.fullmatch(r'[a-f0-9]{40}', revision):
        raise ValueError('Expected an exact source revision')
    if container['Config'].get('Labels', {}).get('org.opencontainers.image.revision') != revision:
        raise ValueError('Running application revision differs')
    if not container['State']['Running'] or not re.fullmatch(r'sha256:[a-f0-9]{64}', container['Image']):
        raise ValueError('Running immutable application image required')
    if not re.fullmatch(r'[a-f0-9]{64}', container['Id']) or not command:
        raise ValueError('Invalid container identity or missing command')
    values = container['Config']['Env']
    for value in values:
        key, separator, _ = value.partition('=')
        if not separator or not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*', key) or any(c in value for c in '\r\n\0'):
            raise ValueError('Environment cannot be transported losslessly')
    args = ['docker', 'run', '--rm', '--pull', 'never', '--read-only', '--cap-drop', 'ALL',
            '--security-opt', 'no-new-privileges', '--memory', '512m', '--cpus', '1',
            '--tmpfs', '/tmp:rw,nosuid,noexec,size=32m', '--user', '0',
            '--network', 'container:' + container['Id'], '--env-file', '/dev/stdin',
            '--mount', 'type=bind,src=' + str(source) + ',dst=/review,readonly', '-w', '/review']
    if provider_config:
        args += ['--mount', 'type=bind,src=' + str(provider_config) + ',dst=/provider-config,readonly']
    args += ['--entrypoint', command[0], container['Image'], *command[1:]]
    return args, ('\n'.join(values) + '\n').encode()


def owned_directory(value, private=False):
    path = Path(value).resolve(strict=True)
    info = path.stat()
    if not path.is_dir() or info.st_uid != 0 or info.st_mode & (0o077 if private else 0o022):
        raise ValueError('Operator-owned directory with appropriate permissions required')
    if ',' in str(path):
        raise ValueError('Mount path contains a delimiter')
    return path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--container', default='namecheap-migration-codexdentist-1')
    parser.add_argument('--revision', required=True)
    parser.add_argument('--source', required=True)
    parser.add_argument('--provider-config')
    parser.add_argument('command', nargs=argparse.REMAINDER)
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise ValueError('Trusted root operator required')
    source = owned_directory(args.source)
    config = owned_directory(args.provider_config, private=True) if args.provider_config else None
    command = args.command[1:] if args.command[:1] == ['--'] else args.command
    inspected = json.loads(subprocess.check_output(['docker', 'inspect', args.container], stderr=subprocess.DEVNULL))[0]
    argv, values = command_plan(inspected, args.revision, source, command, config)
    return subprocess.run(argv, input=values, check=False).returncode


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (ValueError, KeyError, IndexError, OSError, subprocess.SubprocessError):
        raise SystemExit('Maintenance command could not start; no environment values disclosed.') from None
