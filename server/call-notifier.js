/** Deliver the actual telephone status and observed call notes to the requesting WhatsApp owner. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {sendWhatsApp} from './inbox.js';
import {findCase} from './negotiation.js';
const file=()=>process.env.ORBIT_CALL_NOTIFICATIONS_PATH||path.resolve('.runtime','call-notifications.json');
let writeQueue=Promise.resolve();
async function load(){try{return JSON.parse(await fs.readFile(file(),'utf8'));}catch(e){if(e.code==='ENOENT')return [];throw e;}}
async function transact(fn){const p=writeQueue.then(async()=>{const list=await load();const out=await fn(list);await fs.mkdir(path.dirname(file()),{recursive:true});const tmp=file()+'.tmp';await fs.writeFile(tmp,JSON.stringify(list),{mode:0o600});await fs.rename(tmp,file());return out;});writeQueue=p.catch(()=>{});return p;}
export async function trackCall(caseId,recipient){const number=String(recipient||'').replace(/\D/g,'');if(!/^\d{8,15}$/.test(number))return;return transact(x=>{x.push({caseId,recipient:number,createdAt:Date.now(),notified:false});x.splice(0,Math.max(0,x.length-300));return true;});}
export async function notifyCallCompletion(caseId,status){if(!['completed','busy','no-answer','failed','canceled'].includes(status))return false;
 const item=(await load()).find(x=>x.caseId===caseId&&!x.notified);if(!item)return false;
 const c=await findCase(caseId);if(!c)return false;
 const notes=c.turns.slice(-12).map(t=>`${t.role==='assistant'?'Orbit':t.role==='customer'?'상대방':'시스템'}: ${t.content}`).join('\n').slice(0,900);
 const content=`📞 AI 전화 종료\n상담: ${c.name}\n상태: ${status}\n\n${notes||'전화 연결 결과 외에 확인된 대화 기록이 없습니다.'}\n\n통화 상태가 완료여도 협상 목표가 달성됐다는 뜻은 아닙니다. 기록을 확인해 주세요.`;
 await sendWhatsApp(item.recipient,content);
 return transact(rows=>{const x=rows.find(y=>y.caseId===caseId);if(x)x.notified=true;return true;});
}
