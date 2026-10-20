import fs from 'node:fs/promises';
import path from 'node:path';
const location=()=>process.env.ORBIT_CONNECTORS_PATH||path.resolve('.runtime','connectors.json');
const keys=['WA_BUSINESS_NUMBER','WA_PHONE_NUMBER_ID','WA_ACCESS_TOKEN','WA_APP_SECRET','WA_VERIFY_TOKEN','WA_GRAPH_VERSION','TWILIO_ACCOUNT_SID','TWILIO_AUTH_TOKEN','TWILIO_FROM','TWILIO_VERIFY_SERVICE_SID','ORBIT_PUBLIC_URL'];
let queue=Promise.resolve();
export async function bootstrapConnectors(){let saved={};try{saved=JSON.parse(await fs.readFile(location(),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}for(const key of keys)if(saved[key] && !process.env[key])process.env[key]=saved[key];}
export function connectorSummary(){return Object.fromEntries(keys.map(k=>[k,{set:Boolean(process.env[k]),value:['WA_BUSINESS_NUMBER','WA_PHONE_NUMBER_ID','TWILIO_FROM','TWILIO_VERIFY_SERVICE_SID','ORBIT_PUBLIC_URL','WA_GRAPH_VERSION'].includes(k)?process.env[k]||'':''}]));}
export async function updateConnectors(patch){const next=queue.then(async()=>{
 let saved={};try{saved=JSON.parse(await fs.readFile(location(),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
 for(const k of keys){if(!(k in patch))continue;const s=String(patch[k]??'').trim();if(!s)continue;if(s.length>2500)throw Error(k+' 값이 너무 깁니다.');
  if(k==='ORBIT_PUBLIC_URL'&&!/^https:\/\/[A-Za-z0-9.-]+(?::\d+)?(?:\/.*)?$/.test(s))throw Error('공개 URL은 HTTPS 주소여야 합니다.');
  if(k==='WA_BUSINESS_NUMBER'&&!/^\+?[0-9]{8,15}$/.test(s))throw Error('WhatsApp 비즈니스 번호를 확인하세요.');
  saved[k]=s;process.env[k]=s;
 }
 await fs.mkdir(path.dirname(location()),{recursive:true});const tmp=location()+'.tmp';await fs.writeFile(tmp,JSON.stringify(saved,null,2),{mode:0o600});await fs.chmod(tmp,0o600).catch(()=>{});await fs.rename(tmp,location());return connectorSummary();});queue=next.catch(()=>{});return next;}
