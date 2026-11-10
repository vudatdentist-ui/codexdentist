const test=require('node:test'),assert=require('node:assert/strict');
const {binding}=require('./owned-signing-webhook-client.cjs');
const valid={purpose:'qa',email:'signing-qa@codexdentist.com',userId:4,teamId:4,connectionId:'synthetic_connection_123',secret:'a'.repeat(64),password:'b'.repeat(64)};
test('owned callback binding always uses exact internal TLS origin and connection path',()=>{
  assert.equal(binding(valid).url,'https://codexdentist-signing-callback:3443/api/integrations/documenso/webhooks/synthetic_connection_123');
  assert.equal(binding({...valid,purpose:'main',email:'signing-operator@codexdentist.com'}).purpose,'main');
});
test('foreign identity, path smuggling, weak secrets and unscoped teams fail before login',()=>{
  for(const changed of [{purpose:'foreign'},{email:'owner@example.test'},{userId:'4'},{teamId:null},{teamId:0},{userId:-1},{connectionId:'../foreign'},
    {connectionId:'a%2fb'},{secret:'short'},{password:'weak'},{secret:'z'.repeat(64)}])assert.throws(()=>binding({...valid,...changed}));
});
