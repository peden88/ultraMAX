'use strict';

// Mirrors AIOStreams' template conditional semantics for server-side provisioning.
// Source semantics: packages/frontend/src/lib/templates/processors/conditionals.ts
const REMOVE = Symbol('remove');

function nested(obj, key) {
  return String(key).split('.').reduce((v, part) => v == null ? undefined : v[part], obj);
}
function defaults(options = []) {
  const out = {};
  for (const option of options || []) {
    if (!option || !option.id) continue;
    if (option.type === 'subsection') out[option.id] = defaults(option.subOptions || []);
    else if (option.default !== undefined) out[option.id] = option.default;
  }
  return out;
}
function condition(raw, inputs, services) {
  const text = String(raw || '').trim();
  const split = (op) => text.split(new RegExp(' '+op+' (?=!?(?:inputs|services)\\b)'));
  for (const [op, fn] of [['or', a=>a.some(Boolean)], ['xor', a=>a.filter(Boolean).length%2===1], ['and', a=>a.every(Boolean)]]) {
    const parts=split(op); if(parts.length>1) return fn(parts.map(p=>condition(p,inputs,services)));
  }
  const neg=text.startsWith('!'), expr=neg?text.slice(1).trim():text;
  let result=false;
  const num=expr.match(/^(\\w+)\\.(.+?)\\s+(>=|<=|>|<)\\s+(-?\\d+(?:\\.\\d+)?)$/);
  if(num && num[1]==='inputs'){
    const l=Number(nested(inputs,num[2])),r=Number(num[4]);
    if(Number.isFinite(l)) result=num[3]==='>='?l>=r:num[3]==='<='?l<=r:num[3]==='>'?l>r:l<r;
  } else {
    const cmp=expr.match(/^(\\w+)\\.(.+?)\\s+(==|!=|includes)\\s+(.+)$/);
    if(cmp && cmp[1]==='inputs'){
      const l=nested(inputs,cmp[2]), r=cmp[4].trim();
      result=cmp[3]==='=='?String(l??'')===r:cmp[3]==='!='?String(l??'')!==r:Array.isArray(l)?l.includes(r):typeof l==='string'&&l.includes(r);
    } else if(expr==='services') result=services.length>0;
    else if(expr.startsWith('services.')) result=services.includes(expr.slice(9));
    else if(expr.startsWith('inputs.')){
      const v=nested(inputs,expr.slice(7)); result=v!==undefined&&v!==null&&v!==''&&v!==false&&!(Array.isArray(v)&&v.length===0);
    }
  }
  return neg?!result:result;
}
function ref(raw, inputs, services) {
  const s=String(raw).trim();
  if(s==='services') return services.slice();
  if(s.startsWith('inputs.')) return nested(inputs,s.slice(7));
  if(s.startsWith('services.')) return services.includes(s.slice(9));
}
function apply(value, inputs, services) {
  if(Array.isArray(value)) return value.filter(x=>!(x&&typeof x==='object'&&'__if'in x)||condition(x.__if,inputs,services)).flatMap(x=>{
    if(x&&typeof x==='object'&&'__if'in x){const {__if,...rest}=x;if('__value'in rest){const v=apply(rest.__value,inputs,services);return Array.isArray(v)?v:[v];}return [apply(rest,inputs,services)];}
    if(x&&typeof x==='object'&&'__value'in x){const v=apply(x.__value,inputs,services);return Array.isArray(v)?v:[v];}
    const v=apply(x,inputs,services);return Array.isArray(v)?v:[v];
  }).filter(x=>x!==REMOVE);
  if(value&&typeof value==='object'){
    if('__switch'in value){const r=ref(value.__switch,inputs,services),k=r==null?null:String(r),chosen=k!==null&&k in(value.cases||{})?value.cases[k]:value.default??null;return apply(chosen,inputs,services);}
    if('__if'in value&&'__value'in value) return condition(value.__if,inputs,services)?apply(value.__value,inputs,services):REMOVE;
    if(value.__remove===true)return REMOVE;
    const out={};for(const [k,v] of Object.entries(value)){const r=apply(v,inputs,services);if(r!==REMOVE)out[k]=r;}return out;
  }
  if(typeof value==='string'){
    if(value==='{{services}}')return services.slice();
    const single=value.match(/^\\{\\{(inputs|services)\\.([^}]+)\\}\\}$/);
    if(single){if(single[1]==='inputs'){const v=nested(inputs,single[2]);return v??'';}if(single[2].includes('.'))return value;return services.includes(single[2]);}
    return value.replace(/\\{\\{services\\}\\}/g,services.join(',')).replace(/\\{\\{(inputs|services)\\.([^}]+)\\}\\}/g,(_,ns,key)=>ns==='inputs'?String(nested(inputs,key)??''):key.includes('.')?`{{services.${key}}}`:String(services.includes(key)));
  }
  return value;
}
function resolveCredentialRefs(value, credentials={}) {
  if(typeof value==='string') return value.replace(/\\{\\{services\\.(\\w[\\w-]*)\\.(\\w[\\w-]*)\\}\\}/g,(_,sid,key)=>credentials[sid]?.[key]??'');
  if(Array.isArray(value)) return value.map(v=>resolveCredentialRefs(v,credentials));
  if(value&&typeof value==='object') return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,resolveCredentialRefs(v,credentials)]));
  return value;
}
function resolveTemplate(template,{inputOverrides={},serviceCredentials={}}={}){
  if(!template?.metadata||!template?.config) throw new Error('Invalid AIOStreams template');
  const inputDefaults=defaults(template.metadata.inputs||[]);
  const merge=(a,b)=>{if(Array.isArray(b))return b.slice();if(!b||typeof b!=='object')return b===undefined?a:b;const o={...(a&&typeof a==='object'&&!Array.isArray(a)?a:{})};for(const[k,v]of Object.entries(b))o[k]=merge(o[k],v);return o;};
  const inputs=merge(inputDefaults,inputOverrides||{});
  const services=Object.entries(serviceCredentials||{}).filter(([,v])=>v&&typeof v==='object'&&Object.values(v).some(Boolean)).map(([k])=>k);
  return {config:resolveCredentialRefs(apply(template.config,inputs,services),serviceCredentials),inputs,services};
}
module.exports={resolveTemplate,defaults,condition,apply,resolveCredentialRefs};
