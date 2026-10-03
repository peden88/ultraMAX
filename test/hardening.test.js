'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {isBlockedAddress}=require('../utils/net-guard');
test('blocks private and special IP ranges',()=>{for(const ip of ['127.0.0.1','10.0.0.1','172.16.0.1','192.168.1.1','169.254.169.254','::1','fc00::1','::ffff:127.0.0.1'])assert.equal(isBlockedAddress(ip),true,ip);});
test('allows public IPs',()=>{assert.equal(isBlockedAddress('8.8.8.8'),false);assert.equal(isBlockedAddress('1.1.1.1'),false);});
test('secret encryption round trips',()=>{process.env.ULTRAMAX_ENCRYPTION_KEY=Buffer.alloc(32,7).toString('base64');delete require.cache[require.resolve('../utils/secrets')];const {encrypt,decrypt}=require('../utils/secrets');const c=encrypt('hello');assert.match(c,/^enc:v1:/);assert.notEqual(c,'hello');assert.equal(decrypt(c),'hello');});
