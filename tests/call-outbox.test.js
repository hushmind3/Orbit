import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {newCase,recordTurn} from '../server/negotiation.js';
import {trackCall,untrackCall,queueCallCompletion,deliverCallNotification,flushCallNotifications,callNotificationStatus} from '../server/call-notifier.js';
import {receiveMessage,getThread} from '../server/inbox.js';
const dir=path.join(os.tmpdir(),'orbit-outbox-v2-'+process.pid);
process.env.ORBIT_CALL_NOTIFICATIONS_PATH=path.join(dir,'outbox.json');process.env.ORBIT_INBOX_PATH=path.join(dir,'inbox.json');process.env.ORBIT_CASES_PATH=path.join(dir,'cases.json');
process.env.WA_PHONE_NUMBER_ID='1234';process.env.WA_ACCESS_TOKEN='stub';
test('Meta failure persists notification for retry after restart; duplicate callback sends once',async()=>{
 await fs.mkdir(dir,{recursive:true});const old=globalThis.fetch;let attempts=0,sends=[];
 globalThis.fetch=async(url,opts)=>{if(String(url).includes('/messages')){attempts++;if(attempts===1)return {ok:false,status:503,json:async()=>({error:{message:'temporary outage'}})};sends.push(JSON.parse(opts.body));return {ok:true,json:async()=>({messages:[{id:'wamid123'}]})};}return old(url,opts);};
 try{const c=await newCase({name:'해지',goal:'해지',limits:'새 약정 없음'});await recordTurn(c.id,'customer','환불 부서에서 확인합니다.');
  await trackCall(c.id,'821011112222');assert.equal(await queueCallCompletion(c.id,'ringing'),false);assert.equal(await queueCallCompletion(c.id,'completed'),true);
  assert.equal(await deliverCallNotification(c.id),false);assert.equal((await callNotificationStatus(c.id)).notified,false);
  const rows=JSON.parse(await fs.readFile(process.env.ORBIT_CALL_NOTIFICATIONS_PATH));assert.equal(rows[0].terminalStatus,'completed');rows[0].nextAttemptAt=0;await fs.writeFile(process.env.ORBIT_CALL_NOTIFICATIONS_PATH,JSON.stringify(rows));
  assert.equal(await flushCallNotifications(),1);assert.equal((await callNotificationStatus(c.id)).notified,true);
  await queueCallCompletion(c.id,'completed');assert.equal(await flushCallNotifications(),0);assert.equal(sends.length,1);assert.equal(sends[0].to,'821011112222');
 }finally{globalThis.fetch=old;}
});
test('terminal callback can precede REST completion without losing recipient',async()=>{
 const c=await newCase({name:'선도착',goal:'확인',limits:'없음'});await trackCall(c.id,'821022223333');
 await queueCallCompletion(c.id,'completed');assert.equal(await untrackCall(c.id),false);assert.equal((await callNotificationStatus(c.id)).terminalStatus,'completed');
});
test('local desktop call can be reported without fake WhatsApp number',async()=>{
 const t=await receiveMessage({channel:'test',sender:'999999999999999',text:'내 컴퓨터에서 전화'});const c=await newCase({name:'PC',goal:'해지',limits:'없음'});
 await trackCall(c.id,{recipient:null,threadId:t.threadId});await queueCallCompletion(c.id,'completed');assert.equal(await deliverCallNotification(c.id),true);
 assert.match((await getThread(t.threadId)).messages.at(-1).text,/AI 전화 종료/);assert.equal((await callNotificationStatus(c.id)).notified,true);
});
test('Meta outage cannot block PC result; successful PC channel is never duplicated on retry',async()=>{
 const t=await receiveMessage({channel:'test',sender:'pc-owner',text:'전화 걸고 결과 알려줘'});
 const c=await newCase({name:'채널 독립',goal:'확인',limits:'없음'});
 await trackCall(c.id,{recipient:'821011113333',threadId:t.threadId});
 await queueCallCompletion(c.id,'completed');
 const original=globalThis.fetch;let release,requests=0;
 const delayed=new Promise(resolve=>{release=resolve;});
 globalThis.fetch=async(url,opts)=>{if(String(url).includes('/messages')){requests++;await delayed;return {ok:false,status:503,json:async()=>({error:{message:'Meta unavailable'}})};}return original(url,opts);};
 try{
  const sending=deliverCallNotification(c.id);
  let local=false;
  for(let i=0;i<70;i++){
   if((await getThread(t.threadId)).messages.some(m=>m.text.includes('AI 전화 종료'))){local=true;break;}
   await new Promise(resolve=>setTimeout(resolve,20));
  }
  assert.equal(local,true,'PC must receive its result before a stalled WhatsApp request settles');
  release();
  assert.equal(await sending,false);
  const partial=await callNotificationStatus(c.id);
  assert.equal(partial.deliveredWhatsApp,false);assert.equal(partial.deliveredLocal,true);
  assert.equal(partial.notified,false);assert.ok(partial.nextAttemptAt>Date.now());
  globalThis.fetch=async(url,opts)=>{if(String(url).includes('/messages')){requests++;return {ok:true,json:async()=>({messages:[{id:'wamid-retry'}]})};}return original(url,opts);};
  assert.equal(await deliverCallNotification(c.id,{force:true}),true);
  const messages=(await getThread(t.threadId)).messages.filter(m=>m.text.includes('AI 전화 종료'));
  assert.equal(messages.length,1,'successful PC notification must not be replayed');
  assert.equal(requests,2);assert.equal((await callNotificationStatus(c.id)).notified,true);
 }finally{release();globalThis.fetch=original;}
});
test('Broken PC conversation does not stop WhatsApp delivery or cause resend to WhatsApp',async()=>{
 const c=await newCase({name:'PC 오류',goal:'확인',limits:'없음'});
 await trackCall(c.id,{recipient:'821011114444',threadId:'missing-thread'});
 await queueCallCompletion(c.id,'failed');
 const original=globalThis.fetch;let sends=0;
 globalThis.fetch=async(url,opts)=>{if(String(url).includes('/messages')){sends++;return {ok:true,json:async()=>({messages:[{id:'wamid-pc-fail'}]})};}return original(url,opts);};
 try{
  assert.equal(await deliverCallNotification(c.id),false);
  let state=await callNotificationStatus(c.id);
  assert.equal(state.deliveredWhatsApp,true);assert.equal(state.deliveredLocal,false);assert.equal(state.notified,false);
  assert.equal(await deliverCallNotification(c.id,{force:true}),false);
  assert.equal(sends,1,'WhatsApp success must not be resent when PC channel fails');
 }finally{globalThis.fetch=original;}
});
test.after(async()=>{await fs.rm(dir,{recursive:true,force:true});});
