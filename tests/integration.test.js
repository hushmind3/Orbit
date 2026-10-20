import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import fs from 'node:fs/promises';
import path from 'node:path';

const headers={'Content-Type':'application/json','X-Orbit-Agent':'1'};
const root=path.resolve(import.meta.dirname,'..');

test('real chat -> Ollama tool call -> approve -> save memory -> final answer', {timeout:17000}, async()=>{
  let callCount=0;
  const mock=createServer(async(req,res)=>{
    let input='';for await(const part of req)input+=part.toString();
    const parsed=JSON.parse(input);
    assert.ok(Array.isArray(parsed.tools));
    assert.equal(parsed.model,'test-model');
    callCount++;
    res.writeHead(200,{'Content-Type':'application/json'});
    if(callCount===1){
      res.end(JSON.stringify({message:{role:'assistant',content:'',tool_calls:[{function:{name:'remember',arguments:{note:'시범 기능 점검'}}}]}}));
    }else{
      assert.equal(parsed.messages.at(-1).tool_name,'remember');
      assert.match(parsed.messages.at(-1).content,/기억/);
      res.end(JSON.stringify({message:{role:'assistant',content:'메모를 저장했습니다.'}}));
    }
  });
  await new Promise(resolve=>mock.listen(0,'127.0.0.1',resolve));
  const fakePort=mock.address().port;
  const processServer=spawn('node',['server/index.js'],{cwd:root,stdio:['ignore','pipe','pipe']});
  let errors='';processServer.stderr.on('data',chunk=>{errors+=chunk.toString();});
  try{
    let healthy=false;
    for(let i=0;i<35;i++){
      await delay(100);
      try{const r=await fetch('http://127.0.0.1:4786/api/health',{headers});if(r.ok){healthy=true;break;}}catch{}
    }
    assert.ok(healthy,`server did not start: ${errors}`);
    const r=await fetch('http://127.0.0.1:4786/api/message',{
      method:'POST',headers,body:JSON.stringify({text:'기억해 줘: 시범 기능 점검',config:{provider:'ollama',base:`http://127.0.0.1:${fakePort}`,model:'test-model'}})
    });
    assert.equal(r.status,200);
    const reader=r.body.getReader();let buffer='';let gotApproval=false;let gotAnswer=false;let results=[];
    while(true){const {done,value}=await reader.read();if(done)break;buffer+=new TextDecoder().decode(value);
      while(buffer.includes('\n')){
        const i=buffer.indexOf('\n');const line=buffer.slice(0,i);buffer=buffer.slice(i+1);
        if(!line.trim())continue;
        const msg=JSON.parse(line);results.push(msg);
        if(msg.type==='approval'){
          gotApproval=true;
          const approve=await fetch('http://127.0.0.1:4786/api/approval',{method:'POST',headers,body:JSON.stringify({id:msg.id,allow:true})});
          assert.deepEqual(await approve.json(),{ok:true});
        }
        if(msg.type==='answer'){gotAnswer=true;assert.equal(msg.text,'메모를 저장했습니다.');}
      }
    }
    assert.ok(gotApproval);assert.ok(gotAnswer);assert.equal(callCount,2);
    assert.ok(results.some(x=>x.type==='tool_result'&&x.tool==='remember'));
    const history=await (await fetch('http://127.0.0.1:4786/api/history',{headers})).json();
    assert.ok(history.notes.some(x=>x.note==='시범 기능 점검'));
    assert.ok(history.items.some(x=>x.content==='메모를 저장했습니다.'));
    const noHeader=await fetch('http://127.0.0.1:4786/api/history');assert.equal(noHeader.status,403);
  }finally{
    processServer.kill();await new Promise(resolve=>mock.close(resolve));
  }
});
