#!/usr/bin/env python3
"""Read-only proof of the owned synthetic core/provider ceremony, not activation."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile

ROOT=Path('/opt/codexdentist-signing-core-qa')
PROVIDER=Path('/opt/codexdentist-owned-signing')


def validate(value):
    expected={'formCompleted':True,'signedFiles':1,'signedAudits':1,'journeyComments':1,
              'providerEnvelopeCompleted':True,'providerRecipientSigned':True,
              'successfulProviderCalls':3,'processedCoreEvents':3,'foreignRows':0,
              'sourceAndSignedScopeMatch':True,'sourceReferenceMatches':True}
    if any(type(value.get(key)) is not type(item) or value.get(key)!=item for key,item in expected.items()):raise ValueError('Actual core/provider/replay acceptance differs')
    if not re.fullmatch('[a-f0-9]{64}',value.get('signedSha256','')) or not isinstance(value.get('signedBytes'),int) or value['signedBytes']<1024:
        raise ValueError('Actual signed file integrity metadata required')
    if not re.fullmatch(r'patient-files/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+/[A-Za-z0-9_.-]+',value.get('storageKey','')):
        raise ValueError('Exact owned signed-file path required')


def verify_pdf(pdf,certificate):
    match=re.search(rb'/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]',pdf)
    if not match:raise ValueError('Actual PDF signature ByteRange required')
    a,b,c,d=map(int,match.groups())
    if a!=0 or not 0<b<c or c+d!=len(pdf):raise ValueError('PDF signature coverage differs')
    contents=re.search(rb'<([0-9A-Fa-f\s]+)>',pdf[b:c])
    if not contents:raise ValueError('PDF CMS contents required')
    der=bytes.fromhex(contents[1].decode())
    if len(der)<2:raise ValueError('Truncated CMS signature')
    start=2;length=der[1]
    if der[0]!=48:raise ValueError('CMS DER sequence required')
    if length&128:
        n=length&127
        if not 1<=n<=4:raise ValueError('Bounded CMS length required')
        length=int.from_bytes(der[start:start+n],'big');start+=n
    if start+length>len(der):raise ValueError('Truncated CMS signature')
    with tempfile.TemporaryDirectory(prefix='owned-core-signature-proof-') as temporary:
        root=Path(temporary);(root/'signature.der').write_bytes(der[:start+length]);signed=pdf[:b]+pdf[c:c+d];(root/'ranges').write_bytes(signed)
        command=['openssl','cms','-verify','-binary','-inform','DER','-in',str(root/'signature.der'),'-content',str(root/'ranges'),
                 '-noverify','-nointern','-certfile',str(certificate),'-out',os.devnull]
        if subprocess.run(command,capture_output=True).returncode:raise ValueError('Owned-certificate signature verification failed')
        changed=bytearray(signed);changed[30]^=1;(root/'tampered').write_bytes(changed);command[command.index(str(root/'ranges'))]=str(root/'tampered')
        if subprocess.run(command,capture_output=True).returncode==0:raise ValueError('Tampered signed content accepted')


def run(container,code,value):
    result=subprocess.run(['docker','exec','-i',container,'node','-e',code],input=json.dumps(value).encode(),capture_output=True)
    if result.returncode or len(result.stdout)>65536:raise ValueError('Private acceptance read failed; inspect scoped state without raw credential logs')
    return json.loads(result.stdout)


def main():
    if not hasattr(os,'geteuid') or os.geteuid()!=0 or ROOT.is_symlink() or ROOT.stat().st_uid!=0 or ROOT.stat().st_mode&0o077:
        raise ValueError('Private owned synthetic fixture required')
    os.umask(0o077);manifest=json.loads((ROOT/'manifest.json').read_text());fixture=json.loads((ROOT/'fixture.private.json').read_text())
    connection=json.loads((ROOT/'fixture.connection.json').read_text())
    if manifest.get('syntheticOnly') is not True or manifest.get('productionCoreAttached') is not False or fixture.get('syntheticOnly') is not True or not re.fullmatch('codexdentist-core-qa-[a-f0-9]{12}',manifest.get('project','')) or connection['organizationId']!=fixture['organizationId']:
        raise ValueError('Exact isolated QA scope required')
    container=manifest['project']+'-core-1'
    info=json.loads(subprocess.check_output(['docker','inspect',container]))[0]
    if info['Config']['Labels'].get('com.docker.compose.project')!=manifest['project'] or info['Config']['Image']!=manifest['image'] or not info['State']['Running']:
        raise ValueError('Exact live QA core required')
    code=r'''const fs=require('fs'),{PrismaClient}=require('@prisma/client'),{PrismaPg}=require('@prisma/adapter-pg');const v=JSON.parse(fs.readFileSync(0,'utf8'));const d=new URL(process.env.DATABASE_URL);if(d.hostname!=='database'||d.pathname!=='/coreqa'||process.env.NOTIFICATION_DELIVERY_MODE!=='disabled')throw Error();const p=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL})});(async()=>{const form=await p.patientForm.findUniqueOrThrow({where:{id:v.patientFormId}});const files=await p.patientFile.findMany({where:{organizationId:v.organizationId,category:'SIGNED_CONSENT'}});if(files.length!==1)throw Error();const file=files[0],source=await p.patientFile.findUniqueOrThrow({where:{id:v.sourceFileId}});const refs=await p.$queryRawUnsafe('SELECT "entityType",metadata,"externalId" FROM "ExternalReference" WHERE "organizationId"=$1 AND "internalId"=$2',v.organizationId,v.patientFormId);const request=refs.find(r=>r.entityType==='DOCUMENSO_REQUEST');const envelope=refs.find(r=>r.entityType==='DOCUMENSO_ENVELOPE');console.log(JSON.stringify({formCompleted:form.status==='COMPLETED'&&form.signatureUrl==='/patient-files/'+file.id,signedFiles:files.length,signedAudits:await p.auditLog.count({where:{organizationId:v.organizationId,entityId:v.patientFormId,action:'patient_form.signed_reconciled'}}),journeyComments:await p.journeyComment.count({where:{organizationId:v.organizationId,patientFileId:file.id}}),processedCoreEvents:(await p.$queryRawUnsafe('SELECT count(*)::int AS n FROM "IntegrationInbox" WHERE "connectionId"=$1 AND status=\'PROCESSED\'',v.connectionId))[0].n,foreignRows:await p.patientFile.count({where:{id:file.id,OR:[{organizationId:{not:v.organizationId}},{clinicId:{not:v.clinicId}},{patientId:{not:v.patientId}}]}}),sourceAndSignedScopeMatch:[file,source].every(f=>f.organizationId===v.organizationId&&f.clinicId===v.clinicId&&f.patientId===v.patientId),sourceReferenceMatches:request?.metadata?.sourcePatientFileId===v.sourceFileId&&request?.metadata?.status==='SIGNED'&&envelope?.metadata?.patientFileId===file.id,envelopeId:envelope?.externalId,storageKey:file.storageKey,signedSha256:file.checksumSha256,signedBytes:file.sizeBytes}))})().finally(()=>p.$disconnect());'''
    value=run(container,code,{**fixture,'connectionId':connection['connectionId']})
    provider_code=r'''const fs=require('fs'),{PrismaClient}=require('@prisma/client');const v=JSON.parse(fs.readFileSync(0,'utf8'));const p=new PrismaClient();(async()=>{const e=await p.envelope.findUniqueOrThrow({where:{id:v.envelopeId},include:{recipients:true}});const calls=await p.webhookCall.findMany({where:{webhook:{teamId:4,userId:4},status:'SUCCESS',event:'DOCUMENT_COMPLETED'}});console.log(JSON.stringify({providerEnvelopeCompleted:e.status==='COMPLETED'&&e.teamId===4&&e.externalId===v.patientFormId,providerRecipientSigned:e.recipients.length===1&&e.recipients[0].signingStatus==='SIGNED'&&e.recipients[0].email===v.recipientEmail,successfulProviderCalls:calls.filter(c=>c.responseCode===200&&c.requestBody?.payload?.envelopeId===v.envelopeId&&c.requestBody?.payload?.externalId===v.patientFormId).length}))})().finally(()=>p.$disconnect());'''
    value.update(run('codexdentist-owned-signing-app-1',provider_code,{**fixture,**value}));validate(value)
    path=ROOT/'files'/value['storageKey'].removeprefix('patient-files/')
    if path.is_symlink() or not path.is_file() or not path.resolve().is_relative_to((ROOT/'files').resolve()):raise ValueError('Owned signed storage scope differs')
    pdf=path.read_bytes()
    if len(pdf)!=value['signedBytes'] or hashlib.sha256(pdf).hexdigest()!=value['signedSha256']:raise ValueError('Actual stored signed bytes differ')
    verify_pdf(pdf,PROVIDER/'signing.cert.pem')
    accepted={'pass':True,'actualCoreProviderWebhook':True,'providerSuccesses':3,'processedCoreEvents':3,
              'signedFiles':1,'signedAudits':1,'journeyComments':1,'ownedCertificateCmsVerified':True,
              'tamperedSignedBytesDenied':True,'sha256':value['signedSha256'],'bytes':value['signedBytes'],
              'productionCoreConnected':False,'externalMailSent':False}
    target=ROOT/'full-core-acceptance.json'
    if target.exists():
        if target.is_symlink() or json.loads(target.read_text())!=accepted:raise ValueError('Preserve changed acceptance evidence')
    else:
        with target.open('x') as output:json.dump(accepted,output)
    print(json.dumps(accepted))


if __name__=='__main__':main()
