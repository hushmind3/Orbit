import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {runMobile,mobilePermissions} from '../server/mobile.js';
const root=path.join(os.tmpdir(),'orbit-adb-mock-'+process.pid),file=path.join(root,'adb');
test('Android tools issue real ADB commands, never arbitrary shell',async()=>{
 await fs.mkdir(root,{recursive:true});await fs.writeFile(file,`#!/bin/sh
case " $* " in
 *" devices "*) printf 'List of devices attached\\nXYZ123\\tdevice\\n';;
 *" getprop "*) echo 'Galaxy Test';;
 *" uiautomator dump "*) echo 'UI hierachy dumped';;
 *" cat /sdcard/orbit-ui.xml "*) echo '<hierarchy text="설정" bounds="[0,0][200,60]" />';;
 *" sha256sum "*) echo 'a';;
 *) echo 'Success';;
esac
`,{mode:0o755});process.env.ORBIT_ADB_PATH=file;
 try{
  assert.match(await runMobile('android_status',{}),/Galaxy Test/);
  assert.match(await runMobile('android_read_screen',{}),/hierarchy/);
  assert.match(await runMobile('android_tap',{x:100,y:200}),/터치/);
  await assert.rejects(()=>runMobile('android_type_text',{text:'123; rm -rf /'}),/ADB 입력/);
  await assert.rejects(()=>runMobile('android_open_app',{package:'com.app;bad'}),/패키지/);
  assert.equal(mobilePermissions.has('android_tap'),true);
 }finally{delete process.env.ORBIT_ADB_PATH;await fs.rm(root,{recursive:true,force:true});}
});
