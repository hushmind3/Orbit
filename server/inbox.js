import {createHmac,timingSafeEqual,randomUUID} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const dataPath=path.resolve(process.cwd(),'.runtime','inbox.json');
const empty=()=>({threads:[],tasks:[],events:[],settings:{autoDraft:true,autoSend:false}});
let writeChain=Promise.resolve();
let processing=new Set();
const now=()=>new Date().toISOString();
async function read(){try{const data=JSON.parse(await fs.readFile(dataPath,'utf8'));return {...empty(),...data,settings:{...empty().settings,...data.settings}};}catch{return empty();}}
async function modify(fn){const job=writeChain.then(async()=>{const d=await read();const result=await fn(d);await fs.mkdir(path.dirname(dataPath),{recursive:true});const tmp=dataPath+'.tmp';await fs.writeFile(tmp,JSON.stringify(d,null,2),'utf8');await fs.rename(tmp,dataPath);return result;});writeChain=job.catch(()=>{});return job;}
function log(d,event,description){d.events.unshift({id:randomUUID(),time:now(),event,description:String(description).slice(0,300)});d.events=d.events.slice(0,120);}
const channelIds=['test','whatsapp','imessage'];
const textLimit=(s,n)=>String(s??'').trim().slice(0,n);
function workIntent(s){return /전화|해지|환불|예약|취소|구매|결제|주문|민원|서비스센터|사진|파일|앱|삭제|계약|통화|대신|신청|접수|변경|설치|보내|작성|찾아|검색/.test(s);}
export async function receiveMessage({channel='test',sender='local-test',text,messageId=null}){
 if(!channelIds.includes(channel))throw new Error('지원하지 않는 채널');
 const message=textLimit(text,4000);if(!message)throw new Error('메시지가 비어 있습니다.');
 const who=textLimit(sender,120);if(!who)throw new Error('발신자가 없습니다.');
 return modify(d=>{
  let t=d.threads.find(x=>x.channel===channel&&x.sender===who);
  if(messageId&&t?.messages.some(m=>m.externalId===messageId))return {threadId:t.id,duplicate:true};
  if(!t){t={id:randomUUID(),channel,sender:who,createdAt:now(),updatedAt:now(),messages:[]};d.threads.unshift(t);}
  const msg={id:randomUUID(),externalId:messageId||null,direction:'in',text:message,time:now(),status:'received'};
  t.messages.push(msg);t.messages=t.messages.slice(-120);t.updatedAt=now();
  const task={id:randomUUID(),threadId:t.id,messageId:msg.id,title:textLimit(message,90),channel,kind:workIntent(message)?'action':'conversation',status:'received',createdAt:now(),updatedAt:now(),draft:''};
  d.tasks.unshift(task);d.tasks=d.tasks.slice(0,250);
  log(d,'message',`${channel} · 새 요청 · ${task.title}`);
  return {threadId:t.id,taskId:task.id,duplicate:false};
 });
}
export async function addSystemMessage(threadId,text){return modify(d=>{const t=d.threads.find(x=>x.id===threadId);if(!t)throw Error('대화 없음');t.messages.push({id:randomUUID(),externalId:null,direction:'out',text:String(text).slice(0,1600),time:now(),status:'internal'});t.messages=t.messages.slice(-120);return {ok:true};});}
export async function getDashboard(){const d=await read();const casesAvailable=true;return {counts:{threads:d.threads.length,open:d.tasks.filter(x=>!['sent','completed','dismissed'].includes(x.status)).length,ready:d.tasks.filter(x=>x.status==='draft_ready').length,failed:d.tasks.filter(x=>x.status==='failed').length},threads:d.threads.map(({messages,...t})=>({...t,lastMessage:messages.at(-1)||null,count:messages.length})),tasks:d.tasks,events:d.events.slice(0,45),settings:d.settings,channels:{whatsapp:{connected:Boolean(process.env.WA_ACCESS_TOKEN&&process.env.WA_PHONE_NUMBER_ID&&process.env.WA_APP_SECRET&&process.env.WA_VERIFY_TOKEN),webhook:'/webhook/whatsapp',note:'WhatsApp Business Cloud API 등록 및 공개 HTTPS 필요'},imessage:{connected:false,note:'Apple Messages for Business 또는 별도 Mac 브리지 미연결'},test:{connected:true,note:'관리자 내부 수신 시뮬레이터'}},phone:{configured:Boolean(process.env.TWILIO_ACCOUNT_SID&&process.env.TWILIO_AUTH_TOKEN&&process.env.TWILIO_FROM)},model:{configured:Boolean(process.env.ORBIT_LLM_BASE_URL&&process.env.ORBIT_LLM_MODEL),name:process.env.ORBIT_LLM_MODEL||''},casesAvailable};}
export async function getThread(threadId){const d=await read();return d.threads.find(t=>t.id===threadId)||null;}
export async function getTask(taskId){const d=await read();return d.tasks.find(t=>t.id===taskId)||null;}
export async function updateSettings(patch){return modify(d=>{if(typeof patch.autoDraft==='boolean')d.settings.autoDraft=patch.autoDraft;if(typeof patch.autoSend==='boolean')d.settings.autoSend=patch.autoSend;log(d,'config','자동화 설정 변경');return d.settings;});}
function isActionRequired(task){return task.kind==='action';}
export async function generateDraft(taskId){if(processing.has(taskId))return;processing.add(taskId);
 try {
  const task=await getTask(taskId);if(!task)throw new Error('작업 없음');
  const thread=await getThread(task.threadId);if(!thread)throw new Error('대화 없음');
  const base=(process.env.ORBIT_LLM_BASE_URL||'').replace(/\/+$/,'');const model=process.env.ORBIT_LLM_MODEL;
  if(!base||!model){await modify(d=>{const t=d.tasks.find(x=>x.id===taskId);if(t){t.status='model_unconfigured';t.updatedAt=now();}});return;}
  await modify(d=>{const t=d.tasks.find(x=>x.id===taskId);if(t){t.status='drafting';t.updatedAt=now();}});
  const history=thread.messages.slice(-12).map(m=>({role:m.direction==='in'?'user':'assistant',content:m.text}));
  const system=`당신은 Orbit 개인 비서입니다. 한국어로 자연스럽게 1~3문장으로 답변하세요. 사용자의 실제 이익을 우선합니다. 실제로 실행한 적 없는 전화/예약/구매/해지/파일조작은 완료했다고 말하지 마세요. 사용자가 행동을 요청하면 요청 내용과 조건을 정확히 이해한 뒤, 도구가 연결되어야 실제 처리 가능하다고 간결하게 알리세요. 비용·계약·결제는 임의로 수락하지 마세요. 추론이 아닌 실행 결과를 꾸며내지 마세요.`;
  const endpoint=`${base}/chat/completions`;const headers={'Content-Type':'application/json'};
  if(process.env.ORBIT_LLM_API_KEY)headers.Authorization=`Bearer ${process.env.ORBIT_LLM_API_KEY}`;
  const response=await fetch(endpoint,{method:'POST',headers,body:JSON.stringify({model,messages:[{role:'system',content:system},...history],temperature:0.3,max_tokens:500,stream:false}),signal:AbortSignal.timeout(65000)});
  if(!response.ok)throw new Error(`모델 API ${response.status}`);
  const json=await response.json();const draft=textLimit(json.choices?.[0]?.message?.content,1500);
  if(!draft)throw new Error('모델 응답이 비어 있습니다.');
  await modify(d=>{const t=d.tasks.find(x=>x.id===taskId);if(t){t.draft=draft;t.status='draft_ready';t.updatedAt=now();log(d,'draft',`답변 초안 생성 · ${t.title}`);}});
  const d=await read();if(d.settings.autoSend&&!isActionRequired(task)&&thread.channel==='whatsapp')await sendReply({threadId:thread.id,text:draft,taskId,approved:false});
 }catch(e){await modify(d=>{const t=d.tasks.find(x=>x.id===taskId);if(t){t.status='failed';t.error=String(e.message).slice(0,250);t.updatedAt=now();log(d,'error',t.error);}});}finally{processing.delete(taskId);}
}
export async function setTaskStatus(id,status,error=''){return modify(d=>{const t=d.tasks.find(x=>x.id===id);if(!t)throw new Error('업무 없음');t.status=status;t.updatedAt=now();if(error)t.error=String(error).slice(0,250);log(d,'task',status+' · '+t.title);return t;});}
export async function updateTask({id,status}){if(!['dismissed','awaiting_operator','completed'].includes(status))throw new Error('잘못된 상태');return modify(d=>{const t=d.tasks.find(x=>x.id===id);if(!t)throw new Error('업무 없음');t.status=status;t.updatedAt=now();log(d,'task',`${status} · ${t.title}`);return t;});}
export async function sendWhatsApp(recipient,body){const token=process.env.WA_ACCESS_TOKEN,numberId=process.env.WA_PHONE_NUMBER_ID,version=process.env.WA_GRAPH_VERSION||'v26.0';if(!token||!numberId)throw new Error('WhatsApp 통신 계정 연결이 필요합니다.');const response=await fetch(`https://graph.facebook.com/${encodeURIComponent(version)}/${encodeURIComponent(numberId)}/messages`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({messaging_product:'whatsapp',to:recipient,type:'text',text:{body}}),signal:AbortSignal.timeout(15000)});const r=await response.json().catch(()=>({}));if(!response.ok)throw new Error(`WhatsApp 전송 실패 (${response.status}): ${textLimit(r.error?.message||'API 오류',180)}`);return r.messages?.[0]?.id||null;}
export async function sendReply({threadId,text,taskId=null,approved=true}){
 const content=textLimit(text,1600);if(!content)throw new Error('답변 내용이 비어 있습니다.');
 const thread=await getThread(threadId);if(!thread)throw new Error('대화를 찾지 못했습니다.');
 if(thread.channel==='imessage')throw new Error('iMessage 발신 연결이 아직 없습니다.');
 let externalId=null;if(thread.channel==='whatsapp')externalId=await sendWhatsApp(thread.sender,content);
 return modify(d=>{const t=d.threads.find(x=>x.id===threadId);t.messages.push({id:randomUUID(),externalId,direction:'out',text:content,time:now(),status:thread.channel==='test'?'simulated':'sent'});t.messages=t.messages.slice(-120);t.updatedAt=now();const task=d.tasks.find(x=>x.id===taskId);if(task){task.status='sent';task.updatedAt=now();}log(d,'sent',`${thread.channel} · ${approved?'관리자 발신':'자동 답장'} · ${content.slice(0,65)}`);return {ok:true,externalId};});
}
export function verifyWhatsApp(body,header){const secret=process.env.WA_APP_SECRET;if(!secret||!header)return false;const expected='sha256='+createHmac('sha256',secret).update(body).digest('hex');const a=Buffer.from(expected);const b=Buffer.from(String(header));return a.length===b.length&&timingSafeEqual(a,b);}
export function whatsappChallenge(search){const verify=process.env.WA_VERIFY_TOKEN;if(!verify||search.get('hub.mode')!=='subscribe'||search.get('hub.verify_token')!==verify)return null;return search.get('hub.challenge')||'';}
export function parseWhatsApp(payload){const out=[];for(const entry of payload.entry||[])for(const change of entry.changes||[]){if(change.field!=='messages')continue;for(const message of change.value?.messages||[]){if(message.type==='text'&&message.text?.body)out.push({channel:'whatsapp',sender:message.from,text:message.text.body,messageId:message.id});}}return out;}
