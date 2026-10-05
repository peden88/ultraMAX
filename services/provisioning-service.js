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
  const resolved=resolveTemplate(template,{inputOverrides,serviceCredentials}).config;
  const merged=deepMerge(resolved,explicit);
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
  return deepMerge(parseJsonEnv('AIOMETADATA_PROVISIONING_CONFIG_JSON',{apiKeys:{}}),userOverlay||{});
}
async function provisionUserServices({token,userSecret,existing={},aiostreamsConfig,aiometadataConfig,serviceCredentials={}}) {
  if(!userSecret||String(userSecret).length<2)throw new Error('A user services secret is required');
  const templatePolicy=getAioStreamsTemplatePolicy(), template=await loadAioStreamsTemplate();
  const streamConfig=await aioStreamsConfig(aiostreamsConfig,serviceCredentials);
  const now=new Date().toISOString();
  const result={version:1,secretFingerprint:fingerprintSecret({token,userSecret})};
  const streamPassword=deriveServicePassword({token,userSecret,service:'aiostreams'});
  result.aiostreams=existing.aiostreams?.uuid&&existing.aiostreams?.password
    ?await providers.updateAioStreamsUser({binding:existing.aiostreams,config:streamConfig})
    :await providers.createAioStreamsUser({password:streamPassword,config:streamConfig});
  result.aiostreams.templateId=template.metadata.id||templatePolicy.id;
  result.aiostreams.templateVersion=template.metadata.version||templatePolicy.version;
  result.aiostreams.provisionedAt=existing.aiostreams?.provisionedAt||now;

  const metadataPassword=deriveServicePassword({token,userSecret,service:'aiometadata'});
  result.aiometadata=existing.aiometadata?.uuid&&existing.aiometadata?.password
    ?await providers.updateAioMetadataUser({binding:existing.aiometadata,config:aioMetadataConfig(aiometadataConfig)})
    :await providers.createAioMetadataUser({password:metadataPassword,config:aioMetadataConfig(aiometadataConfig)});
  result.aiometadata.provisionedAt=existing.aiometadata?.provisionedAt||now;
  return result;
}
module.exports={provisionUserServices,deepMerge,aioStreamsConfig,aioMetadataConfig};
