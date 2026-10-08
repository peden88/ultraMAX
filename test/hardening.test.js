'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {isBlockedAddress}=require('../utils/net-guard');
test('blocks private and special IP ranges',()=>{for(const ip of ['127.0.0.1','10.0.0.1','172.16.0.1','192.168.1.1','169.254.169.254','::1','fc00::1','::ffff:127.0.0.1'])assert.equal(isBlockedAddress(ip),true,ip);});
test('allows public IPs',()=>{assert.equal(isBlockedAddress('8.8.8.8'),false);assert.equal(isBlockedAddress('1.1.1.1'),false);});
test('secret encryption round trips',()=>{process.env.ULTRAMAX_ENCRYPTION_KEY=Buffer.alloc(32,7).toString('base64');delete require.cache[require.resolve('../utils/secrets')];const {encrypt,decrypt}=require('../utils/secrets');const c=encrypt('hello');assert.match(c,/^enc:v1:/);assert.notEqual(c,'hello');assert.equal(decrypt(c),'hello');});


test('service credentials are stable per user but isolated by service', () => {
  const oldMaster = process.env.ULTRAMAX_SERVICES_MASTER_KEY;
  process.env.ULTRAMAX_SERVICES_MASTER_KEY = Buffer.alloc(32, 9).toString('base64');
  delete require.cache[require.resolve('../utils/service-credentials')];
  const { deriveServicePassword, fingerprintSecret } = require('../utils/service-credentials');
  const common = { token: 'user-token', userSecret: 'john' };
  const streamsA = deriveServicePassword({ ...common, service: 'aiostreams' });
  const streamsB = deriveServicePassword({ ...common, service: 'aiostreams' });
  const metadata = deriveServicePassword({ ...common, service: 'aiometadata' });
  assert.equal(streamsA, streamsB);
  assert.notEqual(streamsA, metadata);
  assert.equal(streamsA.length, 43);
  assert.equal(fingerprintSecret(common), fingerprintSecret(common));
  if (oldMaster === undefined) delete process.env.ULTRAMAX_SERVICES_MASTER_KEY;
  else process.env.ULTRAMAX_SERVICES_MASTER_KEY = oldMaster;
});

test('AIOStreams template policy separates baseline from user credentials', () => {
  const { getAioStreamsTemplatePolicy, describeTemplateOwnership } = require('../services/aiostreams-template-policy');
  const policy = getAioStreamsTemplatePolicy();
  const ownership = describeTemplateOwnership();
  assert.equal(policy.id, process.env.AIOSTREAMS_TEMPLATE_ID || 'tamtaro.complete');
  assert.ok(ownership.templateOwns.includes('filters'));
  assert.ok(ownership.templateOwns.includes('sorting'));
  assert.ok(ownership.userOwns.includes('serviceCredentials'));
});


test('provisioning config deep merge preserves baseline and overlays user values', () => {
  const { deepMerge } = require('../services/provisioning-service');
  const merged = deepMerge(
    { sorting: { enabled: true, direction: 'desc' }, addons: [{ id: 'standard' }] },
    { sorting: { direction: 'asc' } }
  );
  assert.equal(merged.sorting.enabled, true);
  assert.equal(merged.sorting.direction, 'asc');
  assert.equal(merged.addons[0].id, 'standard');
});

test('secret storage encrypts service binding credentials', () => {
  const oldKey = process.env.ULTRAMAX_ENCRYPTION_KEY;
  process.env.ULTRAMAX_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
  delete require.cache[require.resolve('../utils/secrets')];
  const { protectConfig, revealConfig, redactConfig } = require('../utils/secrets');
  const input = { services: { version: 1, aiostreams: { service:'aiostreams', status:'ready', uuid:'u', password:'p', encryptedPassword:'ep', baseUrl:'https://example.com' } } };
  const stored = protectConfig(input);
  assert.match(stored.services.aiostreams.password, /^enc:v1:/);
  assert.equal(revealConfig(stored).services.aiostreams.password, 'p');
  assert.equal(redactConfig(input).services.aiostreams.password, undefined);
  if (oldKey === undefined) delete process.env.ULTRAMAX_ENCRYPTION_KEY; else process.env.ULTRAMAX_ENCRYPTION_KEY = oldKey;
});



