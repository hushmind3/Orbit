import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import {validUrl,safety,runTool,permissionRequired,definitions} from '../server/tools.js';
import {store} from '../server/store.js';

test('only public http(s) URLs are navigable',()=>{
  assert.equal(validUrl('https://www.example.com/'),'https://www.example.com/');
  for(const url of ['file:///etc/passwd','http://127.0.0.1:80','http://localhost:8080','javascript:alert(1)','http://192.168.1.1/']){
    assert.throws(()=>validUrl(url));
  }
});
test('file access limited to user folders',()=>{
  assert.equal(safety('Downloads'),path.join(os.homedir(),'Downloads'));
  assert.throws(()=>safety('../etc/passwd'));
  assert.throws(()=>safety('Desktop/../../secrets.txt'));
  assert.throws(()=>safety('/etc/passwd'));
});
test('mutation tools require approval',()=>{
  for(const name of ['write_text_file','browser_click','browser_fill','browser_press','remember']){
    assert.ok(permissionRequired.has(name));
  }
  assert.equal(definitions.length,12);
});
test('list, read and write text files work',async()=>{
  const root=path.join(os.homedir(),'Documents');
  await fs.mkdir(root,{recursive:true});
  const file=path.join(root,`orbit-test-${process.pid}.txt`);
  try {
    let result=await runTool('write_text_file',{file,content:'작업 확인'}, {store});
    assert.match(result,/저장 완료/);
    result=await runTool('read_text_file',{file},{store});assert.equal(result,'작업 확인');
    const listing=await runTool('list_files',{folder:root},{store});
    assert.ok(listing.includes(path.basename(file)));
    await assert.rejects(()=>runTool('write_text_file',{file,content:'overwrite'}, {store}));
  }finally{await fs.rm(file,{force:true});}
});
