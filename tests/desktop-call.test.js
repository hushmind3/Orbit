import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {createServer} from 'node:http';
import {saveConfig} from '../server/config.js';import {runLocalOperator,LOCAL_SENDER} from '../server/operator.js';
import {callNotificationStatus,queueCallCompletion,flushCallNotifications} from '../server/call-notifier.js';import {getDashboard,getThread} from '../server/inbox.js';
const dir=path.join(os.tmpdir(),'orbit-desktop-phone-'+process.pid);
for(const [k,v] of Object.entries({ORBIT_CONFIG_PATH:'config.json',ORBIT_INBOX_PATH:'inbox.json',ORBIT_APPROVALS_PATH:'approvals.json',ORBIT_WORK_LEDGER_PATH:'work',ORBIT_CALL_NOTIFICATIONS_PATH:'notifications.json',ORBIT_CASES_PATH:'cases.json',ORBIT_CALL_SESSIONS_PATH:'sessions.json',ORBIT_STORE_PATH:'store.json'}))process.env[k]=path.join(dir,v);
process.env.TWILIO_ACCOUNT_SID='AC'+'1'.repeat(32);process.env.TWILIO_AUTH_TOKEN='fake';process.env.TWILIO_FROM='+15551112222';process.env.ORBIT_PUBLIC_URL='https://orbit.example.test';process.env.WA_ACCESS_TOKEN='test';process.env.WA_PHONE_NUMBER_ID='123';
let calls=0;const model=createServer(async(req,res)=>{let text='';for await(const c of req)text+=c;const data=JSON.parse(text);res.setHeader('Content-Type','application/json');
 if(data.messages[0].content.includes('ORBIT_GOAL_AUDIT')){res.end(JSON.stringify({choices:[{message:{content:'{"verified":false,"reason":"call started only"}'}}]}));return;}
 calls++;const action=calls===1?{name:'start_customer_service_call',arguments:JSON.stringify({number:'+821012345678',name:'센터',goal:'해지',facts:'',limits:'새 약정 금지'})}:{name:'finish_task',arguments:JSON.stringify({status:'partial',summary:'전화 발신만 접수됐습니다.'})};
 res.end(JSON.stringify({choices:[{message:{tool_calls:[{id:'id'+calls,type:'function',function:action}]}}]}));
});
test('PC-originated calls preserve real owner destination before outbound request and report to both channels',async()=>{
 await fs.mkdir(dir,{recursive:true});await new Promise(r=>model.listen(0,'127.0.0.1',r));const original=globalThis.fetch,wa=[];
 globalThis.fetch=async(url,opts)=>{if(String(url).includes('/Calls.json')){const x=JSON.parse(await fs.readFile(process.env.ORBIT_CALL_NOTIFICATIONS_PATH));assert.equal(x.length,1);assert.equal(x[0].recipient,'821011119999');return {ok:true,json:async()=>({sid:'CAabc',status:'queued'})};}
  if(String(url).includes('/messages')){wa.push(JSON.parse(opts.body));return {ok:true,json:async()=>({messages:[{id:'wamid'}]})};}return original(url,opts);};
 try{await saveConfig({provider:'openai',base:'http://127.0.0.1:'+model.address().port,model:'mock',owner:'821011119999'});
  const result=await runLocalOperator({text:'고객센터 전화해 줘'});assert.equal(result.status,'partial');
  const x=JSON.parse(await fs.readFile(process.env.ORBIT_CALL_NOTIFICATIONS_PATH))[0];assert.ok(x.threadId);
  await queueCallCompletion(x.caseId,'completed');assert.equal(await flushCallNotifications(),1);
  assert.equal(wa.length,1);assert.equal(wa[0].to,'821011119999');assert.equal((await callNotificationStatus(x.caseId)).notified,true);
  const state=await getDashboard(),thread=await getThread(state.threads.find(t=>t.sender===LOCAL_SENDER).id);assert.match(thread.messages.at(-1).text,/AI 전화 종료/);
 }finally{globalThis.fetch=original;await new Promise(r=>model.close(r));await fs.rm(dir,{recursive:true,force:true});}
});
