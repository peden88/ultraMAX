'use strict';

const dns = require('dns');
const net = require('net');

const V4_BLOCKED = [
  ['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],
  ['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],
  ['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],
  ['224.0.0.0',4],['240.0.0.0',4]
];
const V6_BLOCKED = [['::',96],['100::',64],['2001:db8::',32],['fc00::',7],['fe80::',10],['fec0::',10],['ff00::',8]];
const V6_EMBEDS_V4 = [['::ffff:0:0',96],['64:ff9b::',96]];

function v4ToBig(address){const p=address.split('.');if(p.length!==4)return null;let n=0n;for(const x of p){if(!/^\d{1,3}$/.test(x)||Number(x)>255)return null;n=(n<<8n)|BigInt(x);}return n;}
function v6ToBig(address){let t=address,tail=[];const d=t.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);if(d){const v=v4ToBig(d[2]);if(v===null)return null;tail=[Number(v>>16n),Number(v&0xffffn)];t=d[1].endsWith('::')?d[1]:d[1].slice(0,-1);}const h=t.split('::');if(h.length>2)return null;const groups=s=>s===''?[]:s.split(':').map(g=>/^[0-9a-f]{1,4}$/i.test(g)?parseInt(g,16):NaN);const a=groups(h[0]),b=h.length===2?groups(h[1]):[];if([...a,...b].some(Number.isNaN))return null;const known=a.length+b.length+tail.length;let all;if(h.length===2){if(known>7)return null;all=[...a,...new Array(8-known).fill(0),...b,...tail];}else all=[...a,...tail];if(all.length!==8)return null;return all.reduce((n,g)=>(n<<16n)|BigInt(g),0n);}
function inPrefix(value,base,prefix,bits){return (value>>BigInt(bits-prefix))===(base>>BigInt(bits-prefix));}
const V4_RULES=V4_BLOCKED.map(([a,p])=>[v4ToBig(a),p]),V6_RULES=V6_BLOCKED.map(([a,p])=>[v6ToBig(a),p]),V6_EMBED_RULES=V6_EMBEDS_V4.map(([a,p])=>[v6ToBig(a),p]);
function isBlockedAddress(ip){const a=String(ip||'').trim().replace(/^\[|\]$/g,'').replace(/%.*$/,'');const f=net.isIP(a);if(f===4){const n=v4ToBig(a);return n===null||V4_RULES.some(([b,p])=>inPrefix(n,b,p,32));}if(f!==6)return true;const n=v6ToBig(a);if(n===null)return true;if(V6_EMBED_RULES.some(([b,p])=>inPrefix(n,b,p,128))){const inner=n&0xffffffffn;return V4_RULES.some(([b,p])=>inPrefix(inner,b,p,32));}return V6_RULES.some(([b,p])=>inPrefix(n,b,p,128));}
function blockedError(what){const e=new Error(`Refused private/non-public destination (${what})`);e.code='E_PRIVATE_ADDRESS';return e;}
async function assertPublicUrl(raw){let u;try{u=new URL(raw);}catch{throw blockedError('invalid URL');}if(!['http:','https:'].includes(u.protocol))throw blockedError(u.protocol);if(u.username||u.password)throw blockedError('URL credentials');const host=u.hostname.replace(/^\[|\]$/g,'');if(net.isIP(host)){if(isBlockedAddress(host))throw blockedError(host);return u;}const answers=await dns.promises.lookup(host,{all:true,verbatim:true});if(!answers.length||answers.some(a=>isBlockedAddress(a.address)))throw blockedError(host);return u;}
module.exports={isBlockedAddress,assertPublicUrl};
