import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {newCase,findCase,listCases,processTurn,callInfo,adbDevices,duplicatePhotos,validateWebhook} from '../server/negotiation.js';

test('case creation and persistent state',async()=>{
 const c=await newCase({name:'테스트 환불',goal:'환불 받기',facts:'상담일 10월',limits:'추가 결제 금지'});
 const saved=await findCase(c.id);assert.equal(saved.goal,'환불 받기');assert.equal(saved.limits,'추가 결제 금지');
 assert.ok((await listCases()).some(x=>x.id===c.id));
});
test('agent negotiates according to context with actual model API request',async()=>{
 let seen=null;
 const fake=createServer(async(req,res)=>{let body='';for await(const piece of req)body+=piece.toString();seen=JSON.parse(body);
 res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({message:{role:'assistant',content:JSON.stringify({say:'위약금 산정 근거와 약정 종료일을 알려주시겠습니까?',reason:'거절 전 산출 근거 확인',flag:'normal',digits:''})}}));});
 await new Promise(r=>fake.listen(0,'127.0.0.1',r));
 try{
 const c=await newCase({name:'해지 상담',goal:'추가 위약금 최소화',limits:'약정 연장 동의 금지'});
 const decision=await processTurn(c.id,'해지 위약금이 18만 원입니다.',{provider:'ollama',model:'mock',base:`http://127.0.0.1:${fake.address().port}`});
 assert.match(decision.say,/산정 근거/);assert.equal(seen.messages[1].role,'user');assert.match(seen.messages[1].content,/약정 연장 동의 금지/);
 const saved=await findCase(c.id);assert.equal(saved.turns.length,2);
 }finally{await new Promise(r=>fake.close(r));}
});
test('phone connection is not falsely reported without credentials',()=>{assert.equal(typeof callInfo().configured,'boolean');assert.equal(validateWebhook({id:'notfound',url:'',token:'',form:{},signature:''}),false);});
test('Android and photo tools are readable without hardware',async()=>{assert.equal(typeof (await adbDevices()),'string');const r=await duplicatePhotos();assert.ok(Array.isArray(r.groups));});
