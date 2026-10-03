'use strict';

const { encrypt, decrypt } = require('../utils/secrets');

const SUPPORTED_SERVICES = new Set(['aiostreams', 'aiometadata']);

function emptyServices() {
  return {
    version: 1,
    aiostreams: { status: 'unprovisioned' },
    aiometadata: { status: 'unprovisioned' }
  };
}

function protectBinding(binding) {
  if (!binding || !SUPPORTED_SERVICES.has(binding.service)) return binding;
  const out = { ...binding };
  for (const field of ['password', 'encryptedPassword', 'manifestUrl', 'baseUrl']) {
    if (out[field]) out[field] = encrypt(out[field]);
  }
  return out;
}

function revealBinding(binding) {
  if (!binding || !SUPPORTED_SERVICES.has(binding.service)) return binding;
  const out = { ...binding };
  for (const field of ['password', 'encryptedPassword', 'manifestUrl', 'baseUrl']) {
    if (out[field]) out[field] = decrypt(out[field]);
  }
  return out;
}

function publicBinding(binding) {
  if (!binding) return null;
  return {
    service: binding.service,
    status: binding.status || 'unknown',
    uuid: binding.uuid || null,
    templateId: binding.templateId || null,
    templateVersion: binding.templateVersion || null,
    provisionedAt: binding.provisionedAt || null,
    updatedAt: binding.updatedAt || null
  };
}

module.exports = { emptyServices, protectBinding, revealBinding, publicBinding, SUPPORTED_SERVICES };
