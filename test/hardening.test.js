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
  assert.equal(policy.id, process.env.AIOSTREAMS_TEMPLATE_ID || 'ultramax.standard');
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
