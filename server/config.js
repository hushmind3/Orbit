import fs from 'node:fs/promises';
import path from 'node:path';
const file=()=>process.env.ORBIT_CONFIG_PATH||path.resolve('.runtime','config.json');
let updateChain=Promise.resolve();
const initial=()=>({provider:process.env.ORBIT_LLM_PROVIDER||'openai',base:process.env.ORBIT_LLM_BASE_URL||'',model:process.env.ORBIT_LLM_MODEL||'',key:process.env.ORBIT_LLM_API_KEY||'',owner:process.env.ORBIT_OWNER_WHATSAPP||''});
export async function loadConfig(){try{return {...initial(),...JSON.parse(await fs.readFile(file(),'utf8'))};}catch(e){if(e.code==='ENOENT')return initial();throw e;}}
export async function publicConfig(){const c=await loadConfig();return {provider:c.provider,base:c.base,model:c.model,hasKey:Boolean(c.key),owner:'***'+String(c.owner||'').replace(/\D/g,'').slice(-4),ownerConfigured:Boolean(c.owner),ready:Boolean(c.base&&c.model)};}
export async function saveConfig(patch){const task=updateChain.then(async()=>{const c=await loadConfig();
 if('provider' in patch){if(!['openai','ollama'].includes(patch.provider))throw Error('provider must be openai or ollama');c.provider=patch.provider;}
 if('base' in patch){const raw=String(patch.base||'').trim().replace(/\/+$/,'');if(raw && !/^https?:\/\//.test(raw))throw Error('모델 URL은 HTTP 또는 HTTPS여야 합니다.');if(raw.length>350)throw Error('모델 URL이 너무 깁니다.');c.base=raw;}
 if('model' in patch)c.model=String(patch.model||'').trim().slice(0,160);
 if('key' in patch && String(patch.key).trim())c.key=String(patch.key).trim().slice(0,2000);
 if(patch.clearKey===true)c.key='';
 if('owner' in patch && String(patch.owner||'').trim()){const p=String(patch.owner).replace(/\D/g,'');if(!/^\d{8,15}$/.test(p))throw Error('소유자 WhatsApp 번호는 국가번호 포함 숫자입니다.');c.owner=p;}
 await fs.mkdir(path.dirname(file()),{recursive:true});const tmp=file()+'.tmp';await fs.writeFile(tmp,JSON.stringify(c,null,2),{mode:0o600});await fs.chmod(tmp,0o600).catch(()=>{});await fs.rename(tmp,file());return {provider:c.provider,base:c.base,model:c.model,hasKey:Boolean(c.key),owner:'***'+String(c.owner||'').replace(/\D/g,'').slice(-4),ownerConfigured:Boolean(c.owner),ready:Boolean(c.base&&c.model)};});updateChain=task.catch(()=>{});return task;}
