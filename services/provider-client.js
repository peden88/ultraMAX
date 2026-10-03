'use strict';

const { assertPublicUrl } = require('../utils/net-guard');

function base(value, name) {
  const raw = String(value || '').trim().replace(/\/$/, '');
  if (!raw) throw new Error(name + ' is not configured');
  return raw;
}

async function jsonRequest(url, options = {}) {
  await assertPublicUrl(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(process.env.PROVIDER_TIMEOUT_MS || 15000));
  try {
    const response = await fetch(url, {
      ...options,
      redirect: 'error',
      signal: controller.signal,
      headers: { 'content-type': 'application/json', ...(options.headers || {}) }
    });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text.slice(0, 500) }; }
    if (!response.ok) {
      const error = new Error('Provider request failed with HTTP ' + response.status);
      error.status = response.status;
      error.providerBody = data;
      throw error;
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function basic(uuid, password) {
  return 'Basic ' + Buffer.from(String(uuid) + ':' + String(password)).toString('base64');
}

async function createAioStreamsUser({ config, password }) {
  const root = base(process.env.AIOSTREAMS_BASE_URL, 'AIOSTREAMS_BASE_URL');
  const data = await jsonRequest(root + '/api/v1/user', {
    method: 'POST',
    body: JSON.stringify({ config, password })
  });
  const payload = data?.data || data;
  if (!payload?.uuid || !payload?.encryptedPassword) throw new Error('AIOStreams did not return uuid/encryptedPassword');
  return {
    service: 'aiostreams',
    status: 'ready',
    baseUrl: root,
    uuid: payload.uuid,
    password,
    encryptedPassword: payload.encryptedPassword,
    manifestUrl: root + '/stremio/' + encodeURIComponent(payload.uuid) + '/' + encodeURIComponent(payload.encryptedPassword) + '/manifest.json'
  };
}

async function updateAioStreamsUser({ binding, config }) {
  const root = base(binding.baseUrl || process.env.AIOSTREAMS_BASE_URL, 'AIOSTREAMS_BASE_URL');
  await jsonRequest(root + '/api/v1/user', {
    method: 'PUT',
    headers: { authorization: basic(binding.uuid, binding.password) },
    body: JSON.stringify({ config })
  });
  return { ...binding, status: 'ready', updatedAt: new Date().toISOString() };
}

async function fetchAioStreams({ binding, type, id }) {
  const root = base(binding.baseUrl || process.env.AIOSTREAMS_BASE_URL, 'AIOSTREAMS_BASE_URL');
  const url = root + '/stremio/' + encodeURIComponent(binding.uuid) + '/' + encodeURIComponent(binding.encryptedPassword) +
    '/stream/' + encodeURIComponent(type) + '/' + encodeURIComponent(id) + '.json';
  return jsonRequest(url, { method: 'GET', headers: { accept: 'application/json' } });
}

async function createAioMetadataUser({ config, password }) {
  const root = base(process.env.AIOMETADATA_BASE_URL, 'AIOMETADATA_BASE_URL');
  const body = { config, password };
  if (process.env.AIOMETADATA_ADDON_PASSWORD) body.addonPassword = process.env.AIOMETADATA_ADDON_PASSWORD;
  const data = await jsonRequest(root + '/api/config/save', { method: 'POST', body: JSON.stringify(body) });
  if (!data?.userUUID) throw new Error('AIOMetadata did not return userUUID');
  return {
    service: 'aiometadata',
    status: 'ready',
    baseUrl: root,
    uuid: data.userUUID,
    password,
    manifestUrl: data.installUrl || (root + '/stremio/' + encodeURIComponent(data.userUUID) + '/manifest.json')
  };
}

async function updateAioMetadataUser({ binding, config }) {
  const root = base(binding.baseUrl || process.env.AIOMETADATA_BASE_URL, 'AIOMETADATA_BASE_URL');
  const body = { config, password: binding.password };
  if (process.env.AIOMETADATA_ADDON_PASSWORD) body.addonPassword = process.env.AIOMETADATA_ADDON_PASSWORD;
  const data = await jsonRequest(root + '/api/config/update/' + encodeURIComponent(binding.uuid), {
    method: 'PUT',
    body: JSON.stringify(body)
  });
  return { ...binding, status: 'ready', manifestUrl: data?.installUrl || binding.manifestUrl, updatedAt: new Date().toISOString() };
}

async function fetchAioMetadata({ binding, type, id }) {
  const root = base(binding.baseUrl || process.env.AIOMETADATA_BASE_URL, 'AIOMETADATA_BASE_URL');
  const url = root + '/stremio/' + encodeURIComponent(binding.uuid) + '/meta/' +
    encodeURIComponent(type) + '/' + encodeURIComponent(id) + '.json';
  return jsonRequest(url, { method: 'GET', headers: { accept: 'application/json' } });
}

module.exports = {
  jsonRequest,
  createAioStreamsUser,
  updateAioStreamsUser,
  fetchAioStreams,
  createAioMetadataUser,
  updateAioMetadataUser,
  fetchAioMetadata
};
