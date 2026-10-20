import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createServer} from 'node:http';
import {saveConfig} from '../server/config.js';
import {receiveMessage,getTask,getThread} from '../server/inbox.js';
import {processOwnerTask,handleApproval,resumePausedTask,operatorPending} from '../server/operator.js';
import {getWork,workFacts,formatWorkReport} from '../server/work-ledger.js';
const root=path.join(os.tmpdir(),`orbit-harness-${process.pid}`);
process.env.ORBIT_CONFIG_PATH=path.join(root,'cfg.json');
process.env.ORBIT_INBOX_PATH=path.join(root,'inbox.json');
process.env.ORBIT_APPROVALS_PATH=path.join(root,'approval.json');
process.env.ORBIT_WORK_LEDGER_PATH=path.join(root,'work');
process.env.ORBIT_STORE_PATH=path.join(root,'store');
let owner='821011113333';
let mode='finish',calls=0;
const tool=(name,args,id)=>({role:'assistant',content:null,tool_calls:[{id:'id_'+id,function:{name,arguments:JSON.stringify(args)}}]});
const model=createServer(async(req,res)=>{
 let raw='';for await(const chunk of req)raw+=chunk;
 const data=JSON.parse(raw);
 if(data.messages?.[0]?.content?.includes('# ORBIT_GOAL_AUDIT')){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{message:{role:'assistant',content:JSON.stringify({verified:!['false-success','false-positive'].includes(mode),reason:mode==='false-success'?'실패한 작업만 있음':'관찰한 메모 저장 결과가 사용자 요청을 충족함'})}}]}));return;}
 calls++;
 let msg;
 if(mode==='finish'){
  msg=calls===1?tool('remember',{note:'비서가 자율적으로 기록한 메모'},calls):tool('finish_task',{status:'completed',summary:'메모 저장을 확인했습니다. 나머지 작업은 없습니다.'},calls);
 }else if(mode==='question'){
  const answered=data.messages.some(m=>String(m.content).includes('사용자 답변:'));
  const remembered=data.messages.some(m=>String(m.content).includes('다음 대화에도 남도록 기억했습니다'));
  msg=!answered?tool('request_user_input',{question:'파일에 어떤 제목을 붙일까요?'},calls):!remembered?tool('remember',{note:'제목은 사용자가 알려준 값'},calls):tool('finish_task',{status:'completed',summary:'사용자가 알려준 제목을 기록했습니다.'},calls);
 }else if(mode==='false-success'){
  msg=calls===1?tool('read_text_file',{file:'~/Documents/definitely-not-real-'+process.pid+'.txt'},calls):tool('finish_task',{status:'completed',summary:'모든 파일을 정상적으로 읽었습니다.'},calls);
 }else if(mode==='false-positive'){
  msg=calls===1?tool('remember',{note:'지시를 접수했다는 메모만 보관'},calls):tool('finish_task',{status:'completed',summary:'해지를 완료했습니다.'},calls);
 }else if(mode==='progress-fast'){
  msg=calls<=2?tool('report_progress',{message:'사용자에게 알려야 할 서로 다른 진행사항 '+calls},calls):tool('finish_task',{status:'partial',summary:'아직 처리 중입니다.'},calls);
 }else if(mode==='progress'){
  msg=calls===1?tool('report_progress',{message:'중요한 진행 사항을 확인했습니다.'},calls):calls===2?tool('remember',{note:'중간 보고 후 실행'},calls):tool('finish_task',{status:'completed',summary:'업무 종료했습니다.'},calls);
 }else if(mode==='pause'){
  msg=calls<=10?tool('remember',{note:'장시간 업무 단계 '+calls},calls):tool('finish_task',{status:'completed',summary:'재개 후 작업이 완료되었습니다.'},calls);
 }
 res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{message:msg}]}));
});
async function setup(name){await fs.mkdir(root,{recursive:true});mode=name;calls=0;owner=({finish:'821011110001',question:'821011110002','false-success':'821011110003',progress:'821011110004',pause:'821011110005','false-positive':'821011110006','progress-fast':'821011110007'})[name];await saveConfig({provider:'openai',base:`http://127.0.0.1:${model.address().port}`,model:'mock-harness',owner,approvalMode:'autonomous'});return receiveMessage({channel:'test',sender:owner,text:name==='false-positive'?'구독을 위약금 없이 실제 해지하고 결과를 알려줘':'지시를 알아서 처리하고 결과를 알려줘 '+name});}
await new Promise(resolve=>model.listen(0,'127.0.0.1',resolve));
test('finish_task reports evidence from executed work, not merely a chat send',async()=>{
 const task=await setup('finish');const result=await processOwnerTask(task.taskId);
 assert.equal(result.status,'completed');assert.equal((await getTask(task.taskId)).status,'completed');
 const work=await getWork(task.taskId);assert.equal(work.delivered,true);assert.equal(workFacts(work).ok,1);
 const history=(await getThread(task.threadId)).messages.map(m=>m.text).join('\n');
 assert.match(history,/Orbit 업무 보고/);assert.match(history,/remember/);assert.match(history,/성공 1건/);
 assert.equal((await operatorPending()).length,0);
});
test('model autonomously asks one freeform question then resumes same saved job',async()=>{
 const task=await setup('question');const result=await processOwnerTask(task.taskId);
 assert.equal(result.status,'awaiting_input');assert.equal((await getTask(task.taskId)).status,'awaiting_input');
 const pending=await operatorPending();assert.equal(pending.length,1);assert.equal(pending[0].tool,'request_user_input');
 const invalid=await handleApproval(owner,'답변 '+pending[0].code);assert.equal(invalid.ok,false);
 const invalid2=await handleApproval(owner,'승인 '+pending[0].code);assert.equal(invalid2.ok,false);
 assert.equal((await operatorPending()).length,1,'잘못된 응답은 대기 중인 질문을 없애면 안 됩니다.');
 const answer=await handleApproval(owner,'답변 '+pending[0].code+' 2026년 보고서');
 assert.equal(answer.ok,true);assert.equal((await getTask(task.taskId)).status,'completed');
 assert.equal((await getWork(task.taskId)).delivered,true);
 assert.equal((await operatorPending()).length,0);
});
test('model cannot turn only failed tool executions into verified completion',async()=>{
 const task=await setup('false-success');const result=await processOwnerTask(task.taskId);
 assert.equal(result.status,'partial');
 const report=(await getWork(task.taskId)).report;assert.match(report,/오류 1건/);assert.match(report,/완료라고 단정할/);
});
test('one unrelated success cannot confirm the user goal',async()=>{
 const task=await setup('false-positive');const result=await processOwnerTask(task.taskId);
 assert.equal(result.status,'partial');assert.match((await getWork(task.taskId)).report,/완료라고 단정/);
 assert.equal(workFacts(await getWork(task.taskId)).ok,1);
});
test('two consecutive progress requests both produce real notices',async()=>{
 const task=await setup('progress-fast');const result=await processOwnerTask(task.taskId);
 assert.equal(result.status,'partial');const thread=await getThread(task.threadId);
 assert.equal(thread.messages.filter(m=>m.direction==='out'&&m.text.includes('진행 보고')).length,2);
 assert.equal((await getWork(task.taskId)).events.filter(x=>x.type==='progress').length,2);
});
test('progress reporting is optional and does not finish a task',async()=>{
 const task=await setup('progress');const before=(await getThread(task.threadId)).messages.length;const result=await processOwnerTask(task.taskId);
 assert.equal(result.status,'completed');
 const history=(await getThread(task.threadId)).messages.slice(before).filter(m=>m.direction==='out').map(m=>m.text);
 assert.equal(history.filter(x=>x.includes('진행 보고')).length,1);
 assert.equal(history.filter(x=>x.includes('업무 보고')).length,1);
});
test('task can pause at configured resource budget, then resume with saved context',async()=>{
 process.env.ORBIT_MAX_STEPS='10';
 const task=await setup('pause');const first=await processOwnerTask(task.taskId);
 assert.equal(first.status,'paused');assert.ok((await getWork(task.taskId)).checkpoint);
 const resumed=await resumePausedTask(task.taskId,owner);
 assert.equal(resumed.status,'completed');
 assert.equal(workFacts(await getWork(task.taskId)).ok,10);
 delete process.env.ORBIT_MAX_STEPS;
});
test.after(async()=>{await new Promise(resolve=>model.close(resolve));await fs.rm(root,{recursive:true,force:true});});
