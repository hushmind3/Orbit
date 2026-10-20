import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createServer} from 'node:http';
import {saveConfig} from '../server/config.js';
const root=path.join(os.tmpdir(),'orbit-admin-check-'+process.pid);
process.env.ORBIT_CONFIG_PATH=path.join(root,'config.json');
process.env.ORBIT_INBOX_PATH=path.join(root,'inbox.json');
process.env.ORBIT_WORK_LEDGER_PATH=path.join(root,'work');
process.env.ORBIT_APPROVALS_PATH=path.join(root,'approvals.json');
process.env.ORBIT_STORE_PATH=path.join(root,'store.json');
process.env.ORBIT_CONNECTORS_PATH=path.join(root,'connectors.json');
process.env.ORBIT_AUTO_RECOVER='0';
const reserve=createServer();await new Promise(r=>reserve.listen(0,'127.0.0.1',r));
const port=reserve.address().port;await new Promise(r=>reserve.close(r));
process.env.ORBIT_PORT=String(port);
const model=createServer(async(req,res)=>{
 let body='';for await(const c of req)body+=c;
 const data=JSON.parse(body);
 const answered=data.messages.some(m=>String(m.content).includes('사용자 답변:'));
 const tool=answered?{name:'finish_task',arguments:JSON.stringify({status:'partial',summary:'답변을 받았습니다. 외부 업무는 완료하지 않았습니다.'})}:{name:'request_user_input',arguments:JSON.stringify({question:'원하는 제목은?'})};
 res.setHeader('Content-Type','application/json');
 res.end(JSON.stringify({choices:[{message:{tool_calls:[{id:'admin-tool',function:tool}]}}]}));
});
async function poll(fn){for(let i=0;i<80;i++){const v=await fn();if(v)return v;await new Promise(r=>setTimeout(r,40));}throw Error('admin timeout');}
test('operator dashboard sends an actual answer to a suspended task',async()=>{
 await fs.mkdir(root,{recursive:true});await new Promise(r=>model.listen(0,'127.0.0.1',r));
 await saveConfig({provider:'openai',base:'http://127.0.0.1:'+model.address().port,model:'admin-mock',owner:'821011113337'});
 const {server}=await import('../server/index.js');
 const base='http://127.0.0.1:'+port,headers={'X-Orbit-Agent':'1','Content-Type':'application/json'};
 const send=(route,payload)=>fetch(base+route,{method:'POST',headers,body:JSON.stringify(payload)}).then(r=>r.json());
 try{
  const first=await send('/api/admin/operator/test',{text:'문서 제목 알려줘'});assert.ok(first.taskId);
  const question=await poll(async()=>{
   const data=await(await fetch(base+'/api/admin/operator',{headers})).json();
   return data.approvals.find(p=>p.taskId===first.taskId);
  });
  assert.equal(question.question,true);
  const answer=await send('/api/admin/operator/approval',{action:'답변',code:question.code,text:'연간 보고서'});
  assert.equal(answer.ok,true);
  const task=await poll(async()=>{
   const state=await(await fetch(base+'/api/admin/state',{headers})).json();
   return state.tasks.find(t=>t.id===first.taskId&&t.status==='partial');
  });
  assert.equal(task.status,'partial');
  assert.equal((await(await fetch(base+'/api/admin/operator',{headers})).json()).approvals.length,0);
 }finally{
  await new Promise(r=>server.close(r));await new Promise(r=>model.close(r));
  await fs.rm(root,{recursive:true,force:true});
 }
});
