/** Operator-only tests: real API authorization checks, but no calls, SMS, or paid work. */
import {loadConfig} from './config.js';
const attempt=async(name,configured,fn)=>{
 if(!configured)return {name,status:'missing',detail:'연결 정보 없음'};
 try{return {name,status:'verified',detail:await fn()};}
 catch(e){return {name,status:'failed',detail:String(e.message).slice(0,320)};}
};
async function reqJSON(url,opts){const r=await fetch(url,{...opts,signal:AbortSignal.timeout(9000)});const j=await r.json().catch(()=>({}));if(!r.ok)throw Error(`HTTP ${r.status}: ${String(j.error?.message||j.message||'연결 실패').slice(0,160)}`);return j;}
export async function checkConnections(){
 const wa=process.env.WA_ACCESS_TOKEN,waID=process.env.WA_PHONE_NUMBER_ID;
 const sid=process.env.TWILIO_ACCOUNT_SID,token=process.env.TWILIO_AUTH_TOKEN;
 const version=process.env.WA_GRAPH_VERSION||'v26.0';
 const c=await loadConfig();
 const results=await Promise.all([
  attempt('WhatsApp Meta 번호',Boolean(wa&&waID),async()=>{const j=await reqJSON(`https://graph.facebook.com/${encodeURIComponent(version)}/${encodeURIComponent(waID)}?fields=display_phone_number,verified_name`,{headers:{Authorization:'Bearer '+wa}});return `${j.display_phone_number||'번호 정보 없음'} · ${j.verified_name||'인증 이름 정보 없음'}`;}),
  attempt('Twilio 계정',Boolean(sid&&token),async()=>{const j=await reqJSON(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}.json`,{headers:{Authorization:'Basic '+Buffer.from(sid+':'+token).toString('base64')}});return `${j.friendly_name||sid} (${j.status||'unknown'})`;}),
  attempt('Twilio SMS Verify',Boolean(sid&&token&&process.env.TWILIO_VERIFY_SERVICE_SID),async()=>{const svc=process.env.TWILIO_VERIFY_SERVICE_SID;const j=await reqJSON(`https://verify.twilio.com/v2/Services/${encodeURIComponent(svc)}`,{headers:{Authorization:'Basic '+Buffer.from(sid+':'+token).toString('base64')}});return j.friendly_name||svc;}),
  attempt('범용 AI 모델',Boolean(c.model&&c.base),async()=>{const openai=c.provider!=='ollama';const body=openai?{model:c.model,messages:[{role:'user',content:'한 단어로 확인이라고 답하세요.'}],max_tokens:28,stream:false}:{model:c.model,messages:[{role:'user',content:'한 단어로 확인이라고 답하세요.'}],stream:false};const headers={'Content-Type':'application/json'};if(c.key)headers.Authorization='Bearer '+c.key;const j=await reqJSON(c.base.replace(/\/$/,'')+(openai?'/chat/completions':'/api/chat'),{method:'POST',headers,body:JSON.stringify(body)});if(!(openai?j.choices?.[0]?.message:j.message))throw Error('모델 응답 구조가 호환되지 않습니다.');return `모델 응답 성공 · ${c.model}`;})
 ]);
 return {checkedAt:new Date().toISOString(),checks:results,publicUrl:Boolean(/^https:\/\/[^/]+/.test(process.env.ORBIT_PUBLIC_URL||'')),webhookNote:'Meta 개발자 콘솔의 웹훅 messages 구독·외부 HTTPS 실제 수신은 가입 메시지를 보내 직접 확인해야 합니다.',outboundCallingVerified:false};
}
