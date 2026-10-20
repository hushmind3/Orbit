/** Android device tools. ADB executes only fixed commands, never arbitrary shell from the model. */
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const run=promisify(execFile);
const repo=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
export function adbExecutable(){if(process.env.ORBIT_ADB_PATH)return process.env.ORBIT_ADB_PATH;const bin=path.join(repo,'.runtime','android-tools','platform-tools',process.platform==='win32'?'adb.exe':'adb');return fs.existsSync(bin)?bin:'adb';}
const adb=adbExecutable;
async function command(args,timeout=10000, maxBuffer=350000){
 const result=await run(adb(),args,{timeout,maxBuffer,windowsHide:true});
 return String(result.stdout||'').trim();
}
async function device(){
 const lines=(await command(['devices'],5000)).split(/\r?\n/).filter(s=>/\tdevice$/.test(s));
 if(lines.length!==1)throw Error('USB 디버깅을 허용한 안드로이드 기기를 정확히 1대 연결하세요.');
 return lines[0].split('\t')[0];
}
const bound=(x,min,max)=>{const n=Number(x);if(!Number.isInteger(n)||n<min||n>max)throw Error('화면 좌표 범위가 올바르지 않습니다.');return String(n);};
export const mobileDefinitions=[
 {name:'android_status',description:'USB로 연결한 Android 기기 상태 조회 (소유자 전용)',parameters:{type:'object',properties:{},required:[]}},
 {name:'android_read_screen',description:'Android 화면의 접근성 UI 텍스트 및 버튼 좌표 조사 (비밀번호와 개인 데이터 주의)',parameters:{type:'object',properties:{},required:[]}},
 {name:'android_open_app',description:'Android 앱을 패키지 이름으로 실행. 예: com.android.settings (승인 필요)',parameters:{type:'object',properties:{package:{type:'string'}},required:['package']}},
 {name:'android_tap',description:'Android 화면의 지정 좌표 터치. 승인 후 실행',parameters:{type:'object',properties:{x:{type:'integer'},y:{type:'integer'}},required:['x','y']}},
 {name:'android_swipe',description:'Android 화면 스와이프. 승인 후 실행',parameters:{type:'object',properties:{x1:{type:'integer'},y1:{type:'integer'},x2:{type:'integer'},y2:{type:'integer'},duration:{type:'integer'}},required:['x1','y1','x2','y2']}},
 {name:'android_back',description:'Android 뒤로가기. 승인 후 실행',parameters:{type:'object',properties:{},required:[]}},
 {name:'android_type_text',description:'Android 영어/숫자 입력(한글은 ADB 입력 한계). 승인 후 실행',parameters:{type:'object',properties:{text:{type:'string'}},required:['text']}},
 {name:'android_dial',description:'Android 전화 앱에 번호 입력. 자동 발신 아님 (승인 필요)',parameters:{type:'object',properties:{number:{type:'string'}},required:['number']}},
 {name:'android_vision_screen',description:'Android 화면 스크린샷을 외부 이미지 지원 AI 모델에 전달해 해석. 개인정보 외부 전송이므로 사용자 승인 필요',parameters:{type:'object',properties:{},required:[]}},
 {name:'android_duplicate_photos',description:'Android DCIM/Pictures에서 정확히 같은 파일의 SHA256 중복 후보 검사. 삭제 없음',parameters:{type:'object',properties:{},required:[]}}
];
export const mobilePermissions=new Set(['android_vision_screen','android_open_app','android_tap','android_swipe','android_back','android_type_text','android_dial']);
export async function runMobile(name,args={}){
 const serial=await device();const base=['-s',serial,'shell'];
 if(name==='android_status')return JSON.stringify({serial,model:await command([...base,'getprop','ro.product.model']),connection:'device'});
 if(name==='android_read_screen'){
  await command([...base,'uiautomator','dump','/sdcard/orbit-ui.xml'],20000);
  const xml=await command([...base,'cat','/sdcard/orbit-ui.xml'],10000,450000);
  return xml.slice(0,26000);
 }
 if(name==='android_open_app'){
  const p=String(args.package||'').trim();if(!/^[A-Za-z][A-Za-z\d_]*(?:\.[A-Za-z][A-Za-z\d_]*){1,12}$/.test(p))throw Error('Android 앱 패키지 이름이 올바르지 않습니다.');
  return (await command([...base,'monkey','-p',p,'-c','android.intent.category.LAUNCHER','1'],11000)).slice(0,500);
 }
 if(name==='android_tap') {await command([...base,'input','tap',bound(args.x,0,9999),bound(args.y,0,9999)]);return '요청한 화면 좌표를 터치했습니다. 다음 화면을 다시 읽어 결과를 확인하세요.';}
 if(name==='android_swipe'){
  const vals=['x1','y1','x2','y2'].map(k=>bound(args[k],0,9999));const dur=bound(args.duration??450,100,2500);
  await command([...base,'input','swipe',...vals,dur]);return '스와이프 명령을 실행했습니다. 다음 화면을 읽어 결과를 확인하세요.';
 }
 if(name==='android_back'){await command([...base,'input','keyevent','KEYCODE_BACK']);return '뒤로가기 키를 전송했습니다.';}
 if(name==='android_type_text'){
  const t=String(args.text||'');if(!t||t.length>160||!/^[A-Za-z0-9 @._+/%-]+$/.test(t))throw Error('기본 ADB 입력은 영어, 숫자 및 ASCII 문자만 지원합니다.');
  const escaped=t.replace(/%/g,'%25').replace(/ /g,'%s');await command([...base,'input','text',escaped]);return '입력 명령을 전송했습니다.';
 }
 if(name==='android_dial'){
  const n=String(args.number||'').replace(/[\s-]/g,'');if(!/^\+?[\d*#]{3,25}$/.test(n))throw Error('전화번호가 올바르지 않습니다.');
  await command([...base,'am','start','-a','android.intent.action.DIAL','-d','tel:'+n]);return '전화 다이얼러를 열었습니다. 발신 버튼은 누르지 않았습니다.';
 }
 if(name==='android_duplicate_photos'){
  // Android-side hashes avoid transferring entire photos. Limited to the first 200 images.
  const script=`find /sdcard/DCIM /sdcard/Pictures -type f \\( -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.png' -o -iname '*.webp' -o -iname '*.heic' \\) 2>/dev/null | head -n 200 | while IFS= read -r f; do sha256sum "$f" 2>/dev/null; done`;
  const result=await command([...base,'sh','-c',script],115000,110000);
  const groups=new Map();let scanned=0;
  for(const line of result.split(/\r?\n/)){
   const m=/^([0-9a-f]{64})\s+(.+)$/.exec(line);if(!m)continue;scanned++;const list=groups.get(m[1])||[];list.push(m[2]);groups.set(m[1],list);
  }
  return JSON.stringify({scanned,limit:200,groups:[...groups.values()].filter(v=>v.length>1),note:'같은 바이트의 사진만 검색했습니다. 미디어 삭제·수정은 수행하지 않았습니다.'});
 }
 throw Error('허용되지 않은 Android 명령입니다.');
}

/** One-time screen interpretation by a vision-capable model. Explicit user permission is required
 * because the screenshot leaves the Android device and may contain personal information. */
export async function inspectMobileVision(config){
 const serial=await device();const base=String(config?.base||'').replace(/\/+$/,'');
 if(!base||!config?.model)throw Error('비전 기능을 지원하는 모델 연결이 필요합니다.');
 if(config.provider==='ollama')throw Error('Android 이미지 해석은 현재 OpenAI 호환 멀티모달 API를 선택해야 합니다.');
 const {stdout}=await run(adb(),['-s',serial,'exec-out','screencap','-p'],{timeout:12000,maxBuffer:8500000,encoding:'buffer',windowsHide:true});
 const buf=Buffer.from(stdout);if(buf.length<100||buf.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw Error('ADB 화면 캡처가 실패했습니다.');
 if(buf.length>5500000)throw Error('휴대폰 캡처가 너무 큽니다.');
 const messages=[{role:'user',content:[{type:'text',text:'Android 화면의 버튼, 현재 상태와 다음 조작에 사용할 좌표를 한국어로 간결하게 설명하세요. 화면에 보이지 않는 내용을 추측하지 마세요.'},{type:'image_url',image_url:{url:'data:image/png;base64,'+buf.toString('base64')}}]}];
 const headers={'Content-Type':'application/json'};if(config.key)headers.Authorization='Bearer '+config.key;
 const response=await fetch(base+'/chat/completions',{method:'POST',headers,body:JSON.stringify({model:config.visionModel||config.model,messages,max_tokens:650,stream:false}),signal:AbortSignal.timeout(60000)});
 const j=await response.json().catch(()=>({}));if(!response.ok)throw Error('이미지 모델 API 오류 '+response.status+': '+String(j.error?.message||'').slice(0,180));
 const result=j.choices?.[0]?.message?.content;if(!result)throw Error('모델이 화면을 인식하지 못했습니다. 비전 지원 모델인지 확인하세요.');
 return String(result).slice(0,9000);
}
