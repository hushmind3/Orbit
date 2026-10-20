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
test.after(async()=>{await fs.rm(dir,{recursive:true,force:true});});
