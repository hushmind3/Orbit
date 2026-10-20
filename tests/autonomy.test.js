import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createServer} from 'node:http';
import {saveConfig} from '../server/config.js';
import {receiveMessage,getTask,getThread} from '../server/inbox.js';
import {processOwnerTask,operatorPending} from '../server/operator.js';

const root=path.join(os.tmpdir(),`orbit-autonomy-${process.pid}`);
process.env.ORBIT_CONFIG_PATH=path.join(root,'config.json');
process.env.ORBIT_INBOX_PATH=path.join(root,'inbox.json');
process.env.ORBIT_APPROVALS_PATH=path.join(root,'approvals.json');
process.env.ORBIT_ADB_PATH=path.join(root,'adb');
let steps=0,observed=false;
const model=createServer(async(req,res)=>{
 let raw='';for await(const c of req)raw+=c;
 const payload=JSON.parse(raw);steps++;
 if(steps===2)observed=payload.messages.some(x=>x.role==='tool'&&x.content.includes('현재 화면 관찰:'));
 const target=steps===1?{name:'android_tap',args:{x:22,y:30}}:
  steps<=10?{name:'remember',args:{note:'자율 작업 '+steps}}:null;
 const msg=target?{role:'assistant',content:null,tool_calls:[{id:`act_${steps}`,function:{name:target.name,arguments:JSON.stringify(target.args)}}]}:
  {role:'assistant',content:'화면 확인과 기억 저장을 완료했습니다.'};
 res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{message:msg}]}));
});

test('owner job runs ten sequential actions without repeated permission and observes Android after touch',async()=>{
 await fs.mkdir(root,{recursive:true});
 await fs.writeFile(path.join(root,'adb'),`#!/bin/sh
case " $* " in
 *" devices "*) printf 'List of devices attached\\nTEST\\tdevice\\n';;
 *" cat /sdcard/orbit-ui.xml "*) echo '<hierarchy><node text="다음" bounds="[0,0][200,100]" /></hierarchy>';;
 *) echo 'ok';;
esac
`,{mode:0o755});
 await new Promise(r=>model.listen(0,'127.0.0.1',r));
 try{
  await saveConfig({provider:'openai',base:`http://127.0.0.1:${model.address().port}`,model:'mock-autonomy',owner:'821011119999'});
  const req=await receiveMessage({channel:'test',sender:'821011119999',text:'화면에서 다음을 누르고 필요한 메모를 계속 만들어 줘'});
  const result=await processOwnerTask(req.taskId);
  assert.equal(result.status,'completed');
  assert.equal((await getTask(req.taskId)).status,'sent');
  assert.equal((await operatorPending()).length,0);
  assert.equal(steps,11,'must continue past old 8-step boundary');
  assert.equal(observed,true,'the model must see the changed Android screen before next action');
  const thread=await getThread(req.threadId);
  assert.ok(thread.messages.some(x=>x.text.includes('화면 확인과 기억 저장')));
 }finally{
  await new Promise(r=>model.close(r));
  await fs.rm(root,{recursive:true,force:true});
  delete process.env.ORBIT_ADB_PATH;
 }
});
