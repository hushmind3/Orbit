import {randomBytes, randomUUID} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const DB = () => process.env.ORBIT_ONBOARDING_PATH || path.resolve(process.cwd(), '.runtime', 'onboarding.json');
const MAX_AGE = 15 * 60 * 1000;
const fresh = () => ({sessions:[],accounts:[]});
let writeQueue = Promise.resolve();
const cleanNumber = value => String(value || '').replace(/[^0-9]/g, '');
function configuredNumber(){return cleanNumber(process.env.WA_BUSINESS_NUMBER || '');}
function smsReady(){return Boolean(process.env.TWILIO_VERIFY_SERVICE_SID && process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);}
function validPhone(v){return /^\+[1-9]\d{7,14}$/.test(String(v||''));}
function gatewayReady(){return Boolean(configuredNumber() && process.env.WA_APP_SECRET && process.env.WA_VERIFY_TOKEN && process.env.WA_PHONE_NUMBER_ID && process.env.WA_ACCESS_TOKEN);}
async function readDB(){try{return {...fresh(),...JSON.parse(await fs.readFile(DB(),'utf8'))};}catch(e){if(e.code==='ENOENT')return fresh();throw e;}}
async function transact(fn){const p = writeQueue.then(async()=>{const state=await readDB();const result=await fn(state);await fs.mkdir(path.dirname(DB()),{recursive:true});await fs.writeFile(DB()+'.tmp', JSON.stringify(state,null,2));await fs.rename(DB()+'.tmp',DB());return result;});writeQueue=p.catch(()=>{});return p;}
export function onboardingConfig(){return {channel:'whatsapp',ready:gatewayReady(),smsReady:smsReady(),phoneNumberConfigured:Boolean(configuredNumber()),note:gatewayReady()?'WhatsApp Business API 연동 설정됨':'Meta WhatsApp Business Cloud API 번호·인증키·웹훅 연결 필요'};}
export async function createJoinSession({demo=false,phone=''}={}){
 const isDemo=Boolean(demo);
 const businessNumber=configuredNumber();
 const id=randomUUID();const code=randomBytes(12).toString('hex');
 const createdAt=Date.now(),expiresAt=createdAt+MAX_AGE;
 const smsRequired=smsReady();if(!isDemo&&gatewayReady()&&smsRequired&&!validPhone(phone))throw new Error('전화번호를 +82... 형식으로 입력하세요.');
 const status=isDemo?'demo_waiting':(!gatewayReady()?'unconfigured':smsRequired?'awaiting_sms':'awaiting_whatsapp');
 const link=!isDemo&&status==='awaiting_whatsapp' ? `https://wa.me/${businessNumber}?text=${encodeURIComponent(`ORBIT-START ${code}`)}` : null;
 const s={id,code,createdAt,expiresAt,status,demo:isDemo,link,from:null,messageId:null,phone:smsRequired?cleanNumber(phone):null,verifiedSms:false,smsAttempts:0,smsStartedAt:0};
 await transact(db=>{db.sessions=db.sessions.filter(x=>x.expiresAt>Date.now()).slice(-99);db.sessions.push(s);});
 return {id,expiresAt,status,link,channel:'whatsapp',smsRequired,message:status==='unconfigured'?'WhatsApp Business 번호·웹훅 연결 전입니다. 실제 QR 가입은 아직 사용할 수 없습니다.':null};
}
export async function sessionStatus(id){const db=await readDB();const s=db.sessions.find(x=>x.id===id);if(!s)return null;
 const status=(s.expiresAt<Date.now() && (['awaiting_whatsapp','awaiting_sms','demo_waiting'].includes(s.status)))?'expired':s.status;
 return {id,status,channel:'whatsapp',expiresAt:s.expiresAt,smsRequired:Boolean(s.phone),verifiedSms:Boolean(s.verifiedSms),link:status==='awaiting_whatsapp'?s.link:null,verified:status==='verified',demo:status==='demo_complete',phone:status==='verified' ? `***${String(s.from||'').slice(-4)}`:null};
}
export async function consumeJoinMessage({from,text,messageId}={}){
 const match=/^ORBIT-START\s+([0-9a-f]{24})\s*$/i.exec(String(text||'').trim());
 if(!match)return {consumed:false};
 const code=match[1].toLowerCase(),sender=cleanNumber(from);
 if(!sender || !messageId)return {consumed:true,ok:false,reason:'missing sender or message id'};
 return transact(db=>{
  const s=db.sessions.find(x=>x.code===code && !x.demo);
  if(!s||s.status!=='awaiting_whatsapp'||s.expiresAt<Date.now())return {consumed:true,ok:false,reason:'invalid or expired token'};
  if(s.phone && (!s.verifiedSms||s.phone!==sender))return {consumed:true,ok:false,reason:'WhatsApp sender must match verified phone'};
  const existing=db.accounts.find(x=>x.channel==='whatsapp'&&x.sender===sender);
  if(existing){existing.lastVerifiedAt=new Date().toISOString();s.accountId=existing.id;}
  else {const account={id:randomUUID(),channel:'whatsapp',sender,createdAt:new Date().toISOString(),lastVerifiedAt:new Date().toISOString()};db.accounts.push(account);s.accountId=account.id;}
  s.status='verified';s.from=sender;s.messageId=messageId;s.code='used';s.link=null;
  return {consumed:true,ok:true,accountId:s.accountId,from:sender};
 });
}
export async function completeDemo(id){return transact(db=>{const s=db.sessions.find(x=>x.id===id&&x.demo);if(!s||s.expiresAt<Date.now())throw new Error('시연 세션이 만료되었습니다');if(s.status!=='demo_waiting')throw new Error('이미 종료된 시연입니다');s.status='demo_complete';return {ok:true,id,mode:'demo',verified:false};});}
export async function getOnboardingStats(){const db=await readDB();return {registered:db.accounts.length,pending:db.sessions.filter(x=>x.status==='awaiting_whatsapp'&&x.expiresAt>Date.now()).length,accounts:db.accounts.map(x=>({id:x.id,channel:x.channel,phone:`***${x.sender.slice(-4)}`,createdAt:x.createdAt})).slice(-50),config:onboardingConfig()};}

