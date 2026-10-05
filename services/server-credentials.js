'use strict';

// Server defaults never belong in persisted user config. Callers receive only the
// effective value at request/provision time. User values always win.
const DEFINITIONS = Object.freeze({
  mdblist: ['MDBLIST_KEYS','MDBLIST_KEY'],
  tmdb: ['TMDB_KEY','TMDB_API_KEY'],
  tvdb: ['TVDB_API_KEY','TVDB_KEY'],
  fanart: ['FANART_KEY','FANART_API_KEY'],
  omdb: ['OMDB_KEY','OMDB_API_KEY'],
  googleAi: ['GOOGLE_AI_KEY','GEMINI_KEY'],
  rpdb: ['RPDB_KEY','RPDB_API_KEY'],
  topPoster: ['TP_KEY','TOP_POSTER_KEY']
});
function serverValues(name){
  const envs=DEFINITIONS[name]||[];
  const vals=[];
  for(const env of envs) for(const value of String(process.env[env]||'').split(',')){const v=value.trim();if(v&&!vals.includes(v))vals.push(v);}
  return vals;
}
function resolveCredential(name,userValue){
  const user=String(userValue||'').trim();
  if(user)return {value:user,source:'user',available:true};
  const value=serverValues(name)[0]||null;
  return {value,source:value?'server':'unavailable',available:!!value};
}
function capability(name,userValue){const r=resolveCredential(name,userValue);return {available:r.available,source:r.source};}
module.exports={resolveCredential,serverValues,capability,DEFINITIONS};
