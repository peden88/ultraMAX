'use strict';

const { provisionAioStreams, provisionAioMetadata } = require('./provisioning-service');
const { publicBinding } = require('./user-services');

function registerProvisioningRoutes(app, deps) {
  const { loadConfigs, saveConfigs, verifyPassword, hashPassword, rateLimit } = deps;
  const createStreams = deps.provisionAioStreams || provisionAioStreams;
  const createMetadata = deps.provisionAioMetadata || provisionAioMetadata;

  app.post('/c/:token/services/provision', async (req, res) => {
    const ip = req.ip || req.socket.remoteAddress;
    if (rateLimit('provision:' + ip, 5, 60000)) return res.status(429).json({ error: 'Too many provisioning requests.' });

    const { token } = req.params;
    const configs = loadConfigs();
    const config = configs[token];
    if (!config) return res.status(404).json({ error: 'Config not found' });

    const check = verifyPassword(req.body?.password, config.passwordHash);
    if (!check.ok) return res.status(401).json({ error: 'Incorrect password' });
    if (check.needsUpgrade) config.passwordHash = hashPassword(req.body.password);

    const userSecret=req.body?.userSecret;
    if(!userSecret||String(userSecret).length<2)return res.status(400).json({error:'A user services secret is required'});
    config.services=config.services||{version:1};
    const failures=[];
    // The ultraMAX catalog selection remains authoritative. Provider-specific
    // overrides are passed separately and never overwrite the catalog choices.
    const selectedCatalogs=Array.isArray(config.catalogs)?config.catalogs:[];
    const selectedLanguage=config.language||'en-US';
    const metadataOverrides=req.body?.aiometadataConfig||{};
    const streamsOverrides=req.body?.aiostreamsConfig||{};
    const checkpoint=async(service,binding)=>{
      config.services.version=1;
      config.services[service]=binding;
      config.updatedAt=new Date().toISOString();
      await saveConfigs(configs);
    };

    try {
      await checkpoint('aiostreams',await createStreams({
        token,userSecret,existing:config.services.aiostreams,
        aiostreamsConfig:streamsOverrides,
        serviceCredentials:req.body?.serviceCredentials||{}
      }));
    } catch(error) {
      console.error('AIOStreams provisioning failed:',error?.message||error);
      failures.push({service:'aiostreams',status:error?.status||null});
    }

    try {
      await checkpoint('aiometadata',await createMetadata({
        token,userSecret,existing:config.services.aiometadata,
        aiometadataConfig:metadataOverrides
      }));
    } catch(error) {
      console.error('AIOMetadata provisioning failed:',error?.message||error);
      failures.push({service:'aiometadata',status:error?.status||null});
    }

    const services={
      aiostreams:publicBinding(config.services.aiostreams),
      aiometadata:publicBinding(config.services.aiometadata)
    };
    if(failures.length)return res.status(502).json({ok:false,error:'One or more backend services failed to provision',failures,services});
    res.json({ok:true,services,catalogs:{count:selectedCatalogs.length,language:selectedLanguage}});
  });

  app.post('/c/:token/services/check', async (req,res)=>{
    const {token}=req.params,configs=loadConfigs(),config=configs[token];
    if(!config)return res.status(404).json({error:'Config not found'});
    const check=verifyPassword(req.body?.password,config.passwordHash);
    if(!check.ok)return res.status(401).json({error:'Incorrect password'});
    const out={};
    for(const service of ['aiostreams','aiometadata']){
      const binding=config.services?.[service];
      if(!binding?.uuid){out[service]={status:'unprovisioned'};continue;}
      try{
        if(service==='aiostreams')await require('./provider-client').checkAioStreams({binding});
        else await require('./provider-client').checkAioMetadata({binding});
        out[service]={status:'ready'};
      }catch(error){out[service]={status:'unreachable',providerStatus:error?.status||null};}
    }
    res.json(out);
  });

  app.post('/c/:token/services/status', (req, res) => {
    const { token } = req.params;
    const configs = loadConfigs();
    const config = configs[token];
    if (!config) return res.status(404).json({ error: 'Config not found' });
    const check = verifyPassword(req.body?.password, config.passwordHash);
    if (!check.ok) return res.status(401).json({ error: 'Incorrect password' });
    res.json({
      aiostreams: publicBinding(config.services?.aiostreams),
      aiometadata: publicBinding(config.services?.aiometadata)
    });
  });
}
module.exports = { registerProvisioningRoutes };
