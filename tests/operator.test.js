import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createServer} from 'node:http';
import {loadConfig,saveConfig} from '../server/config.js';
import {receiveMessage,getThread,getTask} from '../server/inbox.js';
import {processOwnerTask,handleApproval,operatorPending,isOwner} from '../server/operator.js';

const root=path.join(os.tmpdir(),'orbit-operator-test-'+process.pid);
const documentDir=path.join(os.homedir(),'Documents');
const destination=path.join(documentDir,`orbit-approval-test-${process.pid}.txt`);
process.env.ORBIT_CONFIG_PATH=path.join(root,'config.json');
process.env.ORBIT_APPROVALS_PATH=path.join(root,'approvals.json');
let steps=0;
const fake=createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;const parsed=JSON.parse(body);steps++;res.writeHead(200,{'Content-Type':'application/json'});
if(steps===1)res.end(JSON.stringify({choices:[{message:{role:'assistant',content:null,tool_calls:[{id:'callA',function:{name:'remember',arguments:JSON.stringify({note:'테스트에서 자동 저장할 메모'})}}]}}]}));
else if(steps===2)res.end(JSON.stringify({choices:[{message:{role:'assistant',content:null,tool_calls:[{id:'callB',function:{name:'write_text_file',arguments:JSON.stringify({file:destination,content:'after',overwrite:true})}}]}}]}));
else res.end(JSON.stringify({choices:[{message:{role:'assistant',content:'사용자 승인 후 파일을 변경했습니다.'}}]}));
});

test('owner WhatsApp-like task -> model tool -> approval -> actual execution -> report',async()=>{
 await fs.mkdir(root,{recursive:true});await fs.mkdir(documentDir,{recursive:true});await fs.writeFile(destination,'before');await new Promise(resolve=>fake.listen(0,'127.0.0.1',resolve));
 try{
  const config=await saveConfig({provider:'openai',base:`http://127.0.0.1:${fake.address().port}`,model:'fake-agent',owner:'821012345678',approvalMode:'review'});
  assert.equal(config.ownerConfigured,true);assert.equal((await loadConfig()).key,'');
  assert.equal(await isOwner('821099998888'),false);assert.equal(await isOwner('821012345678'),true);
  const got=await receiveMessage({channel:'test',sender:'821012345678',text:'테스트 승인 후 실제 저장해 줘',messageId:'operator-test-'+process.pid});
  const first=await processOwnerTask(got.taskId);
  assert.equal(first.status,'awaiting_input');assert.equal((await getTask(got.taskId)).status,'awaiting_input');
  const pending=await operatorPending();assert.equal(pending.length,1);assert.equal(pending[0].tool,'write_text_file');
  assert.equal(await fs.readFile(destination,'utf8'),'before');
  assert.equal((await handleApproval('821099999999','승인 '+pending[0].code)).ok,false);
  assert.equal((await handleApproval('821012345678','승인 ABCD123456')).ok,false);
  assert.equal((await getTask(got.taskId)).status,'awaiting_input');
  const wrong=await handleApproval('821012345678','답변 '+pending[0].code+' 네');assert.equal(wrong.ok,false);
  assert.equal((await operatorPending()).length,1);
  const accepted=await handleApproval('821012345678','승인 '+pending[0].code);
  assert.equal(accepted.ok,true);assert.equal((await getTask(got.taskId)).status,'reported');
  assert.equal((await operatorPending()).length,0);
  const thread=await getThread(got.threadId);assert.ok(thread.messages.some(x=>x.text.includes('사용자 승인 후 파일')));
  assert.equal(await fs.readFile(destination,'utf8'),'after');
  assert.ok(thread.messages.some(x=>x.text.includes('실행 승인 필요')));
  assert.equal(steps,3);
 }finally{await new Promise(resolve=>fake.close(resolve));await fs.rm(root,{force:true,recursive:true});await fs.rm(destination,{force:true});}
});
