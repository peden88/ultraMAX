require('dotenv').config();

const { addonBuilder } = require("stremio-addon-sdk");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const { CATALOG_DEFS } = require("./catalogs/catalog-defs");
const { QUICK_PICK_CATALOGS } = require("./catalogs/quick-picks");
const { DYNAMIC_CATALOGS } = require("./catalogs/dynamic-catalogs");
const { loadConfigs, saveConfigs } = require("./utils/config-store");
const { hashPassword, verifyPassword, generateToken } = require("./utils/auth");
const { rateLimit } = require("./utils/rate-limit");
const { fetchCached, fetchTrakt } = require("./services/api-helpers");
const { streamBridgeResponse } = require("./services/stream-bridge");
const { getImdbId, getMovieCertification, filterByMaxRating, imdbToTmdbMovieId, filterMetasByMaxRating, getBestPoster, traktToMetas, resultsToMetas, mdblistToMetas } = require("./services/metadata-service");
const { geminiAiRecommendations, tmdbResolveAiItems } = require("./services/ai-service");
const PORT = process.env.PORT || 7000;
const TMDB_KEY = process.env.TMDB_KEY;
const MDBLIST_KEYS = (process.env.MDBLIST_KEYS || process.env.MDBLIST_KEY || "5woimia0xf19uqr4rd7wl1960").split(",").map(k => k.trim()).filter(Boolean);
const MDBLIST_KEY = MDBLIST_KEYS[0];
const TRAKT_CLIENT_ID = process.env.TRAKT_CLIENT_ID;
const FILTER_ENABLED = process.env.FILTER_MODE !=="off";
const { handleTraktCatalog } = require("./services/trakt-service");
const { handleQuickPicks } = require("./services/quick-picks-service");
const { handleSearch } = require("./services/search-service");
const { buildTmdbCatalogUrl } = require("./services/tmdb-catalog-service");
const { handleRelatedContent } = require("./services/related-content-service");
const { handleCatalogSearch } = require("./services/catalog-search-service");
const { getStaticIds, buildManifestCatalogs, buildCatalogsFromIds } = require("./services/manifest-service");
const { handleMetaRequest } = require("./services/meta-handler-service");
const { checkStreamWizard } = require("./services/stream-wizard-service");
const { handleConfiguredMeta } = require("./services/meta-route-service");
const { handleNuvioManifest, handleCinemetaClone, handleMainManifest } = require("./services/manifest-route-service");
const { handleTmdbPreview } = require("./services/tmdb-preview-service");
const { registerConfigRoutes } = require("./services/config-route-service");
const { handleCatalog: handleCatalogService } = require("./services/catalog-handler-service");
const { registerCatalogRoutes } = require("./services/catalog-route-service");
const { registerStatsRoutes } = require("./services/stats-route-service");

if (!TMDB_KEY) { console.error("TMDB_KEY missing - exiting"); process.exit(1); }

const staticIds = getStaticIds( CATALOG_DEFS, FILTER_ENABLED );
const builder = new addonBuilder({

  id: FILTER_ENABLED ?"org.kris.ultra.max.v5" :"org.kris.ultra.max.all.v5",
  version:"7.0.0",
  logo: "https://ultramax.vip/logo.svg",
  name: FILTER_ENABLED ?"Ultra MAX" :"Ultra MAX All",
  description:"Premium curated catalogs for Stremio and Nuvio. Fast discovery, cleaner collections, and smarter rows.",
  types: ["movie","series"],
  resources: ["catalog","meta","stream"],
  catalogs: [
    { type:"movie",  id:"ultramax_placeholder", name:"Ultra MAX", extra: [{ name:"skip", isRequired: false }] }
  ]
});

const catalogDeps = {
  TMDB_KEY,
  TRAKT_CLIENT_ID,
  handleSearch,
  handleQuickPicks,
  handleRelatedContent,
  handleTraktCatalog,
  handleCatalogSearch,
  buildTmdbCatalogUrl,
  geminiAiRecommendations,
  tmdbResolveAiItems,
  fetchCached,
  filterByMaxRating,
  resultsToMetas,
  mdblistToMetas
};

