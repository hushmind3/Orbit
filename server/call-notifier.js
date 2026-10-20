/** Durable call-result outbox: Twilio is acknowledged only after status is queued.
 * A Meta failure or process restart must not silently lose the call report. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {sendWhatsApp,addSystemMessage} from './inbox.js';
import {findCase} from './negotiation.js';
const file=()=>process.env.ORBIT_CALL_NOTIFICATIONS_PATH||path.resolve('.runtime','call-notifications.json');
const terminal=new Set(['completed','busy','no-answer','failed','canceled']);
let writes=Promise.resolve();
const inFlight=new Set();
const digits=n=>String(n||'').replace(/\D/g,'');
async function load(){try{return JSON.parse(await fs.readFile(file(),'utf8'));}catch(e){if(e.code==='ENOENT')return [];throw e;}}
async function transact(fn){const p=writes.then(async()=>{const rows=await load(),result=fn(rows);await fs.mkdir(path.dirname(file()),{recursive:true});const tmp=file()+'.tmp';await fs.writeFile(tmp,JSON.stringify(rows,null,2),{mode:0o600});await fs.rename(tmp,file());return result;});writes=p.catch(()=>{});return p;}
export async function trackCall(caseId,recipient,options={}){
 const number=digits(typeof recipient==='object'?recipient.recipient:recipient);
 const threadId=typeof recipient==='object'?recipient.threadId:options.threadId;
 if(number&&!/^\d{8,15}$/.test(number))throw Error('WhatsApp 결과 수신 번호 형식 오류');
 if(!number&&!threadId)throw Error('전화 결과를 전달할 WhatsApp 번호 또는 PC 대화가 필요합니다.');
 return transact(rows=>{const old=rows.find(x=>x.caseId===caseId);
  if(old){if((old.recipient||'')!==number||(old.threadId||null)!==(threadId||null))throw Error('전화 결과 수신처를 변경할 수 없습니다.');return false;}
  rows.push({caseId,recipient:number||null,threadId:threadId||null,createdAt:Date.now(),notified:false,deliveredWhatsApp:!number,deliveredLocal:!threadId,terminalStatus:null,attempts:0,nextAttemptAt:0});
  const done=rows.filter(x=>x.notified);if(done.length>500){const ids=new Set(done.slice(0,done.length-500).map(x=>x.caseId));for(let i=rows.length-1;i>=0;i--)if(ids.has(rows[i].caseId))rows.splice(i,1);}return true;
 });
}
export async function untrackCall(caseId){return transact(rows=>{const i=rows.findIndex(x=>x.caseId===caseId&&!x.terminalStatus);if(i>=0)rows.splice(i,1);return i>=0;});}
export async function queueCallCompletion(caseId,status){
 if(!terminal.has(status))return false;
 return transact(rows=>{const x=rows.find(r=>r.caseId===caseId);if(!x)return false;
  if(!x.terminalStatus){x.terminalStatus=status;x.queuedAt=Date.now();x.nextAttemptAt=0;}
  if(typeof x.deliveredWhatsApp!=='boolean')x.deliveredWhatsApp=!x.recipient;
  if(typeof x.deliveredLocal!=='boolean')x.deliveredLocal=!x.threadId;
  return true;});
}
const backoff=n=>Math.min(3600000,Math.max(10000,10000*2**Math.min(n-1,9)));
export async function deliverCallNotification(caseId,{force=false}={}){
 if(inFlight.has(caseId))return false;inFlight.add(caseId);
 try{
  let x=(await load()).find(r=>r.caseId===caseId);
  if(!x||!x.terminalStatus||x.notified||(!force&&x.nextAttemptAt>Date.now()))return false;
  const c=await findCase(caseId);if(!c)throw Error('통화 내역이 없습니다.');
  const notes=c.turns.slice(-12).map(t=>(t.role==='assistant'?'Orbit':t.role==='customer'?'상대방':'시스템')+': '+t.content).join('\n').slice(0,900);
  const body='📞 AI 전화 종료\n상담: '+c.name+'\n상태: '+x.terminalStatus+'\n\n'+(notes||'전화 연결 결과 외에 확인된 대화 기록이 없습니다.')+'\n\n통화 종료는 협상·해지·환불 성공을 의미하지 않습니다. 결과를 별도로 확인해 주세요.';
  if(!x.deliveredWhatsApp&&x.recipient){await sendWhatsApp(x.recipient,body);
   await transact(rows=>{const r=rows.find(y=>y.caseId===caseId);if(r)r.deliveredWhatsApp=true;});}
  x=(await load()).find(r=>r.caseId===caseId);
  if(!x.deliveredLocal&&x.threadId){await addSystemMessage(x.threadId,body);
   await transact(rows=>{const r=rows.find(y=>y.caseId===caseId);if(r)r.deliveredLocal=true;});}
  return transact(rows=>{const r=rows.find(y=>y.caseId===caseId);
   if(r&&r.deliveredWhatsApp&&r.deliveredLocal){r.notified=true;r.notifiedAt=Date.now();r.lastError=null;return true;}return false;});
 }catch(e){await transact(rows=>{const r=rows.find(y=>y.caseId===caseId);
  if(r&&!r.notified){r.attempts=(r.attempts||0)+1;r.lastError=String(e.message||e).slice(0,300);r.nextAttemptAt=Date.now()+backoff(r.attempts);}});return false;
 }finally{inFlight.delete(caseId);}
}
export async function flushCallNotifications(){
 const rows=await load(),due=rows.filter(r=>r.terminalStatus&&!r.notified&&(!r.nextAttemptAt||r.nextAttemptAt<=Date.now()));
 let delivered=0;for(const r of due)if(await deliverCallNotification(r.caseId))delivered++;return delivered;
}
export async function notifyCallCompletion(caseId,status){return await queueCallCompletion(caseId,status)?deliverCallNotification(caseId):false;}
export async function callNotificationStatus(caseId){return (await load()).find(r=>r.caseId===caseId)||null;}
