#!/usr/bin/env python3
"""Opt-in community services. No core DB access, public ports, or paid API keys.

prepare writes root-private configuration; up starts only explicitly selected
profiles. All upstream tags resolve to immutable digests before first startup.
Existing state and credentials are preserved on repeat runs.
"""
import argparse
import json
import os
from pathlib import Path
import secrets
import subprocess
import uuid

IMAGES = {
    'orthanc': 'orthancteam/orthanc:26.11.0',
    'medplum': 'medplum/medplum-server:5.2.14',
    'chatwoot': 'chatwoot/chatwoot:v4.19.1-ce',
    'novu': 'ghcr.io/novuhq/novu/api:3.19.0',
    'novu-worker': 'ghcr.io/novuhq/novu/worker:3.19.0',
    'postgres': 'postgres:17-alpine',
    'chat-postgres': 'pgvector/pgvector:pg16',
    'valkey': 'valkey/valkey:8.1-alpine',
    'mongo': 'mongo:8.0.17',
}
GROUPS = {'imaging': ['orthanc'], 'medplum': ['medplum','postgres','valkey'],
          'chatwoot': ['chatwoot','chat-postgres','valkey'], 'novu': ['novu','novu-worker','mongo','valkey']}

def run(*args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)

def write_private(path, value):
    # Atomic, private from creation; credentials never pass through stdout.
    temporary = path.with_suffix(path.suffix + '.tmp')
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w') as stream:
        json.dump(value, stream, indent=2)
        stream.write('\n')
    os.chmod(temporary, 0o600)
    os.replace(temporary, path)