const catalogRouteDeps = {
  FILTER_ENABLED,
  QUICK_PICK_CATALOGS,
  DYNAMIC_CATALOGS,
  staticIds,
  CATALOG_DEFS,
  buildManifestCatalogs,
  handleCatalogService,
  catalogDeps,
  loadConfigs,
  MDBLIST_KEY
};


builder.defineCatalogHandler(async ({ type, id, extra }) => {
  console.log("SDK HANDLER:", id, extra);
try {
  return await handleCatalogService(
    id,
    type,
    extra,
    null,
    FILTER_ENABLED,
    "en-US",
    null,
    null,
    null,
    false,
    null,
    [],
    null,
    null,
    null,
    catalogDeps
  );
}

  catch (e) { console.log("catalog error", id, e.message); return { metas: [] }; }
});

builder.defineStreamHandler(async () => ({ streams: [] }));

builder.defineMetaHandler(async ({ type, id }) => {
  return await handleMetaRequest(
    { type, id },
    {
      TMDB_KEY,
      fetchCached
    }
  );
});

const addonInterface = builder.getInterface();
const app = express();\napp.set("trust proxy", process.env.TRUST_PROXY || "loopback, linklocal, uniquelocal");
app.use((req, res, next) => { res.setHeader("Access-Control-Allow-Origin", "*"); res.setHeader("Access-Control-Allow-Headers", "*"); res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS"); if (req.method === "OPTIONS") return res.sendStatus(200); next(); });
app.use(express.json());
registerCatalogRoutes(app, catalogRouteDeps);
registerConfigRoutes(app, {
  loadConfigs,
  saveConfigs,
  hashPassword,\n  verifyPassword,\n  generateToken,
  rateLimit
});

registerStatsRoutes(app, {
  loadConfigs
});

// ================================
// ULTRA MAX STREAM WIZARD - PHASE 1
// Validate external Stremio manifest URLs
// ================================

app.post(
  "/api/stream-wizard/check",
  checkStreamWizard
);

app.get("/health", (req, res) => { res.status(200).json({ ok: true, service: "ultra-max", timestamp: new Date().toISOString() }); });

app.get("/trending", (req, res) => {
  const fs = require("fs");
  try {
    const configs = JSON.parse(fs.readFileSync("/home/ubuntu/ultramax-landing/addon/configs.json", "utf8"));
    const counts = {};
    for(const token of Object.values(configs)){
      const catalogs = token.catalogs || [];
      for(const id of catalogs){
        counts[id] = (counts[id] || 0) + 1;
      }
    }
    const sorted = Object.entries(counts)
      .sort((a,b) => b[1]-a[1])
      .slice(0, 10)
      .map(([id, count]) => ({ id, count }));
    res.json({ trending: sorted, total: Object.keys(configs).length });
  } catch(e) {
    res.json({ trending: [], total: 0 });
  }
});

app.get("/stats", (req, res) => {
  const fs = require("fs");
  try {
    const configs = JSON.parse(fs.readFileSync("/home/ubuntu/ultramax-landing/addon/configs.json", "utf8"));
    res.json({ users: Object.keys(configs).length });
  } catch(e) {
    res.json({ users: 0 });
  }
});

app.get("/assets", (req, res) => {
  const fs = require("fs");

  const folders = [
    { label: "Main", dir: process.env.IMAGES_DIR || "/home/ubuntu/images", prefix: "/images/" },
    { label: "Quick", dir: "/home/ubuntu/ultramax-landing/images/quick", prefix: "/images/quick/" }
  ];

  let allFiles = [];
  for(const folder of folders){
    try {
      const files = fs.readdirSync(folder.dir)
        .filter(f => /\.(png|jpe?g|webp|gif|svg)$/i.test(f))
        .sort()
        .map(f => ({ name: f, label: folder.label, url: folder.prefix + encodeURIComponent(f) }));
      allFiles = allFiles.concat(files);
    } catch(e) {}
  }

  const mode = req.query.mode || 'cover';
  const ci = req.query.ci || '';
  const fi = req.query.fi || '';
  const returnTo = req.query.returnTo || '';

  const cards = allFiles.map(f => {
    const safeName = String(f.name).replace(/</g,"&lt;").replace(/>/g,"&gt;");
    return `<div class="card" data-name="${safeName.toLowerCase()}" data-folder="${f.label.toLowerCase()}">
      <img src="${f.url}" loading="lazy">
      <div class="name">${safeName}</div>
      <div class="folder-tag">${f.label}</div>
      <button type="button" data-url="${f.url}">Use Image</button>
    </div>`;
  }).join("");

  const html = `<!doctype html>
<html>
<head>
<title>Ultra MAX Asset Library</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  *{box-sizing:border-box;margin:0;padding:0;}
  body{background:#080810;color:#e0e0f0;font-family:sans-serif;min-height:100vh;}
  header{background:#0f0f1e;border-bottom:1px solid #1e1e36;padding:14px 16px;position:sticky;top:0;z-index:100;display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
  .logo{font-size:1rem;font-weight:700;color:#fff;white-space:nowrap;}
  .logo span{color:#7B2FFF;}
  .search{flex:1;min-width:180px;background:#12121f;border:1px solid #2a2a45;color:#e0e0f0;font-size:14px;padding:9px 12px;border-radius:8px;outline:none;}
  .search:focus{border-color:#7B2FFF;}
  .search::placeholder{color:#7070a0;}
  .tabs{display:flex;gap:6px;}
  .tab{background:transparent;border:1px solid #2a2a45;color:#7070a0;font-size:11px;font-weight:600;padding:6px 10px;border-radius:6px;cursor:pointer;}
  .tab.active{border-color:#7B2FFF;color:#9B5FFF;}
  .count{font-size:12px;color:#7070a0;}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(155px,1fr));gap:10px;padding:16px;}
  .card{border:1px solid #1e1e36;border-radius:10px;overflow:hidden;background:#12121f;}
  .card:hover{border-color:#7B2FFF;}
  .card img{width:100%;height:100px;object-fit:cover;display:block;background:#0f0f1e;}
  .name{font-size:10px;color:#7070a0;padding:5px 8px 1px;word-break:break-all;line-height:1.3;}
  .folder-tag{font-size:9px;color:#7B2FFF;padding:0 8px 4px;font-weight:600;}
  .card button{width:100%;padding:7px;background:rgba(123,47,255,.15);color:#9B5FFF;border:0;border-top:1px solid #1e1e36;cursor:pointer;font-size:12px;font-weight:600;}
  .card button:hover{background:rgba(123,47,255,.3);}
  .card.hidden{display:none;}
  .empty{text-align:center;padding:60px;color:#7070a0;}
</style>
</head>
<body>
<header>
  <div class="logo">ULTRA <span>MAX</span> Assets</div>
  <input class="search" type="text" id="searchBox" placeholder="Search images..." oninput="filterImages()">
  <div class="tabs">
    <button class="tab active" onclick="setFilter('all',this)">All</button>
    <button class="tab" onclick="setFilter('main',this)">Main</button>
    <button class="tab" onclick="setFilter('quick',this)">Quick</button>
    <button class="tab" onclick="setFilter('.gif',this)">GIFs</button>
  </div>
  <div class="count" id="countLabel">${allFiles.length} images</div>
</header>
<div class="grid" id="grid">${cards}</div>
<div class="empty" id="emptyMsg" style="display:none;">No images found</div>
<script>
var currentFilter='all';
var returnTo='${returnTo}';
var mode='${mode}';
var ci=${ci||'null'};
var fi=${fi||'null'};

function setFilter(f,el){
  currentFilter=f;
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  el.classList.add('active');
  filterImages();
}

function filterImages(){
  var q=document.getElementById('searchBox').value.toLowerCase();
  var cards=document.querySelectorAll('.card');
  var visible=0;
  cards.forEach(function(card){
    var name=card.getAttribute('data-name')||'';
    var folder=card.getAttribute('data-folder')||'';
    var matchSearch=!q||name.includes(q);
    var matchFilter=currentFilter==='all'||folder.includes(currentFilter)||name.includes(currentFilter);
    if(matchSearch&&matchFilter){card.classList.remove('hidden');visible++;}
    else{card.classList.add('hidden');}
  });
  document.getElementById('countLabel').textContent=visible+' images';
  document.getElementById('emptyMsg').style.display=visible===0?'block':'none';
}

document.querySelectorAll('button[data-url]').forEach(function(btn){
  btn.addEventListener('click',function(){
    var full=window.location.origin+btn.getAttribute('data-url');
    if(window.parent !== window && ci!==null && fi!==null){
      window.parent.postMessage({type:'assetPick',ci:ci,fi:fi,url:full,mode:mode},'*');
    } else if(returnTo&&returnTo!=='null'&&returnTo!==''&&ci!==null&&fi!==null){
      localStorage.setItem('ultramaxAssetPick',JSON.stringify({ci:ci,fi:fi,url:full,mode:mode}));
      window.location.href=returnTo;
    } else {
      var ta=document.createElement('textarea');
      ta.value=full;
      ta.style.position='fixed';
      ta.style.opacity='0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      try{ document.execCommand('copy'); }catch(e){}
      document.body.removeChild(ta);
      btn.textContent='✅ Copied!';
      btn.style.background='rgba(0,210,160,.25)';
      btn.style.color='#00d2a0';
      setTimeout(function(){
        btn.textContent='Use Image';
        btn.style.background='';
        btn.style.color='';
      },2500);
    }
  });
});
</script>
</body>
</html>`;
  res.send(html);
});
;

app.get("/configure", (req, res) => { res.setHeader("Cache-Control","public, max-age=300"); res.sendFile(path.join(__dirname,"configure.html")); });
app.get("/configure/:token", (req, res) => { res.setHeader("Cache-Control","public, max-age=300"); res.sendFile(path.join(__dirname,"configure.html")); });
app.get("/c/:token/configure", (req, res) => { res.redirect(`/configure/${req.params.token}`); });
app.get("/logo.svg", (req, res) => { res.sendFile(path.join(__dirname,"logo.svg")); });
app.get("/collections-builder", (req, res) => { res.sendFile(path.join(__dirname,"collections-builder.html")); });
app.use("/images", express.static(path.join(__dirname,"images"), { maxAge: '7d', etag: true }));
app.use("/images/quick", express.static("/home/ubuntu/ultramax-landing/images/quick", { maxAge: '7d', etag: true }));
app.get("/collections.json", (req, res) => { res.sendFile(path.join(__dirname,"collections.json")); });

app.post("/api/ai/custom-row", async (req, res) => {
  try {
    const { prompt, count = 1, googleAiKey, traktUser = null, language: rowLanguage = "en-US" } = req.body || {};
    const watchRegion = (rowLanguage.split("-")[1] || "US").toUpperCase();
    const key = googleAiKey || process.env.GOOGLE_AI_KEY || process.env.GEMINI_KEY || null;

    if (!prompt || !String(prompt).trim()) {
      return res.status(400).json({ error: "Missing prompt" });
    }
    
    if (!key) {
      // 🔁 Fallback: simple parser (no AI key needed)
      const lower = prompt.toLowerCase();

      const isSeries = lower.includes("series") || lower.includes("shows") || lower.includes("tv");
      const type = isSeries ? "series" : "movie";
      const tmdbType = isSeries ? "tv" : "movie";

      const genreMap = {
        action: "28",
        comedy: "35",
        drama: "18",
        horror: "27",
        scifi: "878",
        "sci-fi": "878",
        thriller: "53",
        romance: "10749",
        animation: "16",
        crime: "80"
      };

      let genre = "";
      for (const g in genreMap){
        if (lower.includes(g)){
          genre = genreMap[g];
          break;
        }
      }

      let rating = "";
      const ratingMatch = lower.match(/(?:rating\s*(?:on|of|above|over)?|above|over)\s*(\d+(\.\d+)?)/);
      if (ratingMatch) {
        rating = ratingMatch[1];
      }

      let yearFrom = "", yearTo = "";

      const fullDecadeMatch = lower.match(/(19\d{2}|20\d{2})s/);
      const shortDecadeMatch = lower.match(/\b(70|80|90|00|10|20)s\b/);

      if (fullDecadeMatch) {
        yearFrom = fullDecadeMatch[1];
        yearTo = String(Number(yearFrom) + 9);
      } else if (shortDecadeMatch) {
        const d = shortDecadeMatch[1];
        if (d === "70") yearFrom = "1970";
        if (d === "80") yearFrom = "1980";
        if (d === "90") yearFrom = "1990";
        if (d === "00") yearFrom = "2000";
        if (d === "10") yearFrom = "2010";
        if (d === "20") yearFrom = "2020";
        yearTo = String(Number(yearFrom) + 9);
      }

      return res.json({
        rows: [{
          name: prompt,
          type,
          source: "tmdb",
          withGenres: genre,
          voteAverageGte: rating,
          yearFrom,
          yearTo,
          watchRegion,
          language: rowLanguage
        }]
      });
    }
    const wanted = Math.max(1, Math.min(Number(count) || 1, 5));

    const aiPrompt = `
You are helping build custom Stremio/Nuvio homepage catalog rows.

Return ONLY valid JSON. No markdown.

Create ${wanted} custom catalog row objects for this idea:
"${prompt}"

Trakt username, optional context: ${traktUser || "none"}

Each object must use this exact shape:
{
  "name": "Short row title",
  "type": "movie" or "series",
  "source": "tmdb_discover",
  "tmdbType": "movie" or "tv",
  "sortBy": "popularity.desc",
  "withGenres": "",
  "withoutGenres": "",
  "yearFrom": "",
  "yearTo": "",
  "voteAverageGte": "",
  "withCast": "",
  "withCrew": "",
  "withCompanies": "",
  "withNetworks": "",
  "withWatchProviders": "",
  "watchRegion": "${watchRegion}",
  "language": "${rowLanguage}"
}

Rules:
- Use source "tmdb_discover".
- For movies use type "movie" and tmdbType "movie".
- For series use type "series" and tmdbType "tv".
- Prefer GB watch region.
- Use TMDB genre IDs where obvious.
- If the prompt asks for an actor, put their TMDB person ID in withCast if you know it, otherwise leave blank.
- If unsure, keep fields blank rather than inventing bad IDs.
- Return an array only.
`;

    const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": key
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: aiPrompt }] }]
      })
    });

    const raw = await r.text();

    if (!r.ok) {
      return res.status(r.status).json({ error: "Gemini request failed", details: raw.slice(0, 500) });
    }

    const data = JSON.parse(raw);
    let text = data?.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("\n").trim() || "";
    text = text.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();

    const rows = JSON.parse(text);

    if (!Array.isArray(rows)) {
      return res.status(500).json({ error: "AI did not return an array", raw: text.slice(0, 500) });
    }

    res.json({ rows: rows.slice(0, wanted) });
  } catch (err) {
    console.error("AI custom row route failed:", err);
    res.status(500).json({ error: err.message || "AI custom row route failed" });
  }
});

