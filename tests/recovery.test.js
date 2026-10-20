import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createJoinSession,consumeJoinMessage} from '../server/onboarding.js';
import {saveConfig} from '../server/config.js';
import {receiveMessage,getTask,setTaskStatus,getThread} from '../server/inbox.js';
import {workEvent,getWork} from '../server/work-ledger.js';
import {recoverInterruptedTasks} from '../server/operator.js';

const root=path.join(os.tmpdir(),`orbit-recovery-${process.pid}`);
process.env.ORBIT_ONBOARDING_PATH=path.join(root,'join.json');
process.env.ORBIT_INBOX_PATH=path.join(root,'inbox.json');
process.env.ORBIT_CONFIG_PATH=path.join(root,'config.json');
process.env.ORBIT_WORK_LEDGER_PATH=path.join(root,'works');
process.env.ORBIT_MEMBERS_PATH=path.join(root,'members');
process.env.WA_BUSINESS_NUMBER='15551230001';
process.env.WA_PHONE_NUMBER_ID='98765';
process.env.WA_ACCESS_TOKEN='test-access-token';
process.env.WA_APP_SECRET='test-app-secret';
process.env.WA_VERIFY_TOKEN='test-verify';
process.env.ORBIT_REQUIRE_SMS='0';
let inputs=[];
const mock=createServer(async(req,res)=>{
 let body='';for await(const chunk of req)body+=chunk;
 const input=JSON.parse(body);inputs.push(input);
 res.writeHead(200,{'Content-Type':'application/json'});
 res.end(JSON.stringify({choices:[{message:{content:'이전 요청의 현재 상태를 다시 확인했습니다.'}}]}));
});
async function until(predicate){for(let i=0;i<70;i++){if(await predicate())return;await new Promise(r=>setTimeout(r,35));}throw Error('recover timeout');}
test('restart recovers received WhatsApp message and running job without a checkpoint',async()=>{
 await fs.mkdir(root,{recursive:true});await new Promise(r=>mock.listen(0,'127.0.0.1',r));
 const rawFetch=globalThis.fetch,sent=[];
 globalThis.fetch=async(url,opts)=>{
  if(String(url).startsWith('https://graph.facebook.com/')){sent.push(JSON.parse(opts.body));return {ok:true,json:async()=>({messages:[{id:'wamid-'+sent.length}]})};}
  return rawFetch(url,opts);
 };
 try{
  const owner='821011118888';
  await saveConfig({provider:'openai',base:`http://127.0.0.1:${mock.address().port}`,model:'mock',owner});
  const session=await createJoinSession({phone:'+'+owner});
  const linkCode=new URL(session.link).searchParams.get('text');
  assert.equal((await consumeJoinMessage({from:owner,text:linkCode,messageId:'join-1'})).ok,true);
  const waiting=await receiveMessage({channel:'whatsapp',sender:owner,text:'내가 맡긴 업무 복구해 줘'});
  assert.equal((await getTask(waiting.taskId)).status,'received');
  await recoverInterruptedTasks();
  await until(async()=>['answered','reported'].includes((await getTask(waiting.taskId)).status));
  assert.equal(sent.length,1,'recovered task must send its final report');
  assert.match(sent[0].text.body,/Orbit 업무 보고/);
  const interrupted=await receiveMessage({channel:'test',sender:owner,text:'중단됐던 파일 변경의 현재 상태 확인'});
  const operationId=randomUUID();
  await workEvent(interrupted.taskId,'tool-intent',{operationId,name:'write_text_file'});
  await setTaskStatus(interrupted.taskId,'running');
  await recoverInterruptedTasks();
  await until(async()=>['answered','reported'].includes((await getTask(interrupted.taskId)).status));
  assert.ok(inputs.some(req=>req.messages.some(m=>String(m.content).includes('미확인 작업이 남았습니다'))),'must warn model to check uncertain operation');
  assert.ok((await getWork(interrupted.taskId)).events.some(e=>e.type==='recovery-uncertain'));
 }finally{
  globalThis.fetch=rawFetch;
  await new Promise(r=>mock.close(r));await fs.rm(root,{recursive:true,force:true});
 }
});