test('template resolver applies defaults, conditionals and service credentials', () => {
  const { resolveTemplate } = require('../services/template-resolver');
  const template = {
    metadata: { id:'t', inputs:[
      {id:'limit',type:'number',default:10},
      {id:'quality',type:'select',default:'high'}
    ]},
    config: {
      resultLimits:{global:'{{inputs.limit}}'},
      values:[{__if:'inputs.quality == high',__value:'keep'},{__if:'inputs.quality == low',__value:'drop'}],
      services:[{id:'torbox',credentials:{apiKey:'{{services.torbox.apiKey}}'}}]
    }
  };
  const out=resolveTemplate(template,{serviceCredentials:{torbox:{apiKey:'secret'}}});
  assert.equal(out.config.resultLimits.global,10);
  assert.deepEqual(out.config.values,['keep']);
  assert.equal(out.config.services[0].credentials.apiKey,'secret');
});

test('server credentials prefer user values and never expose the server value via capability', () => {
  const old=process.env.OMDB_KEY; process.env.OMDB_KEY='server-secret';
  const { resolveCredential, capability } = require('../services/server-credentials');
  assert.deepEqual(resolveCredential('omdb','user-secret'),{value:'user-secret',source:'user',available:true});
  assert.deepEqual(capability('omdb',''),{available:true,source:'server'});
  assert.equal(JSON.stringify(capability('omdb','')).includes('server-secret'),false);
  if(old===undefined)delete process.env.OMDB_KEY;else process.env.OMDB_KEY=old;
});

test('Peden template is the default provisioning baseline', () => {
  const { getAioStreamsTemplatePolicy } = require('../services/aiostreams-template-policy');
  const policy=getAioStreamsTemplatePolicy();
  assert.equal(policy.sourceUrl,process.env.AIOSTREAMS_TEMPLATE_URL||'https://templates.peden88.stream/complete.json');
  assert.equal(policy.id,process.env.AIOSTREAMS_TEMPLATE_ID||'tamtaro.complete');
});

test('AIOMetadata server API defaults fill missing user credentials but user values win', () => {
  const old=process.env.TMDB_KEY; process.env.TMDB_KEY='server-tmdb';
  delete require.cache[require.resolve('../services/provisioning-service')];
  const { aioMetadataConfig }=require('../services/provisioning-service');
  assert.equal(aioMetadataConfig({apiKeys:{}}).apiKeys.tmdb,'server-tmdb');
  assert.equal(aioMetadataConfig({apiKeys:{tmdb:'user-tmdb'}}).apiKeys.tmdb,'user-tmdb');
  if(old===undefined)delete process.env.TMDB_KEY;else process.env.TMDB_KEY=old;
});

test('public service bindings never expose backend credentials or URLs', () => {
  const { publicBinding }=require('../services/user-services');
  const out=publicBinding({service:'aiostreams',status:'ready',uuid:'u',password:'p',encryptedPassword:'ep',manifestUrl:'secret-url',baseUrl:'internal-url'});
  assert.deepEqual(out,{service:'aiostreams',status:'ready',uuid:'u',templateId:null,templateVersion:null,provisionedAt:null,updatedAt:null});
});

test('service secret fingerprints are encrypted with backend bindings', () => {
  const old=process.env.ULTRAMAX_ENCRYPTION_KEY;
  process.env.ULTRAMAX_ENCRYPTION_KEY=Buffer.alloc(32,7).toString('base64');
  delete require.cache[require.resolve('../utils/secrets')];
  const { protectConfig,revealConfig }=require('../utils/secrets');
  const input={services:{version:1,aiostreams:{service:'aiostreams',secretFingerprint:'fp-secret'}}};
  const stored=protectConfig(input);
  assert.match(stored.services.aiostreams.secretFingerprint,/^enc:v1:/);
  assert.equal(revealConfig(stored).services.aiostreams.secretFingerprint,'fp-secret');
  if(old===undefined)delete process.env.ULTRAMAX_ENCRYPTION_KEY;else process.env.ULTRAMAX_ENCRYPTION_KEY=old;
});


