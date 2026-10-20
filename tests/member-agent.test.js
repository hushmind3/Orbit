import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createServer} from 'node:http';
import {saveConfig} from '../server/config.js';
import {runMember,validatePublicWebURL} from '../server/member-tools.js';
import {receiveMessage,getTask,getThread} from '../server/inbox.js';
import {processInboundTask} from '../server/operator.js';
const root=path.join(os.tmpdir(),`orbit-member-test-${process.pid}`);
process.env.ORBIT_CONFIG_PATH=path.join(root,'config.json');
process.env.ORBIT_MEMBERS_PATH=path.join(root,'members');
process.env.ORBIT_INBOX_PATH=path.join(root,'inbox.json');
const mock=createServer(async(req,res)=>{let body='';for await(const b of req)body+=b;const j=JSON.parse(body),messages=j.messages;res.setHeader('Content-Type','application/json');const gotTool=messages.some(x=>x.role==='tool');if(!gotTool)res.end(JSON.stringify({choices:[{message:{role:'assistant',tool_calls:[{id:'t1',type:'function',function:{name:'save_personal_note',arguments:JSON.stringify({note:'개별 사용자 기억'})}}]}}]}));else res.end(JSON.stringify({choices:[{message:{role:'assistant',content:'이 사용자 메모 보관함에 저장했습니다.'}}]}));});
test('separate user memories, no PC access, genuine tool result in response',async()=>{
 await fs.mkdir(root,{recursive:true});await new Promise(resolve=>mock.listen(0,'127.0.0.1',resolve));
 try{
  await saveConfig({provider:'openai',base:`http://127.0.0.1:${mock.address().port}`,model:'fake-chat',owner:'821000000001'});
  const a='821011112222',b='821033334444';
  const inbox=await receiveMessage({channel:'test',sender:a,text:'내게 기억해 줘'});
  const result=await processInboundTask(inbox.taskId);assert.equal(result.status,'completed');
  assert.match(JSON.stringify(await runMember('list_personal_notes',{},a)),/개별 사용자 기억/);
  assert.doesNotMatch(JSON.stringify(await runMember('list_personal_notes',{},b)),/개별 사용자 기억/);
  assert.equal((await getTask(inbox.taskId)).status,'sent');
  assert.ok((await getThread(inbox.threadId)).messages.some(m=>/메모 보관함/.test(m.text)));
  await assert.rejects(()=>runMember('android_tap',{x:2,y:3},a),/허용되지 않은/);
 }finally{await new Promise(r=>mock.close(r));await fs.rm(root,{recursive:true,force:true});}
});
test('public page tool rejects internal network URLs',async()=>{
 for(const url of ['http://example.com','https://localhost/admin','https://127.0.0.1/','https://10.0.0.1/','file:///etc/passwd'])await assert.rejects(()=>validatePublicWebURL(url));
});
