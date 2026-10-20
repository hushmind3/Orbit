import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {newCase,recordTurn} from '../server/negotiation.js';import {trackCall,notifyCallCompletion} from '../server/call-notifier.js';
process.env.ORBIT_CALL_NOTIFICATIONS_PATH=path.join(os.tmpdir(),'orbit-call-notifier-'+process.pid+'.json');
process.env.WA_ACCESS_TOKEN='TEST-ONLY';process.env.WA_PHONE_NUMBER_ID='999';
test('call status notifies owner with actual observed transcript, only once',async()=>{
 const original=globalThis.fetch;let bodies=[];globalThis.fetch=async(url,opts)=>{if(String(url).includes('/messages')){bodies.push(JSON.parse(opts.body));return {ok:true,json:async()=>({messages:[{id:'msg-123'}]})};}return original(url,opts);};
 try{const c=await newCase({name:'고객센터 테스트',goal:'해지',limits:'새 약정 금지'});await recordTurn(c.id,'customer','위약금은 18만 원입니다.');await trackCall(c.id,'821012345678');assert.equal(await notifyCallCompletion(c.id,'ringing'),false);assert.equal(await notifyCallCompletion(c.id,'completed'),true);assert.equal(bodies.length,1);assert.match(bodies[0].text.body,/위약금은 18만 원/);assert.equal(await notifyCallCompletion(c.id,'completed'),false);}finally{globalThis.fetch=original;await fs.rm(process.env.ORBIT_CALL_NOTIFICATIONS_PATH,{force:true});}
});
