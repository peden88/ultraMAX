function registerConfigRoutes(app, deps) {
  const {
    loadConfigs,
    saveConfigs,
    hashPassword,
    verifyPassword,
    generateToken,
    rateLimit
  } = deps;

  app.post("/c/create", (req, res) => {
    const ip = req.ip || req.socket.remoteAddress;

    if (rateLimit(ip, 5, 60000)) {
      return res.status(429).json({ error: "Too many requests." });
    }

    const {
      password,
      catalogs,
      mdblistKey,
      language,
      rpdbKey,
      tpKey,
      fanartKey,
      omdbKey,
      traktUser,
      excludeUnreleased,
      maxRating,
      streamAddons,
      customCatalogs,
      googleAiKey,
      enableAiRecommended,
      hiddenCatalogs
    } = req.body;

    if (!password || !catalogs || !catalogs.length) {
      return res.status(400).json({
        error: "Password and catalogs required"
      });
    }

    const configs = loadConfigs();

    let token = generateToken();
    while (configs[token]) token = generateToken();

    configs[token] = {
      passwordHash: hashPassword(password),
      catalogs,
      mdblistKey: mdblistKey || null,
      language: language || "en-US",
      rpdbKey: rpdbKey || null,
      tpKey: tpKey || null,
      fanartKey: fanartKey || null,
      omdbKey: omdbKey || null,
      traktUser: traktUser || null,
      excludeUnreleased: !!excludeUnreleased,
      maxRating: maxRating || null,
      streamAddons: Array.isArray(streamAddons)
        ? streamAddons.filter(Boolean)
        : [],
      customCatalogs: Array.isArray(customCatalogs)
        ? customCatalogs.filter(Boolean)
        : [],
      googleAiKey: googleAiKey || null,
      enableAiRecommended: !!enableAiRecommended,
      hiddenCatalogs: Array.isArray(hiddenCatalogs)
        ? hiddenCatalogs
        : [],
      createdAt: new Date().toISOString()
    };

    saveConfigs(configs);

    res.json({ token });
  });

  app.post("/c/:token/update", (req, res) => {
    const { token } = req.params;

    const {
      password,
      catalogs,
      mdblistKey,
      language,
      rpdbKey,
      tpKey,
      fanartKey,
      omdbKey,
      traktUser,
      excludeUnreleased,
      maxRating,
      streamAddons,
      customCatalogs,
      googleAiKey,
      enableAiRecommended,
      hiddenCatalogs
    } = req.body;

    const configs = loadConfigs();

    if (!configs[token]) {
      return res.status(404).json({
        error: "Config not found"
      });
    }

    const passwordCheck = verifyPassword(password, configs[token].passwordHash);
    if (!passwordCheck.ok) {
      return res.status(401).json({ error: "Incorrect password" });
    }
    if (passwordCheck.needsUpgrade) configs[token].passwordHash = hashPassword(password);

    configs[token].catalogs = catalogs !== undefined ? catalogs : (configs[token].catalogs || []);
    configs[token].language = language || configs[token].language || "en-US";
    configs[token].rpdbKey = rpdbKey || configs[token].rpdbKey || null;
    configs[token].tpKey = tpKey || configs[token].tpKey || null;
    configs[token].fanartKey = fanartKey || configs[token].fanartKey || null;
    configs[token].omdbKey = omdbKey || configs[token].omdbKey || null;
    configs[token].mdblistKey = mdblistKey || configs[token].mdblistKey || null;
    configs[token].traktUser =
      traktUser !== undefined
        ? traktUser
        : configs[token].traktUser;

    configs[token].excludeUnreleased =
      excludeUnreleased !== undefined
        ? !!excludeUnreleased
        : (configs[token].excludeUnreleased || false);

    configs[token].maxRating =
      maxRating !== undefined
        ? maxRating
        : (configs[token].maxRating || null);

    configs[token].streamAddons = Array.isArray(streamAddons)
      ? streamAddons.filter(Boolean)
      : (configs[token].streamAddons || []);

    configs[token].customCatalogs = Array.isArray(customCatalogs)
      ? customCatalogs.filter(Boolean)
      : (configs[token].customCatalogs || []);

    configs[token].googleAiKey =
      googleAiKey || configs[token].googleAiKey || null;

    configs[token].enableAiRecommended =
      enableAiRecommended !== undefined
        ? !!enableAiRecommended
        : !!configs[token].enableAiRecommended;

    configs[token].hiddenCatalogs = Array.isArray(hiddenCatalogs)
      ? hiddenCatalogs
      : (configs[token].hiddenCatalogs || []);

    configs[token].updatedAt = new Date().toISOString();

    saveConfigs(configs);

    res.json({ token });
  });

  app.post("/c/:token/config", (req, res) => {
    const { token } = req.params;
    const configs = loadConfigs();

    if (!configs[token]) {
      return res.status(404).json({
        error: "Not found"
      });
    }

    const passwordCheck = verifyPassword(req.body?.password, configs[token].passwordHash);
    if (!passwordCheck.ok) return res.status(401).json({ error: "Incorrect password" });
    if (passwordCheck.needsUpgrade) { configs[token].passwordHash = hashPassword(req.body.password); saveConfigs(configs); }

    res.json({
      catalogs: configs[token].catalogs,
      mdblistKey: configs[token].mdblistKey,
      language: configs[token].language,
      rpdbKey: configs[token].rpdbKey,
      tpKey: configs[token].tpKey,
      fanartKey: configs[token].fanartKey || null,
      omdbKey: configs[token].omdbKey || null,
      traktUser: configs[token].traktUser,
      excludeUnreleased: configs[token].excludeUnreleased || false,
      maxRating: configs[token].maxRating || null,
      streamAddons: configs[token].streamAddons || [],
      customCatalogs: configs[token].customCatalogs || [],
      googleAiKey: configs[token].googleAiKey || null,
      enableAiRecommended: !!configs[token].enableAiRecommended
    });
  });

  app.get("/debug/config/:token", (req, res) => {
    const { token } = req.params;
    const configs = loadConfigs();
    const config = configs[token];

    if (!config) {
      return res.status(404).json({
        ok: false,
        error: "Config not found",
        token
      });
    }

    const redact = value => {
      if (!value) return null;

      const text = String(value);

      if (text.length <= 6) return "***";

      return `${text.slice(0,3)}...${text.slice(-3)}`;
    };

    const catalogs = Array.isArray(config.catalogs) ? config.catalogs : [];
    const streamAddons = Array.isArray(config.streamAddons) ? config.streamAddons : [];
    const customCatalogs = Array.isArray(config.customCatalogs) ? config.customCatalogs : [];
    const collections = Array.isArray(config.collections) ? config.collections : [];
    const hiddenCatalogs = Array.isArray(config.hiddenCatalogs) ? config.hiddenCatalogs : [];

    res.json({
      ok: true,
      token,
      createdAt: config.createdAt || null,
      updatedAt: config.updatedAt || null,

      counts: {
        catalogs: catalogs.length,
        hiddenCatalogs: hiddenCatalogs.length,
        streamAddons: streamAddons.length,
        customCatalogs: customCatalogs.length,
        collections: collections.length
      },

      settings: {
        language: config.language || "en-US",
        excludeUnreleased: !!config.excludeUnreleased,
        maxRating: config.maxRating || null,
        enableAiRecommended: !!config.enableAiRecommended,
        traktUser: config.traktUser || null
      },

      keys: {
        mdblistKey: redact(config.mdblistKey),
        rpdbKey: redact(config.rpdbKey),
        tpKey: redact(config.tpKey),
        fanartKey: redact(config.fanartKey),
        omdbKey: redact(config.omdbKey),
        googleAiKey: redact(config.googleAiKey)
      }
    });
  });

  app.post("/c/:token/collections", (req, res) => {
    const { token } = req.params;
    const configs = loadConfigs();

    if (!configs[token]) {
      return res.status(404).json({
        error: "Not found"
      });
    }

    const passwordCheck = verifyPassword(req.body?.password, configs[token].passwordHash);
    if (!passwordCheck.ok) return res.status(401).json({ error: "Incorrect password" });
    if (passwordCheck.needsUpgrade) configs[token].passwordHash = hashPassword(req.body.password);

    const { collections, replace } = req.body;

    if (!Array.isArray(collections)) {
      return res.status(400).json({
        error: "Invalid collections"
      });
    }

    const existing = Array.isArray(configs[token].collections)
      ? configs[token].collections
      : [];

    if (replace === true) {
      configs[token].collections = collections;
    } else {
      const keyOf = c =>
        String(
          c.id || c.slug || c.title || c.name || ""
        )
          .trim()
          .toLowerCase();

      const merged = [...existing];
      const seen = new Map();

      merged.forEach((c, i) => {
        const k = keyOf(c);
        if (k) seen.set(k, i);
      });

      for (const incoming of collections) {
        const k = keyOf(incoming);

        if (k && seen.has(k)) {
          merged[seen.get(k)] = {
            ...merged[seen.get(k)],
            ...incoming
          };
        } else {
          if (k) seen.set(k, merged.length);
          merged.push(incoming);
        }
      }

      configs[token].collections = merged;
    }

    saveConfigs(configs);

    res.json({
      ok: true,
      mode: replace === true ? "replace" : "merge",
      before: existing.length,
      incoming: collections.length,
      after: configs[token].collections.length
    });
  });

  app.get("/c/:token/collections.json", (req, res) => {
    const { token } = req.params;
    const configs = loadConfigs();

    if (!configs[token]) {
      return res.status(404).json([]);
    }

    res.json(configs[token].collections || []);
  });
}

module.exports = {
  registerConfigRoutes
};