def configuration(keys, images):
    services = {}
    volumes = {}
    networks = {'imaging': {'internal': True}, 'medplum': {'internal': True},
                'chatwoot': {'internal': True}, 'novu': {'internal': True}, 'gateway': {}}
    def service(name, image, profile, environment=None, memory='768m', **extra):
        services[name] = {'image': images[image], 'profiles': [profile], 'restart': 'unless-stopped',
            'init': True, 'mem_limit': memory, 'cpus': 1.0, 'pids_limit': 256,
            'logging': {'driver': 'json-file', 'options': {'max-size': '10m', 'max-file': '3'}},
            'networks': [profile], **({'environment': environment} if environment else {}), **extra}
        return services[name]
    def volume(name):
        volumes[name] = {}
        return name
    def cache(profile):
        name = profile + '-cache'
        service(name, 'valkey', profile, memory='128m', command=['valkey-server','--requirepass',keys[profile+'-cache'],
            '--appendonly','yes','--maxmemory','80mb','--maxmemory-policy','noeviction'],
            volumes=[volume(name)+':/data'])
        return name
    orthanc = service('orthanc','orthanc','imaging', {'DICOM_WEB_PLUGIN_ENABLED': 'true',
        'ORTHANC__NAME': 'Codexdentist private archive', 'ORTHANC__DICOM_AET': 'CODEXDENTIST',
        'ORTHANC__AUTHENTICATION_ENABLED': 'true', 'ORTHANC__REMOTE_ACCESS_ALLOWED': 'true',
        'ORTHANC__DICOM_SERVER_ENABLED': 'false', 'ORTHANC__REGISTERED_USERS': json.dumps({'codexdentist':keys['orthanc']}),
        'ORTHANC__DICOM_WEB__ENABLE': 'true', 'ORTHANC__DICOM_WEB__ROOT': '/dicom-web/'},
        volumes=[volume('orthanc-data')+':/var/lib/orthanc/db'], ports=['127.0.0.1:23801:8042'])
    orthanc['networks'] = {'imaging': {}, 'gateway': {'aliases': ['codexdentist-orthanc']}}
    if images.get('ohif'):
        ohif = service('ohif','ohif','imaging',memory='128m',ports=['127.0.0.1:23805:80'])
        ohif['networks'] = {'gateway':{'aliases':['codexdentist-ohif']}}
    med_cache = cache('medplum')
    service('medplum-db','postgres','medplum', {'POSTGRES_DB':'medplum','POSTGRES_USER':'medplum','POSTGRES_PASSWORD':keys['medplum-db']},
        memory='384m', volumes=[volume('medplum-db')+':/var/lib/postgresql/data'],
        healthcheck={'test':['CMD-SHELL','pg_isready -U medplum -d medplum'],'interval':'5s','timeout':'3s','retries':20})
    med = service('medplum','medplum','medplum', {
        'MEDPLUM_PORT':'8103', 'MEDPLUM_BASE_URL':'http://codexdentist-medplum:8103/',
        'MEDPLUM_APP_BASE_URL':'https://codexdentist.com/', 'MEDPLUM_STORAGE_BASE_URL':'http://codexdentist-medplum:8103/storage/',
        'MEDPLUM_DATABASE_HOST':'medplum-db','MEDPLUM_DATABASE_PORT':'5432','MEDPLUM_DATABASE_DBNAME':'medplum',
        'MEDPLUM_DATABASE_USERNAME':'medplum','MEDPLUM_DATABASE_PASSWORD':keys['medplum-db'],
        'MEDPLUM_REDIS_HOST':med_cache,'MEDPLUM_REDIS_PORT':'6379','MEDPLUM_REDIS_PASSWORD':keys['medplum-cache'],
        'MEDPLUM_BINARY_STORAGE':'file:./binary/', 'MEDPLUM_ALLOWED_ORIGINS':'https://codexdentist.com',
        'MEDPLUM_VM_CONTEXT_BOTS_ENABLED':'false','MEDPLUM_INTROSPECTION_ENABLED':'false',
        'MEDPLUM_REGISTER_ENABLED':'false', 'MEDPLUM_GOOGLE_CLIENT_ID':'','MEDPLUM_GOOGLE_CLIENT_SECRET':'',
        'MEDPLUM_DEFAULT_SUPER_ADMIN_EMAIL':keys['owner-email'], 'MEDPLUM_DEFAULT_SUPER_ADMIN_PASSWORD':keys['medplum-admin'],
        'MEDPLUM_DEFAULT_SUPER_ADMIN_CLIENT_ID':keys['medplum-admin-client-id'],
        'MEDPLUM_DEFAULT_SUPER_ADMIN_CLIENT_SECRET':keys['medplum-admin-client-secret'],
        'MEDPLUM_SIGNING_KEY':keys['medplum-signing-key'], 'MEDPLUM_EMAIL_PROVIDER':'none',
        'MEDPLUM_AUTO_DOWNLOAD_ENABLED':'false','MEDPLUM_DISPATCH_ENABLED':'false'},
        command=['env'], volumes=[volume('medplum-files')+':/usr/src/medplum/binary'],
        ports=['127.0.0.1:23802:8103'], depends_on={'medplum-db': {'condition':'service_healthy'}, med_cache:{'condition':'service_started'}})
    med['networks'] = {'medplum':{},'gateway':{'aliases':['codexdentist-medplum']}}
    chat_cache = cache('chatwoot')
    service('chatwoot-db','chat-postgres','chatwoot', {'POSTGRES_DB':'chatwoot','POSTGRES_USER':'chatwoot','POSTGRES_PASSWORD':keys['chatwoot-db']},
        memory='384m', volumes=[volume('chatwoot-db')+':/var/lib/postgresql/data'],
        healthcheck={'test':['CMD-SHELL','pg_isready -U chatwoot -d chatwoot'],'interval':'5s','timeout':'3s','retries':20})
    chat_env = {'NODE_ENV':'production','RAILS_ENV':'production','INSTALLATION_ENV':'docker','SECRET_KEY_BASE':keys['chatwoot'],
        'FRONTEND_URL':'https://chat.codexdentist.com','FORCE_SSL':'false','ENABLE_ACCOUNT_SIGNUP':'false',
        'POSTGRES_HOST':'chatwoot-db','POSTGRES_DATABASE':'chatwoot','POSTGRES_USERNAME':'chatwoot','POSTGRES_PASSWORD':keys['chatwoot-db'],
        'REDIS_URL':f'redis://:{keys["chatwoot-cache"]}@{chat_cache}:6379','ACTIVE_STORAGE_SERVICE':'local',
        'RAILS_LOG_TO_STDOUT':'true','LOG_LEVEL':'warn','RAILS_MAX_THREADS':'3','SIDEKIQ_CONCURRENCY':'2',
        'MAILER_SENDER_EMAIL':'Codexdentist <noreply@codexdentist.com>', 'DISABLE_TELEMETRY':'true'}
    dependencies = {'chatwoot-db':{'condition':'service_healthy'}, chat_cache:{'condition':'service_started'}}
    chat = service('chatwoot','chatwoot','chatwoot',chat_env, memory='1024m',
        entrypoint=['docker/entrypoints/rails.sh'],command=['bundle','exec','rails','s','-p','3000','-b','0.0.0.0'],
        volumes=[volume('chatwoot-files')+':/app/storage'],ports=['127.0.0.1:23803:3000'],depends_on=dependencies)
    chat['networks'] = {'chatwoot':{},'gateway':{'aliases':['codexdentist-chatwoot']}}
    service('chatwoot-worker','chatwoot','chatwoot',chat_env, command=['bundle','exec','sidekiq','-C','config/sidekiq.yml'],
        volumes=['chatwoot-files:/app/storage'],depends_on=dependencies)
    novu_cache = cache('novu')
    service('novu-db','mongo','novu', {'MONGO_INITDB_ROOT_USERNAME':'novu','MONGO_INITDB_ROOT_PASSWORD':keys['novu-db']},
        memory='768m', command=['mongod','--wiredTigerCacheSizeGB','0.25'], volumes=[volume('novu-db')+':/data/db'])
    novu_env = {'NODE_ENV':'production','PORT':'3000','API_ROOT_URL':'http://codexdentist-novu:3000',
        'FRONT_BASE_URL':'https://codexdentist.com','MONGO_URL':f'mongodb://novu:{keys["novu-db"]}@novu-db:27017/novu?authSource=admin',
        'MONGO_MIN_POOL_SIZE':'1','MONGO_MAX_POOL_SIZE':'5','MONGO_AUTO_CREATE_INDEXES':'true',
        'REDIS_HOST':novu_cache,'REDIS_PORT':'6379','REDIS_PASSWORD':keys['novu-cache'],'REDIS_DB_INDEX':'2',
        'REDIS_CACHE_SERVICE_HOST':novu_cache,'REDIS_CACHE_SERVICE_PORT':'6379',
        'JWT_SECRET':keys['novu-jwt'],'STORE_ENCRYPTION_KEY':keys['novu-store'][:32], 'NOVU_SECRET_KEY':keys['novu'],
        'IS_SELF_HOSTED':'true','IS_V2_ENABLED':'true','IS_API_IDEMPOTENCY_ENABLED':'false','IS_API_RATE_LIMITING_ENABLED':'false',
        'IS_NEW_MESSAGES_API_RESPONSE_ENABLED':'false','NEW_RELIC_ENABLED':'false','SENTRY_DSN':'','S3_LOCAL_STACK':'false',
        'AWS_ACCESS_KEY_ID':'','AWS_SECRET_ACCESS_KEY':'','S3_BUCKET_NAME':'','S3_REGION':'us-east-1'}
    novu = service('novu','novu','novu',novu_env, ports=['127.0.0.1:23804:3000'], depends_on=['novu-db',novu_cache])
    novu['networks'] = {'novu':{'aliases':['codexdentist-novu']},'gateway':{'aliases':['codexdentist-novu']}}
    service('novu-worker','novu-worker','novu', {**novu_env,'PORT':'3004'}, depends_on=['novu-db',novu_cache])
    return {'name':'codexdentist-optional','services':services,'networks':networks,'volumes':volumes}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['prepare','up','status'])
    parser.add_argument('--directory', default='/opt/codexdentist-optional')
    parser.add_argument('--profiles', nargs='+', choices=GROUPS, required=True)
    parser.add_argument('--owner-email', help='Existing owner email; required on first preparation, never sends email.')
    parser.add_argument('--ohif-image', help='Locally built official OHIF at PUBLIC_URL=/imaging/ohif/; resolves to image ID.')
    args = parser.parse_args()
    directory = Path(args.directory).resolve()
    if os.name != 'posix' or os.geteuid() != 0:
        raise SystemExit('Run as root on the owned Linux Docker host.')
    if directory.exists() and (directory.stat().st_uid != 0 or directory.stat().st_mode & 0o077):
        raise SystemExit('Service directory must be root-owned mode 0700.')
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    state = directory / 'secrets.json'
    keys = json.loads(state.read_text()) if state.exists() else {}
    if 'owner-email' not in keys:
        if not args.owner_email or '@' not in args.owner_email or any(c.isspace() for c in args.owner_email):
            raise SystemExit('Pass --owner-email for the owned service administrator.')
        keys['owner-email'] = args.owner_email
    elif args.owner_email and args.owner_email != keys['owner-email']:
        raise SystemExit('Changing the service owner needs an explicit account transfer.')
    for key in ['orthanc','medplum-db','medplum-cache','medplum-admin','medplum-admin-client-secret','chatwoot','chatwoot-db','chatwoot-cache','novu','novu-db','novu-cache','novu-jwt','novu-store']:
        keys.setdefault(key, secrets.token_hex(32))
    keys.setdefault('chatwoot-owner-password', 'Cdx!'+secrets.token_hex(24))
    keys.setdefault('medplum-admin-client-id', str(uuid.uuid4()))
    if 'medplum-signing-key' not in keys:
        keys['medplum-signing-key'] = run('openssl','genpkey','-algorithm','RSA','-pkeyopt','rsa_keygen_bits:2048',
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True).stdout
    write_private(state, keys)
    lock = directory / 'image-lock.json'
    images = json.loads(lock.read_text()) if lock.exists() else {}
    if args.ohif_image:
        if 'imaging' not in args.profiles:
            raise SystemExit('OHIF image requires the imaging profile.')
        images['ohif'] = run('docker','image','inspect',args.ohif_image,'--format','{{.Id}}',stdout=subprocess.PIPE,text=True).stdout.strip()
        write_private(lock,images)
    needed = {key for profile in args.profiles for key in GROUPS[profile]}
    for key in sorted(needed):
        if key not in images:
            run('docker','pull',IMAGES[key], stdout=subprocess.DEVNULL)
            images[key] = json.loads(run('docker','image','inspect',IMAGES[key], '--format','{{json .RepoDigests}}',
                stdout=subprocess.PIPE, text=True).stdout)[0]
            write_private(lock,images)
    # Unselected profiles remain explicit tags until first prepared; Compose
    # does not start or pull those services. Selected profiles always use digests.
    compose = directory / 'compose.json'
    write_private(compose, configuration(keys,{**IMAGES,**images}))
    command = ['docker','compose','-f',str(compose)]
    for profile in args.profiles:
        command += ['--profile',profile]
    if args.action == 'up':
        # Chatwoot preparation is a separate, explicit operator-reviewed step:
        # docker compose ... run --rm chatwoot bundle exec rails db:chatwoot_prepare
        run(*command,'up','-d','--remove-orphans=false')
    elif args.action == 'status':
        run(*command,'ps','--format','json')
    print('Private service configuration ready; no core data or public routes changed.')

if __name__ == '__main__':
    main()