app.get("/n/:token/manifest.json", (req, res) =>
  handleNuvioManifest(req, res, {
    loadConfigs,
    saveConfigs,
    buildCatalogsFromIds,
    QUICK_PICK_CATALOGS,
  CATALOG_DEFS
  })
);

app.get(
  "/cinemeta-clone/manifest.json",
  handleCinemetaClone
);

app.get("/c/:token/manifest.json", (req, res) =>
  handleMainManifest(req, res, {
    loadConfigs,
    saveConfigs,
    buildCatalogsFromIds,
    QUICK_PICK_CATALOGS,
  CATALOG_DEFS
  })
);

app.get("/c/:token/meta/:type/:id.json", (req, res) =>
  handleConfiguredMeta(req, res, {
    loadConfigs,
    fetchCached,
    TMDB_KEY
  })
);

app.get("/meta/:type/:id.json", async (req, res) => {
  const { type, id } = req.params;
  try {
    const tmdbType = type ==="series" ?"tv" :"movie";
    const findRes = await fetchCached(`https://api.themoviedb.org/3/find/${id}?api_key=${TMDB_KEY}&external_source=imdb_id`);
    const result = findRes[`${tmdbType}_results`]?.[0];
    if (!result) return res.json({ meta: { id, type } });
    const tmdbId = result.id;
    const d = await fetchCached(`https://api.themoviedb.org/3/${tmdbType}/${tmdbId}?api_key=${TMDB_KEY}&append_to_response=credits`);
    if (!d) return res.json({ meta: { id, type } });
    const cast = (d.credits?.cast || []).slice(0, 5).map(c => c.name);
    const meta = { id, type, name: d.title || d.name, description: d.overview, poster: d.poster_path ? `https://image.tmdb.org/t/p/w500${d.poster_path}` : null, background: d.backdrop_path ? `https://image.tmdb.org/t/p/original${d.backdrop_path}` : null, releaseInfo: d.release_date ? d.release_date.split("-")[0] : d.first_air_date ? d.first_air_date.split("-")[0] : null, imdbRating: d.vote_average ? d.vote_average.toFixed(1) : null, genres: (d.genres || []).map(g => g.name), cast };
    res.json({ meta });
  } catch (e) { res.json({ meta: { id, type } }); }
});

