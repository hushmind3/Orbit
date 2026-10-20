import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createServer} from 'node:http';
import {saveConfig} from '../server/config.js';
import {runLocalOperator} from '../server/operator.js';
import {getDashboard,getTask} from '../server/inbox.js';
import {getWork,workFacts} from '../server/work-ledger.js';
const dir=path.join(os.tmpdir(),'orbit-hardening-'+process.pid);
process.env.ORBIT_CONFIG_PATH=path.join(dir,'config.json');
process.env.ORBIT_INBOX_PATH=path.join(dir,'inbox.json');
process.env.ORBIT_APPROVALS_PATH=path.join(dir,'approvals.json');
process.env.ORBIT_WORK_LEDGER_PATH=path.join(dir,'ledger');
process.env.ORBIT_STORE_PATH=path.join(dir,'store.json');
let mode='bad-args',calls=0,auditWithoutTools=true;
const tool=(name,args,id)=>({role:'assistant',content:null,tool_calls:[{id:'test_'+id,type:'function',function:{name,arguments:args}}]});
const llm=createServer(async(req,res)=>{
 let raw='';for await(const c of req)raw+=c;const data=JSON.parse(raw);
 let output;
 if(data.messages[0].content.includes('# ORBIT_GOAL_AUDIT')){
  auditWithoutTools&&=!('tools' in data)&&!('parallel_tool_calls' in data);
  output={role:'assistant',content:JSON.stringify({verified:true,reason:'메모 저장을 직접 확인'})};
 }else{
  calls++;
  if(mode==='bad-args')output=calls===1?tool('remember','{broken json',calls):calls===2?tool('remember',JSON.stringify({note:'이것은 실제 메모'}),calls):tool('finish_task',JSON.stringify({status:'completed',summary:'메모 저장 확인'}),calls);
  else output=calls<=10?tool('remember',JSON.stringify({note:'연속 작업 '+calls}),calls):tool('finish_task',JSON.stringify({status:'completed',summary:'메모 작성 완료'}),calls);
 }
 res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:output}]}));
});
await fs.mkdir(dir,{recursive:true});await new Promise(r=>llm.listen(0,'127.0.0.1',r));
await saveConfig({provider:'openai',base:'http://127.0.0.1:'+llm.address().port,model:'mock',approvalMode:'autonomous'});
test('malformed tool arguments do not execute and final audit omits empty tools',async()=>{
 mode='bad-args';calls=0;auditWithoutTools=true;
 const outcome=await runLocalOperator({text:'이것은 실제 메모를 저장해 줘'});
 assert.equal(outcome.status,'completed');
 const w=await getWork((await getDashboard()).tasks[0].id);
 assert.equal(workFacts(w).ok,1);
 assert.equal(auditWithoutTools,true);
 assert.equal(calls,3);
});
test('desktop 계속 resumes same paused owner task without creating a new one',async()=>{
 mode='pause';calls=0;process.env.ORBIT_MAX_STEPS='10';
 try{
  const before=(await getDashboard()).tasks.length;
  const first=await runLocalOperator({text:'10개 메모를 작성해 줘'});
  assert.equal(first.status,'paused');
  const paused=(await getDashboard()).tasks[0];
  const resumed=await runLocalOperator({text:'계속'});
  assert.equal(resumed.status,'completed');
  assert.equal((await getDashboard()).tasks.length,before+1);
  assert.equal((await getTask(paused.id)).status,'completed');
  assert.equal(workFacts(await getWork(paused.id)).ok,10);
 }finally{delete process.env.ORBIT_MAX_STEPS;}
});
test.after(async()=>{await new Promise(r=>llm.close(r));await fs.rm(dir,{recursive:true,force:true});});
