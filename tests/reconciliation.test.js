import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {randomUUID} from 'node:crypto';
import {getWork,workEvent,workFacts,reconcileExecution,formatWorkReport} from '../server/work-ledger.js';
const dir=path.join(os.tmpdir(),'orbit-reconcile-'+process.pid);process.env.ORBIT_WORK_LEDGER_PATH=dir;
test('uncertain operation is reconciled only against a later verified observation',async()=>{
 const id=randomUUID(),operationId=randomUUID();await workEvent(id,'tool-intent',{operationId,name:'android_tap'});await workEvent(id,'tool-uncertain',{operationId,name:'android_tap'});
 const failed=await workEvent(id,'tool-result',{operationId:'other',name:'android_read_screen',ok:false,detail:'device offline'});
 const proof=await workEvent(id,'tool-result',{operationId:'readback',name:'android_read_screen',ok:true,detail:'desired state enabled'});
 await assert.rejects(reconcileExecution(id,{operationId,verificationEventId:failed,outcome:'confirmed_executed',reason:'failed read'}),/성공한 조회/);
 assert.equal(workFacts(await getWork(id)).pending.length,1);
 await reconcileExecution(id,{operationId,verificationEventId:proof,outcome:'confirmed_executed',reason:'설정 값 확인'});
 const facts=workFacts(await getWork(id));assert.equal(facts.pending.length,0);assert.equal(facts.reconciled.length,1);
 await assert.rejects(reconcileExecution(id,{operationId,verificationEventId:proof,outcome:'confirmed_executed',reason:'duplicated'}),/이미 확인/);
 assert.match(formatWorkReport(await getWork(id),{status:'partial',summary:'조회 완료'}).text,/중단 작업 재확인/);
});
test('an unrelated write cannot serve as proof for interrupted action',async()=>{
 const id=randomUUID(),operationId=randomUUID();await workEvent(id,'tool-intent',{operationId,name:'browser_click'});
 const fake=await workEvent(id,'tool-result',{operationId:randomUUID(),name:'write_text_file',ok:true,detail:'written'});
 await assert.rejects(reconcileExecution(id,{operationId,verificationEventId:fake,outcome:'confirmed_executed',reason:'guess'}),/읽기\/상태 확인/);
 assert.equal(workFacts(await getWork(id)).pending.length,1);
});
test.after(async()=>{await fs.rm(dir,{recursive:true,force:true});});
