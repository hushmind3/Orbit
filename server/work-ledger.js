/** Durable evidence of agent actions. The model decides what to do;
 * the harness records what ACTUALLY happened and makes this visible in reports. */
import {randomUUID} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
const folder=()=>process.env.ORBIT_WORK_LEDGER_PATH||path.resolve('.runtime','work-ledger');
const locks=new Map();
const f=id=>{if(!/^[\da-f-]{36}$/i.test(String(id)))throw Error('invalid task id');return path.join(folder(),id+'.json');};
const empty=id=>({id,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),state:'new',events:[],checkpoint:null,report:null,delivered:false});
export async function getWork(id){try{return {...empty(id),...JSON.parse(await fs.readFile(f(id),'utf8'))};}catch(e){if(e.code==='ENOENT')return empty(id);throw e;}}
async function edit(id,fn){const previous=locks.get(id)||Promise.resolve();const action=previous.then(async()=>{const work=await getWork(id);const result=await fn(work);work.updatedAt=new Date().toISOString();await fs.mkdir(folder(),{recursive:true});const filename=f(id),tmp=filename+'.'+process.pid+'.tmp';await fs.writeFile(tmp,JSON.stringify(work),{mode:0o600});await fs.rename(tmp,filename);return result;});const tail=action.catch(()=>{});locks.set(id,tail);void tail.then(()=>{if(locks.get(id)===tail)locks.delete(id);});return action;}
const asText=(v,limit)=>String(v??'').slice(0,limit);
export async function workEvent(id,type,info={}){const event={id:randomUUID(),type,time:new Date().toISOString(),...info};await edit(id,w=>{w.events.push(event);w.events=w.events.slice(-650);if(type==='finish')w.state=info.status||'reported';if(type==='tool-intent')w.state='running';});return event.id;}
export async function saveCheckpoint(id,data){return edit(id,w=>{w.checkpoint=data;w.state=data?.state||'running';});}
export async function storeWorkReport(id,report,status){return edit(id,w=>{w.report=asText(report,4000);w.delivered=false;w.state=status;if(status!=='paused')w.checkpoint=null;w.events.push({id:randomUUID(),type:'finish',time:new Date().toISOString(),status});});}
export async function reportDelivered(id){return edit(id,w=>{w.delivered=true;w.deliveredAt=new Date().toISOString();});}
export function workFacts(work){const pending=new Map(),done=[];for(const event of work.events){if(event.type==='tool-intent')pending.set(event.operationId,event);if(event.type==='tool-result'){pending.delete(event.operationId);done.push(event);}}return {done,pending:[...pending.values()],ok:done.filter(e=>e.ok).length,failed:done.filter(e=>!e.ok).length};}
/** Never copy model assertions into evidence. All facts below come from executed tools. */
export function formatWorkReport(work,{summary,status='reported',completionReview=null}={}){
 const {done,pending,ok,failed}=workFacts(work);
 let actual=status;
 if(status==='completed'&&(!ok||pending.length||completionReview?.verified!==true))actual='partial';
 const marker=actual==='completed'?'✅':actual==='blocked'?'⛔':actual==='failed'?'❌':actual==='paused'?'⏸️':actual==='partial'?'⚠️':'📝';
 const heading=({completed:'완료',blocked:'진행 불가',failed:'실패',paused:'중단·재개 가능',partial:'일부 진행',reported:'실행 결과',answered:'답변'})[actual]||actual;
 const displaySummary=status==='completed'&&actual!=='completed'?'원래 목표 달성은 확인되지 않았습니다. 모델이 제시한 결과(미검증): '+asText(summary,720):asText(summary||'처리 결과를 확인해 주세요.',950);
 const lines=[`${marker} Orbit 업무 보고 · ${heading}`,displaySummary];
 if(done.length){lines.push(`실행 기록: 성공 ${ok}건 · 오류 ${failed}건`);const sample=done.slice(-5).map(e=>`${e.ok?'✓':'✗'} ${e.name}: ${asText(e.detail,125)}`);lines.push(...sample);}
 if(pending.length)lines.push(`⚠️ 결과를 확인하지 못한 실행 ${pending.length}건이 있습니다. 재실행 전에 상태 확인이 필요합니다.`);
 if(status==='completed'&&actual!=='completed')lines.push('완료라고 단정할 실행 근거가 부족하여 일부 진행으로 표시했습니다. '+asText(completionReview?.reason||'',180));
 return {status:actual,text:lines.join('\n').slice(0,1570)};
}
