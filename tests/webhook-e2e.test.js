import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createServer} from 'node:http';
import {createHmac} from 'node:crypto';
import {saveConfig} from '../server/config.js';
import {receiveMessage} from '../server/inbox.js';
const root=path.join(os.tmpdir(),'orbit-webhook-end2end-'+process.pid);
process.env.ORBIT_PORT=String(49100+(process.pid%900));
process.env.ORBIT_REQUIRE_SMS='0'; // Explicit isolated test only, not public production.
process.env.ORBIT_ONBOARDING_PATH=path.join(root,'join.json');
process.env.ORBIT_CONFIG_PATH=path.join(root,'model.json');
process.env.ORBIT_INBOX_PATH=path.join(root,'inbox.json');
process.env.ORBIT_MEMBERS_PATH=path.join(root,'members');
process.env.WA_BUSINESS_NUMBER='15551230001';
process.env.WA_PHONE_NUMBER_ID='9999';
process.env.WA_ACCESS_TOKEN='mock-token';
process.env.WA_APP_SECRET='mock-app-secret';
process.env.WA_VERIFY_TOKEN='mock-verify';
const model=createServer(async(req,res)=>{let s='';for await(const ch of req)s+=ch;const j=JSON.parse(s);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:'Orbit 자동 응답이 정상 작동했습니다.'}}]}));});
function incoming(sender,text,id){return JSON.stringify({object:'whatsapp_business_account',entry:[{changes:[{field:'messages',value:{messages:[{type:'text',from:sender,id,text:{body:text}}]}}]}]});}
function signature(body){return 'sha256='+createHmac('sha256',process.env.WA_APP_SECRET).update(body).digest('hex');}
async function until(fn,ms=4500){const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await new Promise(r=>setTimeout(r,45));}throw Error('Webhook chat reply not delivered in time');}
test('HTTP QR -> signed Meta signup -> verified account -> real model auto response -> duplicate rejected',async()=>{
 await fs.mkdir(root,{recursive:true});await new Promise(r=>model.listen(0,'127.0.0.1',r));
 await saveConfig({provider:'openai',base:`http://127.0.0.1:${model.address().port}`,model:'fake-e2e',owner:'821099999999'});
 const old=globalThis.fetch,sent=[];
 globalThis.fetch=async(url,opts)=>{
  if(String(url).startsWith('https://graph.facebook.com/')&&String(url).endsWith('/messages')){sent.push(JSON.parse(opts.body));return {ok:true,json:async()=>({messages:[{id:'wamid.test-'+sent.length}]})};}
  return old(url,opts);
 };
 const {server}=await import('../server/index.js');
 try{
  const url=`http://127.0.0.1:${process.env.ORBIT_PORT}`;
  const qrPage=await old(url+'/join');assert.equal(qrPage.status,200);assert.match(await qrPage.text(),/QR/);
  const config=await (await old(url+'/onboarding/config')).json();assert.equal(config.ready,true);
  const created=await old(url+'/onboarding/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'실제 흐름 테스트'})});assert.equal(created.status,201);
  const session=await created.json();assert.equal(session.status,'awaiting_whatsapp');assert.match(session.link,/wa\.me/);
  const qr=await old(url+'/onboarding/qr/'+session.id);
  if(qr.status===503){assert.match((await qr.json()).error,/npm install/);}else{assert.equal(qr.status,200);assert.match(await qr.text(),/<svg/);}
  const code=new URL(session.link).searchParams.get('text');
  const send=async(text,id,valid=true)=>{const b=incoming('821011112222',text,id);return old(url+'/webhook/whatsapp',{method:'POST',headers:{'Content-Type':'application/json','X-Hub-Signature-256':valid?signature(b):'sha256=bad'},body:b});};
  assert.equal((await send(code,'join-1',false)).status,403);
  assert.equal((await send(code,'join-2')).status,200);
  const verified=await (await old(url+'/onboarding/session/'+session.id)).json();assert.equal(verified.verified,true);
  await until(()=>sent.some(x=>x.text?.body?.includes('연결이 완료')));
  assert.equal((await send('오늘 할 일 3개 알려줘','task-1')).status,200);
  await until(()=>sent.some(x=>x.text?.body?.includes('자동 응답이 정상')));
  const before=sent.length;
  assert.equal((await send('오늘 할 일 3개 알려줘','task-1')).status,200);
  await new Promise(r=>setTimeout(r,200));assert.equal(sent.length,before);
  const dash=await old(url+'/api/admin/state',{headers:{'X-Orbit-Agent':'1'}});assert.equal(dash.status,200);
  const state=await dash.json();assert.equal(state.tasks.length,1);assert.equal(state.tasks[0].status,'answered');
 }finally{globalThis.fetch=old;await new Promise(r=>server.close(r));await new Promise(r=>model.close(r));await fs.rm(root,{recursive:true,force:true});}
});