app.get("/stream/:type/:id.json", async (req, res) => {
  // Dev fallback: no token config, no stream addons.
  res.json({ streams: [] });
});

app.get("/c/:token/stream/:type/:id.json", async (req, res) => {
  const { token, type, id } = req.params;
  const configs = loadConfigs();
  const config = configs[token];

  if (!config) return res.json({ streams: [] });

  const result = await streamBridgeResponse(config.streamAddons || [], type, id);
  res.json(result);
});

app.get("/preview/tmdb", handleTmdbPreview);

// On startup: remove configs not accessed in 180 days
(function cleanupStaleConfigs() {
  try {
    const configs = loadConfigs();
    const now = Date.now();
    const EXPIRY_MS = 180 * 24 * 60 * 60 * 1000; // 180 days
    let removed = 0;
    for (const [token, config] of Object.entries(configs)) {
      const lastSeen = config.lastAccessed || config.updatedAt || config.createdAt;
      if (!lastSeen) continue;
      if (now - new Date(lastSeen).getTime() > EXPIRY_MS) {
        delete configs[token];
        removed++;
      }
    }
    if (removed > 0) {
      saveConfigs(configs);
      console.log(`Startup cleanup: removed ${removed} stale config(s) (180+ days inactive)`);
    }
  } catch(e) {
    console.error("Startup config cleanup failed:", e.message);
  }
})();

const PREWARM_LISTS = ['92337','91304','91303','91302','91300','91301','86710','88307','88309','3087','3091'];
setTimeout(async () => {
  console.log('Pre-warming MDBList cache...');
  for (const id of PREWARM_LISTS) {
    try {
      await fetchCached(`https://mdblist.com/api/lists/${id}/items/?apikey=${MDBLIST_KEY}&limit=20&type=movie`);
      await new Promise(r => setTimeout(r, 300));
    } catch(e) {}
  }
  console.log('Cache pre-warm complete');
}, 5000);

app.listen(PORT,"0.0.0.0", () => {
  console.log(`Ultra MAX v7.0.0-beta running on port ${PORT}`);
  console.log(`Total catalog defs: ${Object.keys(CATALOG_DEFS).length}`);
  console.log(`Static catalogs: ${staticIds.length}`);
});