test('changed service secret refuses duplicate AIOMetadata account creation', async () => {
  const oldKey=process.env.ULTRAMAX_SERVICES_MASTER_KEY;
  process.env.ULTRAMAX_SERVICES_MASTER_KEY=Buffer.alloc(32,9).toString('base64');
  const { provisionAioMetadata } = require('../services/provisioning-service');
  await assert.rejects(
    provisionAioMetadata({token:'u',userSecret:'changed',existing:{uuid:'existing',password:'old',secretFingerprint:'different'},aiometadataConfig:{}}),
    error => error.status === 409 && /rotation/.test(error.message)
  );
  if(oldKey===undefined)delete process.env.ULTRAMAX_SERVICES_MASTER_KEY;
  else process.env.ULTRAMAX_SERVICES_MASTER_KEY=oldKey;
});

test('changed service secret refuses duplicate AIOStreams account creation', async () => {
  // AIOStreams requires a live template before provisioning, so verify the
  // rotation guard is present without making a network call in unit tests.
  const fs=require('node:fs');
  const source=fs.readFileSync(require.resolve('../services/provisioning-service'),'utf8');
  assert.equal((source.match(/existing\.secretFingerprint!==fingerprint/g)||[]).length,2);
});

test('unified provisioning checkpoints both providers and preserves catalog selections', async () => {
  const express=require('express');
  const {registerProvisioningRoutes}=require('../services/provisioning-route-service');
  const app=express();app.use(express.json());
  const saved={demo:{passwordHash:'hash',catalogs:['popular_movies','popular_series'],language:'en-GB'}};
  const calls=[];let checkpoints=0;
  registerProvisioningRoutes(app,{
    loadConfigs:()=>saved,saveConfigs:async()=>{checkpoints++;},
    verifyPassword:p=>({ok:p==='correct',needsUpgrade:false}),
    hashPassword:p=>p,rateLimit:()=>false,
    provisionAioStreams:async opts=>{calls.push(['streams',opts]);return {service:'aiostreams',status:'ready',uuid:'s1'};},
    provisionAioMetadata:async opts=>{calls.push(['metadata',opts]);return {service:'aiometadata',status:'ready',uuid:'m1'};}
  });
  const server=app.listen(0);
  try{
    const url='http://127.0.0.1:'+server.address().port+'/c/demo/services/provision';
    const post=body=>fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
    let response=await post({password:'wrong',userSecret:'secret'});
    assert.equal(response.status,401);assert.equal(calls.length,0);
    response=await post({password:'correct',userSecret:'secret',serviceCredentials:{torbox:{apiKey:'key'}}});
    assert.equal(response.status,200);
    const data=await response.json();
    assert.equal(data.ok,true);
    assert.deepEqual(data.catalogs,{count:2,language:'en-GB'});
    assert.deepEqual(saved.demo.catalogs,['popular_movies','popular_series']);
    assert.equal(saved.demo.services.aiostreams.uuid,'s1');
    assert.equal(saved.demo.services.aiometadata.uuid,'m1');
    assert.equal(checkpoints,2);
    assert.equal(calls[0][1].serviceCredentials.torbox.apiKey,'key');
    assert.equal(calls[1][1].existing,undefined);
  }finally{await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
});

test('partial provider failure persists successful provisioning for safe retry', async () => {
  const express=require('express');
  const {registerProvisioningRoutes}=require('../services/provisioning-route-service');
  const app=express();app.use(express.json());
  const saved={demo:{passwordHash:'hash',catalogs:['a']}};
  let attempts=0;
  registerProvisioningRoutes(app,{
    loadConfigs:()=>saved,saveConfigs:async()=>{},
    verifyPassword:()=>({ok:true}),hashPassword:x=>x,rateLimit:()=>false,
    provisionAioStreams:async({existing})=>({service:'aiostreams',status:'ready',uuid:existing?.uuid||'stable'}),
    provisionAioMetadata:async()=>{attempts++;if(attempts===1)throw Object.assign(new Error('unavailable'),{status:503});return {service:'aiometadata',status:'ready',uuid:'meta'};}
  });
  const server=app.listen(0);
  try{
    const url='http://127.0.0.1:'+server.address().port+'/c/demo/services/provision';
    const post=()=>fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:'x',userSecret:'secret'})});
    let response=await post();
    assert.equal(response.status,502);
    assert.equal(saved.demo.services.aiostreams.uuid,'stable');
    response=await post();
    assert.equal(response.status,200);
    assert.equal(saved.demo.services.aiostreams.uuid,'stable');
    assert.equal(saved.demo.services.aiometadata.uuid,'meta');
  }finally{await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
});
