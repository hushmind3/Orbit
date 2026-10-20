import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createJoinSession,sessionStatus,consumeJoinMessage,startSms,checkSms} from '../server/onboarding.js';

const file=path.join(os.tmpdir(),'orbit-sms-'+process.pid+'.json');
process.env.ORBIT_ONBOARDING_PATH=file;
process.env.WA_BUSINESS_NUMBER='15551234567';process.env.WA_ACCESS_TOKEN='test';process.env.WA_APP_SECRET='test';process.env.WA_VERIFY_TOKEN='test';process.env.WA_PHONE_NUMBER_ID='123';
process.env.TWILIO_VERIFY_SERVICE_SID='VA'+'a'.repeat(32);process.env.TWILIO_ACCOUNT_SID='AC'+'b'.repeat(32);process.env.TWILIO_AUTH_TOKEN='test_token';
const original=globalThis.fetch;let requests=[];
globalThis.fetch=async(url,opt)=>{if(String(url).startsWith('https://verify.twilio.com/')){requests.push({url,params:Object.fromEntries(new URLSearchParams(opt.body))});return {ok:true,json:async()=>({status:url.endsWith('VerificationCheck')?(new URLSearchParams(opt.body)).get('Code')==='555555'?'approved':'pending':'pending'})};}return original(url,opt);};
test('real SMS provider step gates QR and requires matching WhatsApp sender',async()=>{
 try{
  await assert.rejects(createJoinSession({phone:'01012345678'}),/전화번호/);
  const s=await createJoinSession({phone:'+821012345678'});assert.equal(s.status,'awaiting_sms');assert.equal(s.link,null);
  await assert.rejects(startSms('bad'),/세션/);
  await startSms(s.id);assert.equal(requests[0].params.To,'+821012345678');assert.equal(requests[0].params.Channel,'sms');
  await assert.rejects(startSms(s.id),/45초/);
  assert.equal((await checkSms(s.id,'123456')).ok,false);
  const v=await checkSms(s.id,'555555');assert.equal(v.ok,true);assert.ok(v.link.startsWith('https://wa.me/'));
  const code=new URL(v.link).searchParams.get('text');
  const wrong=await consumeJoinMessage({from:'821099999999',text:code,messageId:'wrong'});assert.equal(wrong.ok,false);
  const right=await consumeJoinMessage({from:'821012345678',text:code,messageId:'right'});assert.equal(right.ok,true);
  assert.equal((await sessionStatus(s.id)).verified,true);
 }finally{globalThis.fetch=original;await fs.rm(file,{force:true});}
});
