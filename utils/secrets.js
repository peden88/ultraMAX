'use strict';
const { createCipheriv, createDecipheriv, randomBytes } = require('crypto');
const PREFIX = 'enc:v1:', IV_LENGTH = 12, TAG_LENGTH = 16;

function key() {
  const raw = process.env.ULTRAMAX_ENCRYPTION_KEY;
  if (!raw) return null;
  const k = Buffer.from(raw, 'base64');
  if (k.length !== 32) throw new Error('ULTRAMAX_ENCRYPTION_KEY must be base64 for exactly 32 bytes');
  return k;
}
function encrypt(value) {
  if (value == null || value === '' || String(value).startsWith(PREFIX)) return value;
  const k = key(); if (!k) return value;
  const iv = randomBytes(IV_LENGTH), c = createCipheriv('aes-256-gcm', k, iv);
  const body = Buffer.concat([c.update(String(value), 'utf8'), c.final()]);
  return PREFIX + [iv, c.getAuthTag(), body].map(x => x.toString('base64url')).join('.');
}
function decrypt(value) {
  if (typeof value !== 'string' || !value.startsWith(PREFIX)) return value;
  const k = key(); if (!k) throw new Error('Encrypted config requires ULTRAMAX_ENCRYPTION_KEY');
  const [iv, tag, body] = value.slice(PREFIX.length).split('.').map(x => Buffer.from(x, 'base64url'));
  if (iv.length !== IV_LENGTH || tag.length !== TAG_LENGTH) throw new Error('Invalid encrypted secret');
  const d = createDecipheriv('aes-256-gcm', k, iv); d.setAuthTag(tag);
  return Buffer.concat([d.update(body), d.final()]).toString('utf8');
}

const SECRET_FIELDS = new Set(['mdbKey','mdblistKey','rpdbKey','tpKey','googleAiKey','fanartKey','omdbKey','traktAccessToken','traktRefreshToken','simklAccessToken']);
const BINDING_SECRET_FIELDS = ['password','encryptedPassword','manifestUrl','baseUrl','secretFingerprint'];

function mapBinding(binding, fn) {
  if (!binding || typeof binding !== 'object') return binding;
  const out = { ...binding };
  for (const field of BINDING_SECRET_FIELDS) if (out[field]) out[field] = fn(out[field]);
  return out;
}
function mapServices(services, fn) {
  if (!services || typeof services !== 'object') return services;
  return {
    ...services,
    aiostreams: mapBinding(services.aiostreams, fn),
    aiometadata: mapBinding(services.aiometadata, fn)
  };
}
function protectConfig(config) {
  const out = { ...config };
  for (const f of SECRET_FIELDS) if (f in out) out[f] = encrypt(out[f]);
  if (Array.isArray(out.streamAddons)) out.streamAddons = out.streamAddons.map(a => ({ ...a, manifestUrl: encrypt(a.manifestUrl) }));
  if (out.services) out.services = mapServices(out.services, encrypt);
  return out;
}
function revealConfig(config) {
  const out = { ...config };
  for (const f of SECRET_FIELDS) if (f in out) out[f] = decrypt(out[f]);
  if (Array.isArray(out.streamAddons)) out.streamAddons = out.streamAddons.map(a => ({ ...a, manifestUrl: decrypt(a.manifestUrl) }));
  if (out.services) out.services = mapServices(out.services, decrypt);
  return out;
}
function redactConfig(config) {
  const out = { ...config };
  for (const f of SECRET_FIELDS) if (out[f]) out[f] = '***';
  if (Array.isArray(out.streamAddons)) out.streamAddons = out.streamAddons.map(a => ({ ...a, manifestUrl: a.manifestUrl ? '***' : a.manifestUrl }));
  if (out.services) {
    out.services = {
      version: out.services.version,
      aiostreams: out.services.aiostreams ? { service:'aiostreams', status:out.services.aiostreams.status, uuid:out.services.aiostreams.uuid } : null,
      aiometadata: out.services.aiometadata ? { service:'aiometadata', status:out.services.aiometadata.status, uuid:out.services.aiometadata.uuid } : null
    };
  }
  return out;
}
module.exports = { encrypt, decrypt, protectConfig, revealConfig, redactConfig, SECRET_FIELDS };
