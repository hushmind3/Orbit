import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createServer} from 'node:http';
import {createHmac} from 'node:crypto';
import {newCase,startCall,twilioTurn,twilioStatus,findCase,validateWebhook} from '../server/negotiation.js';
const base=path.join(os.tmpdir(),'orbit-phone-outcome-'+process.pid);
process.env.ORBIT_CASES_PATH=base+'.cases';
process.env.ORBIT_CALL_SESSIONS_PATH=base+'.sessions';
process.env.TWILIO_ACCOUNT_SID='AC'+'z'.repeat(32);
process.env.TWILIO_AUTH_TOKEN='test';
process.env.TWILIO_FROM='+15551230000';
process.env.ORBIT_PUBLIC_URL='https://orbit.example.test';
const model=createServer(async(req,res)=>{
 res.setHeader('Content-Type','application/json');
 res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({say:'감사합니다.',reason:'종료',flag:'finish',digits:''})}}]}));
});
test('Twilio delayed and repeated signed callbacks work after AI finishes; phone ending is not negotiation success',async()=>{
 await new Promise(r=>model.listen(0,'127.0.0.1',r));
 let callback='';
 const original=globalThis.fetch;
 globalThis.fetch=async(url,opts)=>{
  if(String(url).includes('/Calls.json')){callback=new URLSearchParams(opts.body).get('StatusCallback');return {ok:true,json:async()=>({sid:'CAabc',status:'queued'})};}
  return original(url,opts);
 };
 try{
  const opts={provider:'openai',base:'http://127.0.0.1:'+model.address().port,model:'mock'};
  const finished=await newCase({name:'해지 시도',goal:'위약금 없이 해지',limits:'새 약정 금지'});
  await startCall(finished.id,'+821012345678',opts);
  await twilioTurn({id:finished.id,form:{}});
  await twilioTurn({id:finished.id,form:{SpeechResult:'통화는 여기서 마칩니다.'}});
  assert.equal((await findCase(finished.id)).status,'outcome-unverified');
  const url=new URL(callback),form={CallStatus:'completed',CallSid:'CAabc'};
  const signature=createHmac('sha1',process.env.TWILIO_AUTH_TOKEN).update(callback+Object.keys(form).sort().map(k=>k+form[k]).join('')).digest('base64');
  const signed=()=>validateWebhook({id:finished.id,token:url.searchParams.get('token'),url:callback,form,signature});
  assert.equal(signed(),true);
  await twilioStatus(finished.id,form);
  assert.equal((await findCase(finished.id)).status,'outcome-unverified');
  assert.equal(signed(),true);
  const noOutcome=await newCase({name:'연결만 된 전화',goal:'환불 받기',limits:'새 결제 금지'});
  await startCall(noOutcome.id,'+821012345678',opts);
  await twilioStatus(noOutcome.id,{CallStatus:'completed'});
  assert.equal((await findCase(noOutcome.id)).status,'call-ended-unverified');
 }finally{
  globalThis.fetch=original;
  await new Promise(r=>model.close(r));
  await fs.rm(base+'.cases',{force:true});await fs.rm(base+'.sessions',{force:true});
 }
});
