#!/usr/bin/env python3
"""Private bootstrap/probes against owned loopback sidecars. No patient messages.

All response bodies and generated credentials stay in the root-private directory.
stdout contains only HTTP codes, field names and acceptance results.
"""
import argparse
import base64
import json
import os
from pathlib import Path
import secrets
import hashlib
import uuid
import subprocess
import urllib.error
import urllib.parse
import urllib.request

def request(base, path, body=None, authorization=None, form=False, method=None):
    headers = {'Content-Type':'application/x-www-form-urlencoded' if form else 'application/json'}
    if authorization:
        headers['Authorization'] = authorization
    payload = urllib.parse.urlencode(body).encode() if form else json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(base+path, data=payload, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            raw = response.read(2*1024*1024)
            return response.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as error:
        raw = error.read(65536)
        try:
            return error.code, json.loads(raw)
        except ValueError:
            return error.code, {'error':'non-json response'}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory',default='/opt/codexdentist-optional')
    parser.add_argument('--repair-empty-medplum-bootstrap', action='store_true', help='Rotate upstream defaults only on a verified empty owned Medplum instance.')
    args = parser.parse_args()
    directory = Path(args.directory).resolve()
    if os.geteuid() != 0 or directory.stat().st_uid != 0 or directory.stat().st_mode & 0o077:
        raise SystemExit('Root-private service directory required.')
    keys = json.loads((directory/'secrets.json').read_text())
    state_file = directory/'acceptance.json'
    state = json.loads(state_file.read_text()) if state_file.exists() else {}
    def retain(key, value):
        state[key] = value
        fd = os.open(state_file, os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
        with os.fdopen(fd,'w') as stream:
            json.dump(state,stream,indent=2)
    auth = 'Basic '+base64.b64encode(('codexdentist:'+keys['orthanc']).encode()).decode()
    code, system = request('http://127.0.0.1:23801','/system',authorization=auth)
    assert code == 200 and system.get('Name') == 'Codexdentist private archive', 'Orthanc identity'
    code, plugin = request('http://127.0.0.1:23801','/plugins/dicom-web',authorization=auth)
    assert code == 200, 'DICOMweb plugin'
    print('PASS authenticated private Orthanc system and DICOMweb plugin')
    if state.get('medplum-bootstrap-client'):
        keys['medplum-admin-client-id'] = state['medplum-bootstrap-client']['id']
        keys['medplum-admin-client-secret'] = state['medplum-bootstrap-client']['secret']
        with open(directory/'secrets.json','w') as stream:
            json.dump(keys,stream,indent=2)
    basic = 'Basic '+base64.b64encode((keys['medplum-admin-client-id']+':'+keys['medplum-admin-client-secret']).encode()).decode()
    code, token = request('http://127.0.0.1:23802','/oauth2/token',{'grant_type':'client_credentials',
        'client_id':keys['medplum-admin-client-id']}, basic, True)
    retain('medplum-token-response', token)
    print('Medplum bootstrap authentication HTTP',code)
    if code != 200 and args.repair_empty_medplum_bootstrap:
        def query(sql):
            return subprocess.run(['docker','exec','codexdentist-optional-medplum-db-1','psql','-U','medplum','-d','medplum','-At','-c',sql],
                check=True,capture_output=True,text=True).stdout.strip()
        assert query('SELECT count(*) FROM "User"') == '1' and query('SELECT email FROM "User"') == 'admin@example.com', 'Not an empty upstream bootstrap'
        assert all(query('SELECT count(*) FROM "'+table+'"') == '0' for table in ['Patient','Encounter','Observation','ClientApplication']), 'Clinical data or clients exist; automatic bootstrap repair refused'
        verifier = secrets.token_hex(32)
        challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip('=')
        code, login = request('http://127.0.0.1:23802','/auth/login',{'email':'admin@example.com','password':'medplum_admin',
            'scope':'openid','codeChallenge':challenge,'codeChallengeMethod':'S256'})
        assert code == 200 and login.get('code'), 'Initial bootstrap login failed'
        code, admin_token = request('http://127.0.0.1:23802','/oauth2/token',{'grant_type':'authorization_code','code':login['code'],'code_verifier':verifier},form=True)
        assert code == 200, 'Bootstrap PKCE exchange failed'
        authorization = 'Bearer '+admin_token['access_token']
        code, me = request('http://127.0.0.1:23802','/auth/me',authorization=authorization)
        assert code == 200 and me.get('project',{}).get('superAdmin') is True, 'Bootstrap administrator identity mismatch'
        code, client = request('http://127.0.0.1:23802','/admin/projects/'+me['project']['id']+'/client',
            {'name':'Private bootstrap administrator','id':keys['medplum-admin-client-id'],'secret':keys['medplum-admin-client-secret']},authorization)
        assert code == 201, 'Bootstrap client creation failed'
        retain('medplum-bootstrap-client',client)
        keys['medplum-admin-client-id'] = client['id']
        keys['medplum-admin-client-secret'] = client['secret']
        with open(directory/'secrets.json','w') as stream:
            json.dump(keys,stream,indent=2)
        basic = 'Basic '+base64.b64encode((client['id']+':'+client['secret']).encode()).decode()
        code, outcome = request('http://127.0.0.1:23802','/auth/changepassword',{'oldPassword':'medplum_admin','newPassword':keys['medplum-admin']},authorization)
        assert code == 200, 'Default bootstrap password rotation failed'
        code, token = request('http://127.0.0.1:23802','/oauth2/token',{'grant_type':'client_credentials','client_id':keys['medplum-admin-client-id']},basic,True)
        assert code == 200, 'Generated bootstrap client authentication failed'
        print('PASS empty upstream bootstrap repaired and default password rotated through supported API')
    assert code == 200, 'Medplum bootstrap authentication failed'
    if code == 200:
        code, me = request('http://127.0.0.1:23802','/auth/me',authorization='Bearer '+token['access_token'])
        retain('medplum-identity',me)
        print('Medplum authenticated identity HTTP',code,'fields',sorted(me.keys()))
        authorization = 'Bearer '+token['access_token']
        assert code == 200, 'Medplum identity failed'
        if 'medplum-project' not in state:
            assert not state.get('medplum-project-requested'), 'Ambiguous project creation; reconcile before retry'
            retain('medplum-project-requested',True)
            code, project = request('http://127.0.0.1:23802','/fhir/R4/Project',{'resourceType':'Project',
                'name':'Codexdentist private interoperability','strictMode':True},authorization)
            retain('medplum-project-response',project)
            assert code == 201, 'Medplum project creation failed'
            retain('medplum-project',project)
        if 'medplum-client' not in state:
            assert not state.get('medplum-client-requested'), 'Ambiguous client creation; reconcile before retry'
            retain('medplum-client-requested',True)
            code, client = request('http://127.0.0.1:23802','/admin/projects/'+state['medplum-project']['id']+'/client',
                {'name':'Codexdentist Patient export'},authorization)
            retain('medplum-client-response',client)
            assert code == 201, 'Medplum project client creation failed'
            retain('medplum-client',client)
        client = state['medplum-client']
        retain('medplum-config',{'baseUrl':'http://codexdentist-medplum:8103','clientId':client['id'],
            'clientSecret':client['secret'],'projectId':state['medplum-project']['id']})
        print('PASS separate Medplum project and project-bound application credentials')
        if 'medplum-qa-project' not in state:
            assert not state.get('medplum-qa-project-requested'), 'Ambiguous QA project creation'
            retain('medplum-qa-project-requested',True)
            code, project = request('http://127.0.0.1:23802','/fhir/R4/Project',{'resourceType':'Project',
                'name':'Codexdentist synthetic acceptance','strictMode':True},authorization)
            assert code == 201, 'Medplum QA project creation failed'
            retain('medplum-qa-project',project)
        if 'medplum-qa-client' not in state:
            assert not state.get('medplum-qa-client-requested'), 'Ambiguous QA client creation'
            retain('medplum-qa-client-requested',True)
            code, client = request('http://127.0.0.1:23802','/admin/projects/'+state['medplum-qa-project']['id']+'/client',
                {'name':'Synthetic acceptance client'},authorization)
            assert code == 201, 'Medplum QA client creation failed'
            retain('medplum-qa-client',client)
        client = state['medplum-qa-client']
        retain('medplum-qa-config',{'baseUrl':'http://codexdentist-medplum:8103','clientId':client['id'],
            'clientSecret':client['secret'],'projectId':state['medplum-qa-project']['id']})
    if 'novu-password' not in state or not any(c.isupper() for c in state['novu-password']):
        retain('novu-password','Cdx!'+secrets.token_hex(24))
    base = 'http://127.0.0.1:23804'
    if 'novu-register-response' not in state or state['novu-register-response'].get('statusCode') == 422:
        code, result = request(base,'/v1/auth/register',{'email':keys['owner-email'],'password':state['novu-password'],
            'firstName':'Codexdentist','lastName':'Owner','organizationName':'Codexdentist private notifications'})
        retain('novu-register-response',result)
        print('Novu owned administrator bootstrap HTTP',code,'fields', sorted(result.keys()))
    code, result = request(base,'/v1/auth/login',{'email':keys['owner-email'],'password':state['novu-password']})
    retain('novu-login-response',result)
    print('Novu private login HTTP',code,'fields',sorted(result.keys()))
    data = result.get('data',{})
    token = data.get('token') or data.get('accessToken') or result.get('token')
    assert code == 201 and token, 'Novu owned administrator login failed'
    code, environments = request(base,'/v1/environments',authorization='Bearer '+token)
    assert code == 200, 'Novu environment discovery failed'
    environment = next(item for item in environments['data'] if item['name'] == 'Production')
    config = {'baseUrl':'http://codexdentist-novu:3000','apiKey':environment['apiKeys'][0]['key'], 'environmentId':environment['_id'],
        'workflowId':'codexdentist-notice','testSubscriberId':'cdx-test-operator','deliveryChannel':'in_app'}
    retain('novu-config',config)
    api_auth = 'ApiKey '+config['apiKey']
    code, integrations = request(base,'/v1/integrations/active',authorization=api_auth)
    assert code == 200, 'Novu integration discovery failed'
    active = integrations if isinstance(integrations,list) else integrations.get('data',[])
    if not any(item.get('channel') == 'in_app' for item in active):
        code, result = request(base,'/v1/integrations',{'providerId':'novu','channel':'in_app','active':True,
            'name':'Codexdentist private inbox','primary':True,'credentials':{}},api_auth)
        retain('novu-inbox-create-response',result)
        assert code == 201, 'Novu inbox integration creation failed'
    for path in ['/v1/environments','/v1/integrations/active','/v2/workflows']:
        code, result = request(base,path,authorization=api_auth)
        retain('novu'+path.replace('/','-'),result)
        print('Novu authenticated API-key probe',path,'HTTP',code)
        assert code == 200, 'Novu API-key discovery failed'
    code, result = request(base,'/v2/subscribers?failIfExists=true',{'subscriberId':config['testSubscriberId'],
        'data':{'codexdentistSynthetic':True}},api_auth)
    assert code in [201,409], 'Novu synthetic subscriber creation failed'
    code, result = request(base,'/v2/workflows/'+config['workflowId'],authorization=api_auth)
    if code == 404:
        code, result = request(base,'/v2/workflows',{'workflowId':config['workflowId'],'name':'Private clinic notice',
            'steps':[{'stepId':'inbox','name':'In-app notice','type':'in_app','controlValues':{'body':'A clinic notification is available.'}}]},api_auth)
        retain('novu-workflow-create-response',result)
        print('Novu in-app workflow creation HTTP',code)
        assert code == 201, 'Novu in-app workflow creation failed'
    retain('novu-workflow',result)

if __name__ == '__main__':
    main()
