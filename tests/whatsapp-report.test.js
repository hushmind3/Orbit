import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createServer} from 'node:http';
import {saveConfig} from '../server/config.js';
import {createJoinSession,consumeJoinMessage} from '../server/onboarding.js';
import {receiveMessage,getTask} from '../server/inbox.js';
import {processInboundTask} from '../server/operator.js';
const root=path.join(os.tmpdir(),`orbit-whatsapp-report-${process.pid}`);
process.env.ORBIT_CONFIG_PATH=path.join(root,'config.json');
process.env.ORBIT_INBOX_PATH=path.join(root,'inbox.json');
process.env.ORBIT_ONBOARDING_PATH=path.join(root,'join.json');
process.env.ORBIT_WORK_LEDGER_PATH=path.join(root,'jobs');
process.env.ORBIT_STORE_PATH=path.join(root,'store');
process.env.WA_BUSINESS_NUMBER='15551239999';
process.env.WA_PHONE_NUMBER_ID='12345';
process.env.WA_ACCESS_TOKEN='mock-meta-token';
process.env.WA_APP_SECRET='mock-app-secret';
process.env.WA_VERIFY_TOKEN='mock-challenge';
process.env.ORBIT_REQUIRE_SMS='0';
const owner='821077778888';
let callNumber=0;
const model=createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;const data=JSON.parse(raw);
 if(data.messages?.[0]?.content?.includes('# ORBIT_GOAL_AUDIT')){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({verified:true,reason:'메모 저장 결과를 확인'})}}]}));return;}
 callNumber++;
 const answer=callNumber===1?{tool_calls:[{id:'step-one',function:{name:'remember',arguments:JSON.stringify({note:'통화 고객센터 메모'})}}]}:
 {tool_calls:[{id:'step-two',function:{name:'finish_task',arguments:JSON.stringify({status:'completed',summary:'요청하신 메모를 보관했습니다.'})}}]};
 res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{message:answer}]}));
});
test('real WhatsApp channel sends action report containing actual tool evidence',async()=>{
 await fs.mkdir(root,{recursive:true});await new Promise(r=>model.listen(0,'127.0.0.1',r));
 const orig=globalThis.fetch,sent=[];
 globalThis.fetch=async(url,opts)=>{
  if(String(url).startsWith('https://graph.facebook.com/')){const b=JSON.parse(opts.body);sent.push(b);return {ok:true,json:async()=>({messages:[{id:'wamid.test'}]})};}
  return orig(url,opts);
 };
 try{
  await saveConfig({provider:'openai',base:`http://127.0.0.1:${model.address().port}`,model:'fake',owner,approvalMode:'autonomous'});
  const s=await createJoinSession({phone:'+8277778888'});assert.equal(s.status,'awaiting_whatsapp');
  const code=new URL(s.link).searchParams.get('text');
  const joined=await consumeJoinMessage({from:owner,text:code,messageId:'join_1'});
  assert.equal(joined.ok,true);
  const req=await receiveMessage({channel:'whatsapp',sender:owner,text:'새 메모를 작성한 뒤 결과를 보고해 줘',messageId:'task_1'});
  const r=await processInboundTask(req.taskId);assert.equal(r.status,'completed');
  assert.equal((await getTask(req.taskId)).status,'completed');
  assert.equal(sent.length,1);
  assert.equal(sent[0].to,owner);
  assert.match(sent[0].text.body,/Orbit 업무 보고/);
  assert.match(sent[0].text.body,/remember/);
  assert.match(sent[0].text.body,/성공 1건/);
 }finally{globalThis.fetch=orig;await new Promise(r=>model.close(r));await fs.rm(root,{recursive:true,force:true});}
});
