'use strict';

const crypto = require('crypto');

const CONTEXTS = Object.freeze({
  aiostreams: 'ultramax:user-services:aiostreams:v1',
  aiometadata: 'ultramax:user-services:aiometadata:v1'
});

function masterKey() {
  const raw = process.env.ULTRAMAX_SERVICES_MASTER_KEY || process.env.ULTRAMAX_ENCRYPTION_KEY;
  if (!raw) throw new Error('ULTRAMAX_SERVICES_MASTER_KEY (or ULTRAMAX_ENCRYPTION_KEY) is required for service provisioning');
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error('UltraMAX services master key must be base64 for exactly 32 bytes');
  return key;
}

function deriveServicePassword({ token, userSecret, service }) {
  if (!token || !userSecret || !CONTEXTS[service]) throw new Error('token, userSecret and a supported service are required');
  const salt = crypto.createHmac('sha256', masterKey()).update(String(token)).digest();
  const info = Buffer.from(CONTEXTS[service], 'utf8');
  const ikm = Buffer.from(String(userSecret), 'utf8');
  return Buffer.from(crypto.hkdfSync('sha256', ikm, salt, info, 32)).toString('base64url');
}

function fingerprintSecret({ token, userSecret }) {
  return crypto.createHmac('sha256', masterKey())
    .update('ultramax:user-services:fingerprint:v1\0')
    .update(String(token))
    .update('\0')
    .update(String(userSecret))
    .digest('base64url');
}

module.exports = { deriveServicePassword, fingerprintSecret, CONTEXTS };
