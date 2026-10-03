'use strict';

const { provisionUserServices } = require('./provisioning-service');
const { publicBinding } = require('./user-services');

function registerProvisioningRoutes(app, deps) {
  const { loadConfigs, saveConfigs, verifyPassword, hashPassword, rateLimit } = deps;

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

    try {
      const services = await provisionUserServices({
        token,
        userSecret: req.body?.userSecret,
        existing: config.services || {},
        aiostreamsConfig: req.body?.aiostreamsConfig || {},
        aiometadataConfig: req.body?.aiometadataConfig || {},
        serviceCredentials: req.body?.serviceCredentials || {}
      });
      config.services = services;
      config.updatedAt = new Date().toISOString();
      saveConfigs(configs);
      res.json({
        ok: true,
        services: {
          aiostreams: publicBinding(services.aiostreams),
          aiometadata: publicBinding(services.aiometadata)
        }
      });
    } catch (error) {
      console.error('Service provisioning failed:', error?.message || error);
      res.status(error?.status >= 400 && error?.status < 500 ? 502 : 500).json({
        error: 'Backend service provisioning failed',
        serviceStatus: error?.status || null
      });
    }
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
