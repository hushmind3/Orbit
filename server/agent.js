import { randomUUID } from 'node:crypto';
import {definitions, permissionRequired, runTool, toolMap} from './tools.js';
import {store} from './store.js';

const SYSTEM = `당신은 Windows 컴퓨터에서 실제로 도구를 실행하는 개인 AI 비서 Orbit입니다.
한국어 존댓말로 짧고 자연스럽게 대답합니다. 사용자는 명령 실행과 결과를 원합니다.
명령이 필요하면 도구를 사용하고, 직접 실행하지 않은 일은 했다고 말하지 마세요.
사이트를 읽은 뒤 클릭/입력이 필요하면 browser_read로 내용을 먼저 확인하세요.
결제·개인정보 전송·메시지 발송은 구현되지 않았으므로 성공한 것처럼 말하지 마세요.
위험한 도구는 사용자가 화면에서 승인하거나 거부합니다. 승인을 건너뛰려 하지 마세요.
명시적 메모 요청일 때만 remember를 사용합니다. 실행 결과는 요약해서 보고하세요.`;

const approvalCallbacks = new Map();
export function approve(id,answer) {const entry=approvalCallbacks.get(id);if(!entry)return false;approvalCallbacks.delete(id);entry(Boolean(answer));return true;}
export function pendingCount() {return approvalCallbacks.size;}
async function requestApproval(tool,args,emit) {
  const id=randomUUID();
  const result = new Promise(resolve => {
    approvalCallbacks.set(id,resolve);
    setTimeout(()=>{if(approvalCallbacks.has(id)){approvalCallbacks.delete(id);resolve(false);}},120000).unref();
  });
  emit({type:'approval',id,tool,args});
  return result;
}
function normalizeToolCalls(message, provider) {
  return (message.tool_calls || []).map((call,index)=>{
    let args=call.function?.arguments || {};
    if (typeof args==='string') {try {args=JSON.parse(args);}catch{args={};}}
    return { id:call.id||`step_${index}`,name:call.function?.name,args };
  });
}

async function askModel(config,messages) {
  const urlBase=String(config?.base || '').replace(/\/+$/,'');
  const model=String(config?.model||'').trim();
  if (!model || model.length>120) throw new Error('모델 이름을 설정하세요.');
  if (!urlBase || !/^https?:\/\//.test(urlBase)) throw new Error('API 주소를 설정하세요.');
  const provider=config.provider==='openai'?'openai':'ollama';
  const endpoint=provider==='ollama' ? `${urlBase}/api/chat` : `${urlBase}/chat/completions`;
  const body=provider==='ollama'
    ? {model,messages,tools:definitions.map(d=>({type:'function',function:d})),stream:false,options:{temperature:0.2}}
    : {model,messages,tools:definitions.map(d=>({type:'function',function:d})),tool_choice:'auto',stream:false,temperature:0.2};
  const headers={'Content-Type':'application/json'};
  if (provider==='openai' && config.key) headers.Authorization=`Bearer ${String(config.key).slice(0,400)}`;
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),180000);
  let response;
  try { response=await fetch(endpoint,{method:'POST',headers,body:JSON.stringify(body),signal:controller.signal}); }
  catch(e) { throw new Error(`AI 서버에 연결할 수 없습니다 (${e.message}). Ollama가 실행 중인지, API 주소가 맞는지 확인하세요.`); }
  finally {clearTimeout(timeout);}
  const json=await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(`AI 서버 응답 ${response.status}: ${JSON.stringify(json).slice(0,550)}`);
  const message=provider==='ollama' ? json.message : json.choices?.[0]?.message;
  if(!message) throw new Error('AI 서버 응답에 메시지가 없습니다.');
  return {provider,message};
}

// One message at a time to keep the LLM dialogue, approvals and browser state consistent.
let busy=false;
export function isBusy(){return busy;}
export async function runAgent({text,config,emit}) {
  if (busy) throw new Error('이전 작업이 아직 진행 중입니다.');
  if (typeof text!=='string'||!text.trim()||text.length>5000) throw new Error('1~5,000자 이내 명령을 입력하세요.');
  busy=true;
  try {
    await store.push('user',text.trim());
    const notes=await store.notes();
    const history=(await store.history()).slice(-26).map(x=>({role:x.role,content:x.content}));
    const memory=notes.length?'\n기억: '+notes.map(x=>x.note).join(' | ').slice(0,4000):'';
    let messages=[{role:'system',content:SYSTEM+memory},...history];
    for (let round=0;round<8;round++) {
      emit({type:'status',text:`AI 판단 중 · ${round+1}/8`});
      const {provider,message}=await askModel(config,messages);
      const calls=normalizeToolCalls(message,provider);
      if (!calls.length) {
        const answer=typeof message.content==='string'?message.content.trim():'';
        const content=answer||'작업을 마쳤습니다.';
        await store.push('assistant',content);
        emit({type:'answer',text:content});
        emit({type:'done'});return;
      }
      if (provider==='openai') messages.push({role:'assistant',content:message.content||'',tool_calls:message.tool_calls});
      else messages.push({role:'assistant',content:message.content||'',tool_calls:message.tool_calls});
      for (const call of calls.slice(0,5)) {
        const valid=toolMap[call.name];let outcome;
        if (!valid) outcome='지원하지 않는 도구입니다.';
        else {
          emit({type:'status',text:`도구: ${call.name}`,args:call.args});
          if (permissionRequired.has(call.name)) {
            const allowed=await requestApproval(call.name,call.args,emit);
            if (!allowed) outcome='사용자가 실행을 거부했거나 2분 안에 승인하지 않았습니다.';
          }
          if (outcome===undefined) {
            try { outcome=await runTool(call.name,call.args,{store}); }
            catch(e) {outcome=`오류: ${e.message}`;}
          }
        }
        const result=String(outcome).slice(0,18000);
        emit({type:'tool_result',tool:call.name,result:result.slice(0,800)});
        if(provider==='openai') messages.push({role:'tool',tool_call_id:call.id,content:result});
        else messages.push({role:'tool',tool_name:call.name,content:result});
      }
    }
    const answer='도구 실행 8회차에 도달했습니다. 여기까지 진행한 내역을 확인해 주세요.';
    await store.push('assistant',answer);emit({type:'answer',text:answer});emit({type:'done'});
  } finally { busy=false; }
}
