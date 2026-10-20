/** Optional single-command installer of Google's official Android Platform Tools. */
import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const run=promisify(execFile);
const root=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
const platform={win32:'windows',darwin:'darwin',linux:'linux'}[process.platform];
if(!platform)throw Error('지원하지 않는 PC 운영체제입니다.');
const base=path.join(root,'.runtime');const target=path.join(base,'android-tools');const archive=path.join(base,'platform-tools.zip');
const bin=path.join(target,'platform-tools',process.platform==='win32'?'adb.exe':'adb');
try{await fs.access(bin);console.log('이미 설치된 ADB:',bin);process.exit(0);}catch{}
await fs.mkdir(base,{recursive:true});
const url=`https://dl.google.com/android/repository/platform-tools-latest-${platform}.zip`;
console.log('Google 공식 Android Platform Tools 다운로드:',url);
const r=await fetch(url,{signal:AbortSignal.timeout(90000)});if(!r.ok)throw Error('다운로드 오류 HTTP '+r.status);
let size=0;const chunks=[];for await(const chunk of r.body){size+=chunk.length;if(size>65000000)throw Error('다운로드 용량 한도 초과');chunks.push(chunk);}
await fs.writeFile(archive,Buffer.concat(chunks));await fs.mkdir(target,{recursive:true});
try{
 if(process.platform==='win32')await run('powershell.exe',['-NoProfile','-Command',`Expand-Archive -LiteralPath '${archive.replaceAll("'","''")}' -DestinationPath '${target.replaceAll("'","''")}' -Force`],{timeout:50000});
 else await run('unzip',['-oq',archive,'-d',target],{timeout:50000});
 await fs.access(bin);if(process.platform!=='win32')await fs.chmod(bin,0o755);
 console.log('Android Platform Tools 준비 완료:',bin);
 console.log('휴대폰에서 개발자 옵션 → USB 디버깅을 켜고 USB 연결을 승인하세요.');
}finally{await fs.rm(archive,{force:true});}
