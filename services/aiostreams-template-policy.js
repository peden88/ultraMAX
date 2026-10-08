'use strict';

const { assertPublicUrl } = require('../utils/net-guard');
const DEFAULT_TEMPLATE_ID = 'tamtaro.complete';
const DEFAULT_TEMPLATE_URL = 'https://templates.peden88.stream/complete.json';
let cache = null;

function getAioStreamsTemplatePolicy() {
  return {
    id: process.env.AIOSTREAMS_TEMPLATE_ID || DEFAULT_TEMPLATE_ID,
    sourceUrl: process.env.AIOSTREAMS_TEMPLATE_URL || DEFAULT_TEMPLATE_URL,
    version: process.env.AIOSTREAMS_TEMPLATE_VERSION || null,
    mode: 'resolved-template-defaults-plus-user-credentials'
  };
}
async function loadAioStreamsTemplate({ force=false }={}) {
  const policy=getAioStreamsTemplatePolicy();
  const ttl=Math.max(60_000,Number(process.env.AIOSTREAMS_TEMPLATE_CACHE_MS||900_000));
  if(!force&&cache&&cache.url===policy.sourceUrl&&Date.now()-cache.at<ttl)return cache.template;
  await assertPublicUrl(policy.sourceUrl);
  const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),Number(process.env.AIOSTREAMS_TEMPLATE_TIMEOUT_MS||10000));
  try{
    const response=await fetch(policy.sourceUrl,{headers:{accept:'application/json'},redirect:'error',signal:controller.signal});
    if(!response.ok)throw new Error('Peden AIOStreams template returned HTTP '+response.status);
    const body=await response.json();
    const list=Array.isArray(body)?body:[body];
    const template=list.find(x=>x?.metadata?.id===policy.id);
    if(!template?.config)throw new Error('Template '+policy.id+' was not found in '+policy.sourceUrl);
    cache={url:policy.sourceUrl,at:Date.now(),template};
    return template;
  } finally { clearTimeout(timer); }
}
function describeTemplateOwnership() {
  return {
    templateOwns: ['addons','filters','sorting','matching','formatter','templateInputs'],
    userOwns: ['serviceCredentials','explicitOverrides'],
    ultraMaxOwns: ['binding','credentialDerivation','provisioningState','serverCredentialFallbacks']
  };
}
module.exports={DEFAULT_TEMPLATE_ID,DEFAULT_TEMPLATE_URL,getAioStreamsTemplatePolicy,loadAioStreamsTemplate,describeTemplateOwnership};
