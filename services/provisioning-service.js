'use strict';

const { deriveServicePassword, fingerprintSecret } = require('../utils/service-credentials');
const { getAioStreamsTemplatePolicy } = require('./aiostreams-template-policy');
const providers = require('./provider-client');

function parseJsonEnv(name, fallback = {}) {
  const raw = process.env[name];
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch { throw new Error(name + ' must contain valid JSON'); }
}

function deepMerge(base, overlay) {
  if (Array.isArray(overlay)) return overlay.slice();
  if (!overlay || typeof overlay !== 'object') return overlay === undefined ? base : overlay;
  const out = base && typeof base === 'object' && !Array.isArray(base) ? { ...base } : {};
  for (const [key, value] of Object.entries(overlay)) out[key] = deepMerge(out[key], value);
  return out;
}

function aioStreamsConfig(userOverlay = {}, serviceCredentials = {}) {
  // The canonical UltraMAX template is represented as resolved UserData JSON for
  // API provisioning. AIOSTREAMS_TEMPLATE_URL/ID remains metadata/version policy;
  // dynamic template UI expressions are intentionally not evaluated in UltraMAX.
  const merged = deepMerge(parseJsonEnv('AIOSTREAMS_PROVISIONING_CONFIG_JSON', {}), userOverlay || {});
  const credentialServices = Object.entries(serviceCredentials || {})
    .filter(([, credentials]) => credentials && typeof credentials === 'object' && Object.values(credentials).some(Boolean))
    .map(([id, credentials]) => ({ id, enabled: true, credentials: Object.fromEntries(Object.entries(credentials).filter(([, value]) => value != null && value !== '')) }));
  if (credentialServices.length) {
    const byId = new Map((merged.services || []).map(service => [service.id, service]));
    for (const service of credentialServices) byId.set(service.id, deepMerge(byId.get(service.id) || {}, service));
    merged.services = Array.from(byId.values());
  }
  return merged;
}

function aioMetadataConfig(userOverlay = {}) {
  return deepMerge(parseJsonEnv('AIOMETADATA_PROVISIONING_CONFIG_JSON', { apiKeys: {} }), userOverlay || {});
}

async function provisionUserServices({ token, userSecret, existing = {}, aiostreamsConfig, aiometadataConfig, serviceCredentials = {} }) {
  if (!userSecret || String(userSecret).length < 2) throw new Error('A user services secret is required');
  const template = getAioStreamsTemplatePolicy();
  const now = new Date().toISOString();
  const result = { version: 1, secretFingerprint: fingerprintSecret({ token, userSecret }) };

  const streamPassword = deriveServicePassword({ token, userSecret, service: 'aiostreams' });
  if (existing.aiostreams?.uuid && existing.aiostreams?.password) {
    result.aiostreams = await providers.updateAioStreamsUser({
      binding: existing.aiostreams,
      config: aioStreamsConfig(aiostreamsConfig, serviceCredentials)
    });
  } else {
    result.aiostreams = await providers.createAioStreamsUser({
      password: streamPassword,
      config: aioStreamsConfig(aiostreamsConfig, serviceCredentials)
    });
  }
  result.aiostreams.templateId = template.id;
  result.aiostreams.templateVersion = template.version;
  result.aiostreams.provisionedAt = existing.aiostreams?.provisionedAt || now;

  const metadataPassword = deriveServicePassword({ token, userSecret, service: 'aiometadata' });
  if (existing.aiometadata?.uuid && existing.aiometadata?.password) {
    result.aiometadata = await providers.updateAioMetadataUser({
      binding: existing.aiometadata,
      config: aioMetadataConfig(aiometadataConfig)
    });
  } else {
    result.aiometadata = await providers.createAioMetadataUser({
      password: metadataPassword,
      config: aioMetadataConfig(aiometadataConfig)
    });
  }
  result.aiometadata.provisionedAt = existing.aiometadata?.provisionedAt || now;
  return result;
}

module.exports = { provisionUserServices, deepMerge, aioStreamsConfig, aioMetadataConfig };
