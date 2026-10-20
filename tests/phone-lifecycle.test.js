import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {createServer} from 'node:http';
import {newCase,startCall,twilioTurn,findCase,twilioStatus} from '../server/negotiation.js';
const tmp=path.join(os.tmpdir(),'orbit-phone-check-'+process.pid);
process.env.ORBIT_CALL_SESSIONS_PATH=tmp+'.sessions';process.env.ORBIT_CASES_PATH=tmp+'.cases';
process.env.TWILIO_ACCOUNT_SID='AC'+'x'.repeat(32);process.env.TWILIO_AUTH_TOKEN='test';process.env.TWILIO_FROM='+15551230000';process.env.ORBIT_PUBLIC_URL='https://orbit.example.test';
let model=createServer(async(req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({say:'해지 위약금 계산 근거를 알려주시겠습니까?',reason:'근거 확인',flag:'normal',digits:''})}}]}));});
test('Twilio flow listens first, waits silently, negotiates, persists recorded turns',async()=>{
 await new Promise(r=>model.listen(0,'127.0.0.1',r));const old=globalThis.fetch;
 globalThis.fetch=async(url,opts)=>{if(String(url).includes('/Calls.json'))return {ok:true,json:async()=>({sid:'CA123',status:'queued'})};return old(url,opts);};
 try{
  const c=await newCase({name:'해지 부서',goal:'불필요한 위약금 없이 해지',limits:'새 약정 금지'});
  const result=await startCall(c.id,'+821012345678',{provider:'openai',base:`http://127.0.0.1:${model.address().port}`,model:'fake',key:''});assert.equal(result.sid,'CA123');
  const beginning=await twilioTurn({id:c.id,form:{}});assert.match(beginning,/<Gather/);assert.doesNotMatch(beginning,/<Say/);
  const hold=await twilioTurn({id:c.id,form:{SpeechResult:'모든 상담원이 통화 중이니 잠시만 기다려 주세요.'}});assert.match(hold,/<Gather/);assert.doesNotMatch(hold,/<Say/);
  const silence=await twilioTurn({id:c.id,form:{}});assert.doesNotMatch(silence,/<Say/);
  const negotiate=await twilioTurn({id:c.id,form:{SpeechResult:'위약금은 18만 원이며 6개월 유지 시 할인 가능합니다.'}});assert.match(negotiate,/위약금 계산 근거/);
  const info=await findCase(c.id);assert.ok(info.turns.some(x=>x.flag==='hold'));assert.ok(info.turns.some(x=>/18만 원/.test(x.content)));
  await twilioStatus(c.id,{CallStatus:'completed'});
 }finally{globalThis.fetch=old;await new Promise(r=>model.close(r));await fs.rm(tmp+'.sessions',{force:true});await fs.rm(tmp+'.cases',{force:true});}
});

test('early Twilio terminal callback is not overwritten by delayed outbound REST response',async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async(url,opts)=>{
  if(String(url).includes('/Calls.json')){
   const callback=new URLSearchParams(opts.body).get('StatusCallback');
   const c=callback.match(/status\/([0-9a-f-]{36})/);assert.ok(c);
   await twilioStatus(c[1],{CallStatus:'completed'});
   return {ok:true,json:async()=>({sid:'CAfast',status:'queued'})};
  }return original(url,opts);
 };
 try{
  const c=await newCase({name:'선도착 확인',goal:'전화 문의',limits:'없음'});
  await startCall(c.id,'+821011112222',{provider:'openai',base:'http://127.0.0.1:12345',model:'mock'});
  assert.equal((await findCase(c.id)).status,'call-ended-unverified');
 }finally{globalThis.fetch=original;await fs.rm(tmp+'.sessions',{force:true});await fs.rm(tmp+'.cases',{force:true});}
});
