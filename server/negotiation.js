import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID,createHmac,timingSafeEqual,createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {adbExecutable} from './mobile.js';

const exec = promisify(execFile);
const dataFile=()=>process.env.ORBIT_CASES_PATH||path.resolve('.runtime','cases.json');
const sessions=new Map();
const sessionsFile=()=>process.env.ORBIT_CALL_SESSIONS_PATH||path.resolve('.runtime','call-sessions.json');
let sessionsWrite=Promise.resolve();
async function loadSessions(){try{const rows=JSON.parse(await fs.readFile(sessionsFile(),'utf8'));for(const row of rows){if(row.created>Date.now()-4*60*60*1000)sessions.set(row.id,row);}}catch(e){if(e.code!=='ENOENT')console.error('전화 세션 복원 실패:',e.message);}}
await loadSessions();
async function persistSessions(){const task=sessionsWrite.then(async()=>{await fs.mkdir(path.dirname(sessionsFile()),{recursive:true});const temp=sessionsFile()+'.tmp';await fs.writeFile(temp,JSON.stringify([...sessions].map(([id,s])=>({id,...s}))),{mode:0o600});await fs.rename(temp,sessionsFile());});sessionsWrite=task.catch(()=>{});return task;}
let casesLock=Promise.resolve();
const clamp=(v,n=1000)=>typeof v==='string'?v.trim().slice(0,n):'';
const e164=/^\+[1-9]\d{6,14}$/;
const xml=(s)=>String(s).replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]));
async function load(){try{return JSON.parse(await fs.readFile(dataFile(),'utf8'));}catch(e){if(e.code==='ENOENT')return [];throw e;}}
async function save(rows){await fs.mkdir(path.dirname(dataFile()),{recursive:true});const tmp=dataFile()+'.tmp';await fs.writeFile(tmp,JSON.stringify(rows,null,2));await fs.rename(tmp,dataFile());}
async function transact(fn){const run=casesLock.then(async()=>{const rows=await load();const result=await fn(rows);await save(rows);return result;});casesLock=run.catch(()=>{});return run;}
export const newCase=async (input)=>transact(async rows=>{
 const item={id:randomUUID(),created:new Date().toISOString(),name:clamp(input.name,100)||'새 상담',number:clamp(input.number,35),goal:clamp(input.goal,1200),facts:clamp(input.facts,2500),limits:clamp(input.limits,1600),turns:[],status:'draft'};
 if(!item.goal)throw Error('원하는 결과를 입력하세요.');rows.unshift(item);rows.splice(40);return item;
});
export async function listCases(){return (await load()).map(({id,created,name,number,goal,status,turns})=>({id,created,name,number,goal,status,turnCount:turns.length}));}
export async function findCase(id){return (await load()).find(c=>c.id===id)||null;}
export async function recordTurn(id,role,content,extra={}) {return transact(async rows=>{
 const c=rows.find(x=>x.id===id);if(!c)throw Error('상담을 찾을 수 없습니다.');
 c.turns.push({role,content:clamp(content,6000),time:new Date().toISOString(),...extra});c.turns=c.turns.slice(-90);return c;
});}
export async function setCaseStatus(id,status){return transact(async rows=>{const c=rows.find(x=>x.id===id);if(!c)throw Error('상담 없음');c.status=status;return c;});}
const MODEL_SYSTEM=`당신은 한국어 고객센터 통화 협상 보조 AI입니다. 고객의 이익과 협상 목표를 최우선으로 지킵니다.
대화는 일방적 민원문이 아닌 상대방의 답변에 따른 실제 교섭입니다. 상대방이 주장한 금액, 기한, 규정, 혜택의 근거를 질문하고 더 유리한 대안을 찾습니다.
상담원의 주장이 확정 사실인 것처럼 받아들이지 마세요. 사전에 정한 양보 제한을 넘거나 새 약정, 취소 수수료, 비용·책임 인정, 권리 포기, 결제가 발생하면 반드시 사용자가 결정하도록 잠시 보류하세요.
ARS 메뉴에서 번호를 골라야 한다면 digits에 번호를 적고 say는 빈 문자열로 하세요. 상담원이 연결될 때까지 기다리라는 안내나 대기음이면 flag=hold와 빈 say를 반환하세요. 상담원에게 먼저 인사를 할 때는 AI 비서임을 밝힙니다.
사람을 가장하지 않고 AI 비서라는 사실을 묻거나 필요하면 밝힙니다. 상담/안내 도중 확인되지 않은 법률 조항을 지어내지 마세요.
전화 대화처럼 자연스럽고 간결한 한국어로 말하세요. 공격적 언어를 사용하지 마세요.
응답은 다른 문장 없이 JSON 객체로만 주세요: {"say":"상대에게 다음으로 말할 1~3문장","reason":"왜 이렇게 대응하는지 고객에게 설명","flag":"normal 또는 hold 또는 approval 또는 escalate 또는 finish","digits":"ARS 번호 선택시만 0~9*# 1~5글자, 평소 빈 문자열"}.`;
const tryParse=(s)=>{let t=String(s||'').trim().replace(/^```(?:json)?\s*/,'').replace(/```$/,'');const m=t.match(/\{[\s\S]*\}/);try {return JSON.parse(m?m[0]:t);}catch{return {say:t,reason:'응답 형식을 바로잡아 주세요.',flag:'normal',digits:''};}};
export async function infer(config,messages){
 const provider=config?.provider==='openai'?'openai':'ollama';
 const model=clamp(config?.model,120);const base=clamp(config?.base,300).replace(/\/+$/,'');
 if(!model||!/^https?:\/\//.test(base))throw Error('설정에서 Ollama 또는 AI API 모델을 연결하세요.');
 const url=base+(provider==='ollama'?'/api/chat':'/chat/completions');
 const headers={'Content-Type':'application/json'};if(provider==='openai'&&config.key)headers.Authorization='Bearer '+clamp(config.key,400);
 const body=provider==='ollama'?{model,messages,stream:false,format:'json',options:{temperature:0.3}}:{model,messages,temperature:0.3,response_format:{type:'json_object'}};
 const response=await fetch(url,{method:'POST',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(Math.min(Number(config.timeoutMs)||55000,55000))});
 const j=await response.json().catch(()=>({}));if(!response.ok)throw Error('AI 응답 오류 '+response.status+': '+JSON.stringify(j).slice(0,150));
 return provider==='ollama'?j.message?.content:j.choices?.[0]?.message?.content;
}
export async function propose(c,heard,config){
 const history=c.turns.slice(-18).map(x=>({role:x.role==='assistant'?'assistant':'user',content:`${x.role==='customer'?'상담원':x.role==='assistant'?'AI':'의뢰인'}: ${x.content}`}));
 const messages=[{role:'system',content:MODEL_SYSTEM},{role:'user',content:JSON.stringify({customer_goal:c.goal,known_facts:c.facts,hard_limits:c.limits,previous:history,new_customer_message:heard},null,2)}];
 const raw=await infer(config,messages);const item=tryParse(raw);
 let say=clamp(item.say,900);
 const flag=['normal','hold','approval','escalate','finish'].includes(item.flag)?item.flag:'normal';
 const digits=/^[0-9*#]{1,5}$/.test(item.digits)?item.digits:'';
 if(!say&&!digits&&!['hold','approval','finish'].includes(flag))say='말씀하신 조건을 확인해 주시겠습니까?';
 return {say,reason:clamp(item.reason,900),flag,digits};
}
export async function processTurn(id,heard,config){
 let c=await findCase(id);if(!c)throw Error('상담 없음');
 const phrase=clamp(heard,3000);if(!phrase)throw Error('상대방 발언을 입력하세요.');
 await recordTurn(id,'customer',phrase);c=await findCase(id);
 const decision=await propose(c,phrase,config);
 await recordTurn(id,'assistant',decision.say,{flag:decision.flag,reason:decision.reason,digits:decision.digits});
 return decision;
}
const settings=()=>({sid:process.env.TWILIO_ACCOUNT_SID||'',token:process.env.TWILIO_AUTH_TOKEN||'',from:process.env.TWILIO_FROM||'',publicUrl:(process.env.ORBIT_PUBLIC_URL||'').replace(/\/+$/,'')});
export function callReady(){const s=settings();return Boolean(s.sid&&s.token&&e164.test(s.from)&&/^https:\/\/[^/]+/.test(s.publicUrl));}
export function callInfo(){return {configured:callReady(),mode:'Twilio REST + TwiML Gather',publicUrl:settings().publicUrl||null};}
export async function startCall(id,number,config){
 const s=settings();if(!callReady())throw Error('실제 발신에 Twilio 계정·발신번호·공개 HTTPS 주소를 설정해야 합니다.');
 if(!e164.test(number))throw Error('국가번호가 포함된 번호(+82...)만 직접 발신할 수 있습니다. 1588/1544 번호는 별도 국내 통신 연결이 필요합니다.');
 const c=await findCase(id);if(!c)throw Error('상담을 찾을 수 없습니다.');
 const key=randomUUID().replace(/-/g,'');sessions.set(id,{key,config,created:Date.now(),started:false,emptyRounds:0,lastInput:'',lastInputAt:0});await persistSessions();
 const body=new URLSearchParams({To:number,From:s.from,Url:`${s.publicUrl}/twilio/voice/${id}?token=${key}`,Method:'POST',StatusCallback:`${s.publicUrl}/twilio/status/${id}?token=${key}`,StatusCallbackMethod:'POST'});
 const response=await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(s.sid)}/Calls.json`,{method:'POST',headers:{Authorization:'Basic '+Buffer.from(s.sid+':'+s.token).toString('base64'),'Content-Type':'application/x-www-form-urlencoded'},body,signal:AbortSignal.timeout(12000)});
 const json=await response.json().catch(()=>({}));if(!response.ok){sessions.delete(id);await persistSessions();throw Error('통신사 발신 실패: '+(json.message||response.status));}
 await setCaseStatus(id,'calling');return {sid:json.sid,status:json.status};
}
function sayGather(id,token,prompt='',digits=''){
 const link=`${settings().publicUrl}/twilio/voice/${id}?token=${token}`;
 const play=digits?`<Play digits="${xml(digits)}"/>`:'';
 const speech=prompt?`<Say voice="Polly.Seoyeon" language="ko-KR">${xml(prompt)}</Say>`:'';
 // Silent listen is vital for 30-minute customer-center queues: do not talk over hold audio.
 return `<?xml version="1.0" encoding="UTF-8"?><Response>${play}<Gather input="speech" language="ko-KR" timeout="20" speechTimeout="auto" actionOnEmptyResult="true" action="${xml(link)}" method="POST">${speech}</Gather></Response>`;
}
export function validateWebhook({id,token,url,form,signature}){
 const s=settings();const sess=sessions.get(id);if(!sess||sess.key!==token||!s.token||!signature)return false;
 const signed=url+Object.keys(form).sort().map(k=>k+form[k]).join('');
 const expected=createHmac('sha1',s.token).update(signed).digest('base64');
 const a=Buffer.from(expected),b=Buffer.from(signature);return a.length===b.length&&timingSafeEqual(a,b);
}
export async function twilioTurn({id,form}){
 const sess=sessions.get(id);if(!sess)throw Error('전화 세션을 찾을 수 없습니다. 서버 재시작 후 확인해 주세요.');
 if(sess.ended)return '<?xml version="1.0"?><Response><Hangup/></Response>';
 const c=await findCase(id);if(!c)throw Error('상담 없음');
 const raw=clamp(form.SpeechResult||'',1400);const digits=clamp(form.Digits||'',10);
 // Initial TwiML is receive-first, so automated ARS can finish its opening menu.
 if(!sess.started){sess.started=true;await persistSessions();return sayGather(id,sess.key);}
 if(!raw&&!digits){
  sess.emptyRounds=(sess.emptyRounds||0)+1;
  if(sess.emptyRounds>=135){await recordTurn(id,'system','통화 중 입력이 장시간 없어 종료했습니다.');await setCaseStatus(id,'timeout');sess.ended=true;await persistSessions();return '<?xml version="1.0"?><Response><Hangup/></Response>';}
  if(sess.emptyRounds%30===0){await recordTurn(id,'system',`ARS 대기 중, 조용한 구간 ${sess.emptyRounds*20}초 경과 (정확한 연결 상태 미확인)`);}
  await persistSessions();return sayGather(id,sess.key);
 }
 sess.emptyRounds=0;
 if(digits){await recordTurn(id,'customer',`통화 상대가 DTMF ${digits} 키를 입력했습니다.`);await persistSessions();return sayGather(id,sess.key);}
 if(sess.lastInput===raw&&Date.now()-sess.lastInputAt<8000){return sayGather(id,sess.key);}
 sess.lastInput=raw;sess.lastInputAt=Date.now();await persistSessions();
 if(!/(\d+번|버튼을|눌러|선택)/.test(raw)&&/(상담원을.{0,12}기다|잠시.{0,10}기다려|통화량이 많|순서대로.{0,10}연결|기다리시면.{0,10}연결|잠시만 기다려|모든 상담원이 통화)/.test(raw)){
   await recordTurn(id,'customer',raw,{flag:'hold'});
   return sayGather(id,sess.key);
 }
 let decision;
 try{decision=await processTurn(id,raw,sess.config);}
 catch(e){await recordTurn(id,'system','모델 응답 지연 또는 오류: '+String(e.message).slice(0,140));return sayGather(id,sess.key,'잠시만 기다려 주시겠습니까? 확인하고 있습니다.');}
 if(decision.flag==='hold')return sayGather(id,sess.key);
 if(decision.flag==='finish'){
  // The model ending the dialogue does not prove the requested cancellation or refund succeeded.
  await setCaseStatus(id,'outcome-unverified');
  await recordTurn(id,'system','AI가 대화를 마쳤습니다. 실제 상담 목표 달성 여부는 확인되지 않았습니다.');
  sess.ended=true;await persistSessions();
  return `<?xml version="1.0"?><Response><Say voice="Polly.Seoyeon" language="ko-KR">${xml(decision.say||'감사합니다.')}</Say><Hangup/></Response>`;
 }
 if(decision.flag==='approval'){
  await setCaseStatus(id,'needs-approval');sess.ended=true;await persistSessions();
  await recordTurn(id,'system','사용자 확인이 필요한 조건이므로 합의하지 않고 통화를 종료했습니다.');
  return `<?xml version="1.0"?><Response><Say voice="Polly.Seoyeon" language="ko-KR">의뢰인에게 확인한 뒤 다시 연락드리겠습니다. 감사합니다.</Say><Hangup/></Response>`;
 }
 return sayGather(id,sess.key,decision.say,decision.digits);
}
export async function twilioStatus(id,form){
 const callStatus=clamp(form.CallStatus,80)||'unknown';
 const session=sessions.get(id);
 // Keep the signed callback token for Twilio's delayed/retried status webhooks.
 // Deleting it at voice hangup caused valid completion callbacks to be rejected.
 if(session?.terminalStatus)return;
 const current=await findCase(id);
 // A telephone platform's 'completed' means the call ended, NOT that negotiation succeeded.
 if(current?.status==='needs-approval'||current?.status==='outcome-unverified'){
  await recordTurn(id,'system',`통신상태: ${callStatus} (업무 결과: ${current.status} 유지)`);
 }else if(callStatus==='completed'){
  await setCaseStatus(id,'call-ended-unverified');
  await recordTurn(id,'system','전화가 종료됐습니다. 고객센터 업무 목표 달성 여부는 확인되지 않았습니다.');
 }else await setCaseStatus(id,callStatus).catch(()=>{});
 if(['completed','failed','busy','no-answer','canceled'].includes(callStatus)&&session){session.ended=true;session.terminalStatus=callStatus;await persistSessions();}
}
export async function adbDevices(){
 try {const {stdout}=await exec(adbExecutable(),['devices'],{timeout:4000,windowsHide:true});return stdout.trim();}
 catch(e){return `ADB 사용 불가: ${e.code||e.message}`;}
}
export async function adbDial(number){
 const n=clamp(number,40);if(!/^[+\d#*\-\s]{3,30}$/.test(n))throw Error('번호가 올바르지 않습니다.');
 const {stdout}=await exec(adbExecutable(),['devices'],{timeout:4000});const found=stdout.split(/\r?\n/).filter(x=>/\tdevice$/.test(x));
 if(found.length!==1)throw Error('USB 디버깅이 허용된 안드로이드 기기 1대가 필요합니다.');
 await exec(adbExecutable(),['shell','am','start','-a','android.intent.action.DIAL','-d','tel:'+n.replace(/[\s-]/g,'')],{timeout:8000});
 return '갤럭시 전화 앱에 번호를 입력했습니다. 발신은 휴대폰에서 확인해 주세요.';
}
export async function duplicatePhotos(){
 const os=await import('node:os');const roots=['Pictures','Downloads'].map(x=>path.join(os.homedir(),x));const map=new Map();let scanned=0;
 async function walk(dir,depth){if(depth>4||scanned>=1200)return;let entries;try{entries=await fs.readdir(dir,{withFileTypes:true});}catch{return;}
 for(const e of entries){if(scanned>=1200)break;const f=path.join(dir,e.name);if(e.isSymbolicLink())continue;if(e.isDirectory()){await walk(f,depth+1);continue;}if(!/\.(jpe?g|png|heic|webp|gif)$/i.test(e.name))continue;
 scanned++;try{const stat=await fs.stat(f);if(stat.size>45_000_000)continue;const hash=createHash('sha256').update(await fs.readFile(f)).digest('hex');const key=hash+':'+stat.size;if(!map.has(key))map.set(key,[]);map.get(key).push(f);}catch{}}
 }
 for(const r of roots)await walk(r,0);
 return {scanned,groups:[...map.values()].filter(a=>a.length>1).slice(0,70),note:'정확히 동일한 파일만 찾습니다. 원본·사진 삭제는 하지 않습니다.'};
}
