import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {approve,pendingCount,isBusy,runAgent} from './agent.js';
import {store} from './store.js';
import {newCase,listCases,findCase,processTurn,callInfo,startCall,validateWebhook,twilioTurn,twilioStatus,adbDevices,adbDial,duplicatePhotos} from './negotiation.js';
import {getDashboard,getThread,receiveMessage,generateDraft,updateSettings,updateTask,sendReply,sendWhatsApp,verifyWhatsApp,whatsappChallenge,parseWhatsApp} from './inbox.js';
import {createJoinSession,sessionStatus,consumeJoinMessage,completeDemo,getOnboardingStats,onboardingConfig,isRegisteredWhatsApp,startSms,checkSms} from './onboarding.js';
import {isOwner,processOwnerTask,handleApproval,operatorConfig,operatorPending} from './operator.js';
import {saveConfig,loadConfig} from './config.js';
import {bootstrapConnectors,connectorSummary,updateConnectors} from './connectors.js';

const ROOT=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
const DIST=path.join(ROOT,'dist');
const PORT=4786;
await bootstrapConnectors();
const joinAttempts=new Map();
function joinAllowed(remote){const key=String(remote||'unknown');const now=Date.now();const recent=(joinAttempts.get(key)||[]).filter(t=>now-t<15*60*1000);if(recent.length>=5){joinAttempts.set(key,recent);return false;}recent.push(now);joinAttempts.set(key,recent);if(joinAttempts.size>1000)for(const [k,ts] of joinAttempts){if(ts.every(t=>now-t>15*60*1000))joinAttempts.delete(k);}return true;}
const types={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.ico':'image/x-icon','.png':'image/png'};
function json(res,status,obj) {res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(obj));}
async function rawBody(req,max=30000){const parts=[];let size=0;for await (const chunk of req){size+=chunk.length;if(size>max) throw new Error('요청 크기 초과');parts.push(chunk);}return Buffer.concat(parts).toString('utf8');}
async function body(req){return JSON.parse(await rawBody(req));}
function authorized(req) {
  const origin=req.headers.origin;
  const fromLocal=/^(::1|::ffff:127\.0\.0\.1|127\.0\.0\.1)$/.test(String(req.socket.remoteAddress));
  const localHost=/^(?:127\.0\.0\.1|localhost):4786$/.test(String(req.headers.host||''));
  const notProxied=!req.headers['x-forwarded-for']&&!req.headers['forwarded'];
  const localOrigin=!origin||/^http:\/\/(?:127\.0\.0\.1|localhost):(?:4786|5173)$/.test(origin);
  if(fromLocal&&localHost&&notProxied&&localOrigin&&req.headers['x-orbit-agent']==='1')return true;
  const pair=process.env.ORBIT_PAIRING_TOKEN;
  const matchingOrigin=!origin||origin===`http://${req.headers.host}`||origin===`https://${req.headers.host}`;
  if(pair&&pair.length>=12&&matchingOrigin&&req.headers['x-orbit-pairing']===pair&&req.headers['x-orbit-agent']==='1')return true;
  return false;
}
async function handle(req,res) {
  try {
    const url=new URL(req.url,'http://127.0.0.1:'+PORT);
    if(url.pathname==='/webhook/whatsapp') {
      if(req.method==='GET'){
        const challenge=whatsappChallenge(url.searchParams);
        if(challenge===null)return json(res,403,{error:'verification failed'});
        res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8'});res.end(challenge);return;
      }
      if(req.method!=='POST')return json(res,405,{error:'POST only'});
      const raw=await rawBody(req,180000);
      if(!verifyWhatsApp(raw,req.headers['x-hub-signature-256']))return json(res,403,{error:'signature invalid'});
      const messages=parseWhatsApp(JSON.parse(raw));
      const received=[];
      for(const msg of messages){
        const onboarding=await consumeJoinMessage({from:msg.sender,text:msg.text,messageId:msg.messageId});
        if(onboarding.consumed){
          if(onboarding.ok)void sendWhatsApp(onboarding.from,'Orbit 연결이 완료되었습니다! 이제 WhatsApp으로 필요한 일을 말씀해 주세요.').catch(e=>console.error('가입 환영 메시지 전송 실패:',e.message));
          continue;
        }
        // Never accept task messages from unregistered accounts.
        const registration=await isRegisteredWhatsApp(msg.sender);
        if(!registration)continue;
        if(/^(승인|거절)\s+[0-9a-f]{10}$/i.test(msg.text.trim())){
          void handleApproval(msg.sender,msg.text).then(cmd=>sendWhatsApp(msg.sender,cmd.reason||'승인 요청을 처리했습니다.')).catch(e=>console.error('승인 응답 실패:',e.message));continue;
        }
        received.push(await receiveMessage(msg));
      }
      json(res,200,{ok:true});
      // Respond immediately to Meta; any generation is tracked in the operator dashboard.
      const state=await getDashboard();
      if(state.settings.autoDraft)for(const item of received)if(item.taskId&&!item.duplicate){
        const thread=await getThread(item.threadId);
        if(await isOwner(thread?.sender))void processOwnerTask(item.taskId).catch(e=>console.error('소유자 작업 실패:',e.message));
        else void generateDraft(item.taskId).catch(e=>console.error('메시지 초안 실패:',e.message));
      }
      return;
    }
    if (url.pathname.startsWith('/twilio/')) {
      // Twilio webhooks are public endpoints and checked using the provider signature.
      if(req.method!=='POST')return json(res,405,{error:'POST only'});
      const found=url.pathname.match(/^\/twilio\/(voice|status)\/([\w-]+)$/);
      if(!found)return json(res,404,{error:'webhook not found'});
      const raw=await rawBody(req,10000);const form=Object.fromEntries(new URLSearchParams(raw));
      const canonical=(process.env.ORBIT_PUBLIC_URL||'').replace(/\/+$/,'')+url.pathname+url.search;
      if(!validateWebhook({id:found[2],token:url.searchParams.get('token'),url:canonical,form,signature:req.headers['x-twilio-signature']}))return json(res,403,{error:'Twilio signature invalid'});
      if(found[1]==='status'){await twilioStatus(found[2],form);return json(res,200,{ok:true});}
      const response=await twilioTurn({id:found[2],form});res.writeHead(200,{'Content-Type':'application/xml; charset=utf-8','Cache-Control':'no-store'});res.end(response);return;
    }
    // Customer onboarding never requires a separate installed app.
    if(req.method==='GET'&&(url.pathname==='/join'||url.pathname==='/join.html')){
      const data=await fs.readFile(path.join(ROOT,'public','join.html'));
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(data);return;
    }
    if(url.pathname==='/onboarding/config'&&req.method==='GET')return json(res,200,onboardingConfig());
    if(url.pathname==='/onboarding/session'&&req.method==='POST'){
      const origin=req.headers.origin;
      if(origin && origin!==`http://${req.headers.host}` && origin!==`https://${req.headers.host}`)return json(res,403,{error:'invalid origin'});
      if(!joinAllowed(req.socket.remoteAddress))return json(res,429,{error:'연결 요청이 너무 많습니다. 15분 뒤 다시 시도해 주세요.'});
      const data=await body(req);const item=await createJoinSession({phone:data.phone});return json(res,201,item);
    }
    if(url.pathname==='/onboarding/sms/start'&&req.method==='POST'){
      const origin=req.headers.origin;if(origin&&origin!==`http://${req.headers.host}`&&origin!==`https://${req.headers.host}`)return json(res,403,{error:'invalid origin'});
      if(!joinAllowed(req.socket.remoteAddress))return json(res,429,{error:'잠시 뒤 다시 시도하세요.'});
      const b=await body(req);return json(res,200,await startSms(b.id));
    }
    if(url.pathname==='/onboarding/sms/check'&&req.method==='POST'){
      const origin=req.headers.origin;if(origin&&origin!==`http://${req.headers.host}`&&origin!==`https://${req.headers.host}`)return json(res,403,{error:'invalid origin'});
      if(!joinAllowed(req.socket.remoteAddress))return json(res,429,{error:'인증 시도가 너무 많습니다.'});
      const b=await body(req);return json(res,200,await checkSms(b.id,b.code));
    }
    if(req.method==='GET'&&url.pathname.startsWith('/onboarding/session/')){
      const id=url.pathname.slice('/onboarding/session/'.length);
      if(!/^[0-9a-f-]{36}$/i.test(id))return json(res,400,{error:'invalid session'});
      const item=await sessionStatus(id);return json(res,item?200:404,item||{error:'not found'});
    }
    if(req.method==='GET'&&url.pathname.startsWith('/onboarding/qr/')){
      const id=url.pathname.slice('/onboarding/qr/'.length);
      const item=await sessionStatus(id);
      if(!item || item.status!=='awaiting_whatsapp')return json(res,404,{error:'QR unavailable'});
      const data=await (await import('./onboarding.js')).getJoinLink(id);
      if(!data)return json(res,404,{error:'QR link expired'});
      const qrcode=await import('qrcode');const svg=await qrcode.default.toString(data,{type:'svg',margin:2,width:320,errorCorrectionLevel:'M'});
      res.writeHead(200,{'Content-Type':'image/svg+xml; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'"});res.end(svg);return;
    }
    if (url.pathname.startsWith('/api/')) {
      if(!authorized(req)) return json(res,403,{error:'로컬 Orbit 화면에서만 접근 가능합니다.'});
      if(req.method==='GET'&&url.pathname==='/api/admin/state')return json(res,200,await getDashboard());
      if(req.method==='GET'&&url.pathname==='/api/admin/onboarding')return json(res,200,await getOnboardingStats());
      if(req.method==='GET'&&url.pathname==='/api/admin/operator')return json(res,200,{model:await operatorConfig(),approvals:await operatorPending()});
      if(req.method==='POST'&&url.pathname==='/api/admin/operator')return json(res,200,await saveConfig(await body(req)));
      if(req.method==='GET'&&url.pathname==='/api/admin/connectors')return json(res,200,connectorSummary());
      if(req.method==='POST'&&url.pathname==='/api/admin/connectors')return json(res,200,await updateConnectors(await body(req)));
      if(req.method==='POST'&&url.pathname==='/api/admin/onboarding/demo'){
        const b=await body(req);
        if(b.action==='create')return json(res,201,await createJoinSession({demo:true}));
        if(b.action==='complete')return json(res,200,await completeDemo(b.id));
        return json(res,400,{error:'invalid action'});
      }
      if(req.method==='GET'&&url.pathname.startsWith('/api/admin/threads/')){
        const thread=await getThread(url.pathname.split('/')[4]);return json(res,thread?200:404,thread||{error:'대화 없음'});
      }
      if(req.method==='POST'&&url.pathname==='/api/admin/operator/test'){
        const b=await body(req);const config=await loadConfig();if(!config.owner)throw Error('먼저 소유자 번호를 설정하세요.');
        const item=await receiveMessage({channel:'test',sender:String(config.owner).replace(/\D/g,''),text:b.text||''});
        if(item.taskId)void processOwnerTask(item.taskId).catch(e=>console.error('운영실 실험 실패:',e.message));
        return json(res,202,item);
      }
      if(req.method==='POST'&&url.pathname==='/api/admin/operator/approval'){
        const b=await body(req);const config=await loadConfig();return json(res,200,await handleApproval(String(config.owner||'').replace(/\D/g,''),String(b.action||'승인')+' '+String(b.code||'')));
      }
      if(req.method==='POST'&&url.pathname==='/api/admin/simulate'){
        const b=await body(req);
        const received=await receiveMessage({channel:'test',sender:String(b.sender||'owner-test'),text:b.text});
        const state=await getDashboard();
        if(state.settings.autoDraft&&received.taskId)void generateDraft(received.taskId);
        return json(res,201,received);
      }
      if(req.method==='POST'&&url.pathname==='/api/admin/send')return json(res,200,await sendReply(await body(req)));
      if(req.method==='POST'&&url.pathname==='/api/admin/settings')return json(res,200,await updateSettings(await body(req)));
      if(req.method==='POST'&&url.pathname==='/api/admin/task')return json(res,200,await updateTask(await body(req)));
      if(req.method==='POST'&&url.pathname==='/api/admin/draft'){
        const b=await body(req);const id=String(b.id||'');if(!id)return json(res,400,{error:'작업 ID 필요'});
        void generateDraft(id);return json(res,202,{ok:true});
      }
      if (req.method==='GET' && url.pathname==='/api/health') return json(res,200,{ok:true,busy:isBusy(),approvals:pendingCount(),platform:process.platform});
      if (req.method==='GET' && url.pathname==='/api/history') return json(res,200,{items:await store.history(),notes:await store.notes()});
      if (req.method==='GET' && url.pathname==='/api/models') {
        try {
          const host=url.searchParams.get('host') || 'http://127.0.0.1:11434';
          if (!/^http:\/\/(127\.0\.0\.1|localhost):\d{2,5}$/.test(host)) return json(res,400,{error:'로컬 Ollama만 조회할 수 있습니다.'});
          const response=await fetch(host+'/api/tags',{signal:AbortSignal.timeout(3500)});
          const data=await response.json();return json(res,200,{models:(data.models||[]).map(x=>x.name)});
        } catch {return json(res,200,{models:[],error:'Ollama가 실행 중이지 않거나 모델 목록을 불러오지 못했습니다.'});}
      }
      if(req.method==='GET'&&url.pathname==='/api/cases')return json(res,200,{cases:await listCases(),phone:callInfo()});
      if(req.method==='GET'&&url.pathname==='/api/android')return json(res,200,{devices:await adbDevices()});
      if(req.method==='GET'&&url.pathname.startsWith('/api/cases/')){
        const c=await findCase(url.pathname.split('/')[3]);return json(res,c?200:404,c||{error:'상담 없음'});
      }
      if(req.method==='POST'&&url.pathname==='/api/cases')return json(res,201,await newCase(await body(req)));
      if(req.method==='POST'&&url.pathname==='/api/cases/turn'){
        const b=await body(req);return json(res,200,{decision:await processTurn(b.id,b.heard,b.config)});
      }
      if(req.method==='POST'&&url.pathname==='/api/cases/call'){
        const b=await body(req);return json(res,200,await startCall(b.id,b.number,b.config));
      }
      if(req.method==='POST'&&url.pathname==='/api/android/dial'){
        const b=await body(req);return json(res,200,{result:await adbDial(b.number)});
      }
      if(req.method==='POST'&&url.pathname==='/api/photos/duplicates')return json(res,200,await duplicatePhotos());
      if(req.method==='POST' && url.pathname==='/api/approval') {
        const b=await body(req); return json(res,200,{ok:approve(b.id,b.allow===true)});
      }
      if(req.method==='POST' && url.pathname==='/api/clear') {
        if(isBusy()) return json(res,409,{error:'진행 중인 작업을 먼저 완료하세요.'});
        await store.clearHistory();return json(res,200,{ok:true});
      }
      if(req.method==='POST' && url.pathname==='/api/message') {
        if(isBusy()) return json(res,409,{error:'이전 작업이 아직 진행 중입니다.'});
        const b=await body(req);
        res.writeHead(200,{'Content-Type':'application/x-ndjson; charset=utf-8','Cache-Control':'no-cache, no-transform','X-Content-Type-Options':'nosniff'});
        const emit=x=>{if(!res.writableEnded&&!res.destroyed)res.write(JSON.stringify(x)+'\n');};
        try {await runAgent({text:b.text,config:b.config||{},emit});}
        catch(e) {emit({type:'error',text:String(e.message)});emit({type:'done'});}
        res.end();return;
      }
      return json(res,404,{error:'API not found'});
    }
    if(url.pathname==='/'||url.pathname==='/admin'||url.pathname==='/admin.html'){
      const data=await fs.readFile(path.join(ROOT,'public','admin.html'));
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(data);return;
    }
    if(url.pathname==='/phone'||url.pathname==='/phone.html'){
      const data=await fs.readFile(path.join(ROOT,'public','phone.html'));
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(data);return;
    }
    if(req.method!=='GET'&&req.method!=='HEAD') return json(res,405,{error:'Method Not Allowed'});
    const segment=decodeURIComponent(url.pathname);
    const file=path.resolve(DIST,'.'+segment);
    if(!(file===DIST||file.startsWith(DIST+path.sep))) return json(res,403,{error:'Forbidden'});
    let target=file;
    try {if((await fs.stat(file)).isDirectory())target=path.join(file,'index.html');}
    catch {target=path.join(DIST,'index.html');}
    let data;
    try {data=await fs.readFile(target);}catch{return json(res,404,{error:'먼저 npm run build를 실행하세요.'});}
    res.writeHead(200,{'Content-Type':types[path.extname(target)]||'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});
    res.end(data);
  } catch(e) {if(!res.headersSent)json(res,400,{error:String(e.message)});else res.end();}
}
const server=http.createServer((req,res)=>{void handle(req,res);});
server.listen(PORT,process.env.ORBIT_HOST==='0.0.0.0'?'0.0.0.0':'127.0.0.1',()=>{
  console.log(`\nOrbit 실행됨: http://127.0.0.1:${PORT}`);
  console.log(`메신저 비서 운영실: http://127.0.0.1:${PORT}/`);
  if(['1','phone'].includes(process.env.ORBIT_OPEN_BROWSER)) {
    const target=`http://127.0.0.1:${PORT}`+(process.env.ORBIT_OPEN_BROWSER==='phone'?'/phone':'');
    try {
      if(process.platform==='win32') {const p=spawn('explorer.exe',[target],{detached:true,stdio:'ignore'});p.unref();}
      else if(process.platform==='darwin') {const p=spawn('open',[target],{detached:true,stdio:'ignore'});p.unref();}
    } catch(e) {console.log('브라우저를 수동으로 열어주세요:',target);}
  }
});
