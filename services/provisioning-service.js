'use strict';

const { deriveServicePassword, fingerprintSecret } = require('../utils/service-credentials');
const { getAioStreamsTemplatePolicy, loadAioStreamsTemplate } = require('./aiostreams-template-policy');
const { resolveTemplate } = require('./template-resolver');
const providers = require('./provider-client');

function parseJsonEnv(name, fallback = {}) {
  const raw=process.env[name]; if(!raw)return fallback;
  try{return JSON.parse(raw);}catch{throw new Error(name+' must contain valid JSON');}
}
function deepMerge(base, overlay) {
  if(Array.isArray(overlay))return overlay.slice();
  if(!overlay||typeof overlay!=='object')return overlay===undefined?base:overlay;
  const out=base&&typeof base==='object'&&!Array.isArray(base)?{...base}:{};
  for(const[key,value]of Object.entries(overlay))out[key]=deepMerge(out[key],value);
  return out;
}
async function aioStreamsConfig(userOverlay={},serviceCredentials={}) {
  const template=await loadAioStreamsTemplate();
  const inputOverrides=userOverlay?.templateInputs||{};
  const explicit={...(userOverlay||{})}; delete explicit.templateInputs;
  // Provider credentials must come from the dedicated credential input, not an
  // arbitrary config overlay that can silently replace the provisioned services.
  delete explicit.services;
  const resolved=resolveTemplate(template,{inputOverrides,serviceCredentials}).config;
  const merged=deepMerge(resolved,explicit);
  if (!Array.isArray(merged.services)) merged.services=[];
  const credentialServices=Object.entries(serviceCredentials||{})
    .filter(([,c])=>c&&typeof c==='object'&&Object.values(c).some(Boolean))
    .map(([id,c])=>({id,enabled:true,credentials:Object.fromEntries(Object.entries(c).filter(([,v])=>v!=null&&v!==''))}));
  if(credentialServices.length){
    const byId=new Map((merged.services||[]).map(s=>[s.id,s]));
    for(const service of credentialServices)byId.set(service.id,deepMerge(byId.get(service.id)||{},service));
    merged.services=Array.from(byId.values());
  }
  return merged;
}
function aioMetadataConfig(userOverlay={}) {
  const { resolveCredential }=require('./server-credentials');
  const merged=deepMerge(parseJsonEnv('AIOMETADATA_PROVISIONING_CONFIG_JSON',{apiKeys:{}}),userOverlay||{});
  merged.apiKeys=merged.apiKeys||{};
  const map={tmdb:'tmdb',tvdb:'tvdb',fanart:'fanart',omdb:'omdb',mdblist:'mdblist',rpdb:'rpdb'};
  for(const [field,name] of Object.entries(map)){
    const resolved=resolveCredential(name,merged.apiKeys[field]);
    if(resolved.available)merged.apiKeys[field]=resolved.value;
  }
  return merged;
}
async function provisionAioStreams({token,userSecret,existing,aiostreamsConfig,serviceCredentials={}}) {
  if(!userSecret||String(userSecret).length<2)throw new Error('A user services secret is required');
  const templatePolicy=getAioStreamsTemplatePolicy(),template=await loadAioStreamsTemplate();
  const config=await aioStreamsConfig(aiostreamsConfig,serviceCredentials);
  const password=deriveServicePassword({token,userSecret,service:'aiostreams'});
  const fingerprint=fingerprintSecret({token,userSecret});
  const canUpdate=existing?.uuid&&existing?.password&&(!existing.secretFingerprint||existing.secretFingerprint===fingerprint);
  const binding=canUpdate
    ?await providers.updateAioStreamsUser({binding:existing,config})
    :await providers.createAioStreamsUser({password,config});
  binding.secretFingerprint=fingerprint;
  binding.templateId=template.metadata.id||templatePolicy.id;
  binding.templateVersion=template.metadata.version||templatePolicy.version;
  binding.provisionedAt=existing?.provisionedAt||new Date().toISOString();
  return binding;
}
async function provisionAioMetadata({token,userSecret,existing,aiometadataConfig}) {
  if(!userSecret||String(userSecret).length<2)throw new Error('A user services secret is required');
  const config=aioMetadataConfig(aiometadataConfig);
  const password=deriveServicePassword({token,userSecret,service:'aiometadata'});
  const fingerprint=fingerprintSecret({token,userSecret});
  const canUpdate=existing?.uuid&&existing?.password&&(!existing.secretFingerprint||existing.secretFingerprint===fingerprint);
  const binding=canUpdate
    ?await providers.updateAioMetadataUser({binding:existing,config})
    :await providers.createAioMetadataUser({password,config});
  binding.secretFingerprint=fingerprint;
  binding.provisionedAt=existing?.provisionedAt||new Date().toISOString();
  return binding;
}
async function provisionUserServices({token,userSecret,existing={},aiostreamsConfig,aiometadataConfig,serviceCredentials={}}) {
  const result={version:1,secretFingerprint:fingerprintSecret({token,userSecret})};
  result.aiostreams=await provisionAioStreams({token,userSecret,existing:existing.aiostreams,aiostreamsConfig,serviceCredentials});
  result.aiometadata=await provisionAioMetadata({token,userSecret,existing:existing.aiometadata,aiometadataConfig});
  return result;
}
module.exports={provisionUserServices,provisionAioStreams,provisionAioMetadata,deepMerge,aioStreamsConfig,aioMetadataConfig};