export async function isRegisteredWhatsApp(sender){const db=await readDB();return db.accounts.some(x=>x.channel==='whatsapp'&&x.sender===cleanNumber(sender));}
export async function getJoinLink(id){const db=await readDB();const s=db.sessions.find(x=>x.id===id&&x.status==='awaiting_whatsapp'&&x.expiresAt>Date.now());return s?.link||null;}

async function verifyRequest(endpoint,data){
 if(!smsReady())throw new Error('Twilio Verify 서비스를 설정하세요.');
 const sid=process.env.TWILIO_VERIFY_SERVICE_SID;
 const auth=Buffer.from(process.env.TWILIO_ACCOUNT_SID+':'+process.env.TWILIO_AUTH_TOKEN).toString('base64');
 const url=`https://verify.twilio.com/v2/Services/${encodeURIComponent(sid)}/${endpoint}`;
 const response=await fetch(url,{method:'POST',headers:{Authorization:'Basic '+auth,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(data),signal:AbortSignal.timeout(15000)});
 const result=await response.json().catch(()=>({}));
 if(!response.ok)throw new Error('SMS 인증 서비스 오류: '+String(result.message||response.status).slice(0,150));
 return result;
}
export async function startSms(id){
 const db=await readDB(),s=db.sessions.find(x=>x.id===id);
 if(!s||s.demo||s.status!=='awaiting_sms'||s.expiresAt<Date.now()||!s.phone)throw new Error('유효한 SMS 가입 세션이 없습니다.');
 if(s.smsAttempts>=3||Date.now()-s.smsStartedAt<45000)throw new Error('SMS 재요청은 45초 간격으로 최대 3번 가능합니다.');
 // Record the attempt before reaching the paid provider; avoids double billing from concurrent requests.
 const reserved=await transact(d=>{const row=d.sessions.find(x=>x.id===id);if(row.smsAttempts>=3||Date.now()-row.smsStartedAt<45000)return false;row.smsAttempts++;row.smsStartedAt=Date.now();return true;});
 if(!reserved)throw new Error('SMS 재요청 제한');
 await verifyRequest('Verifications',{To:'+'+s.phone,Channel:'sms'});
 return {ok:true,status:'awaiting_sms',message:'인증번호를 전송했습니다.'};
}
export async function checkSms(id,code){
 const db=await readDB(),s=db.sessions.find(x=>x.id===id);
 if(!s||s.demo||s.status!=='awaiting_sms'||s.expiresAt<Date.now()||!s.phone)throw new Error('인증 세션이 유효하지 않습니다.');
 if(!/^[0-9]{4,10}$/.test(String(code||'')))throw new Error('SMS 인증번호를 입력하세요.');
 const checked=await verifyRequest('VerificationCheck',{To:'+'+s.phone,Code:String(code)});
 if(checked.status!=='approved')return {ok:false,status:'awaiting_sms',message:'인증번호가 일치하지 않습니다.'};
 return transact(d=>{const row=d.sessions.find(x=>x.id===id);if(!row||row.status!=='awaiting_sms'||row.expiresAt<Date.now())throw new Error('인증이 만료되었습니다.');row.verifiedSms=true;row.status='awaiting_whatsapp';row.link=`https://wa.me/${configuredNumber()}?text=${encodeURIComponent(`ORBIT-START ${row.code}`)}`;return {ok:true,status:row.status,link:row.link};});
}
