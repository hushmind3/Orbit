import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {approve,pendingCount,isBusy,runAgent} from './agent.js';
import {store} from './store.js';

const ROOT=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
const DIST=path.join(ROOT,'dist');
const PORT=4786;
const types={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.ico':'image/x-icon','.png':'image/png'};
function json(res,status,obj) {res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(obj));}
async function body(req) {const parts=[];let size=0;for await (const chunk of req){size+=chunk.length;if(size>30000) throw new Error('요청 크기 초과');parts.push(chunk);}return JSON.parse(Buffer.concat(parts).toString('utf8'));}
function authorized(req) {
  const origin=req.headers.origin;
  const local=!origin||/^http:\/\/(?:127\.0\.0\.1|localhost):(?:4786|5173)$/.test(origin);
  return local&&req.headers['x-orbit-agent']==='1';
}
async function handle(req,res) {
  try {
    const url=new URL(req.url,'http://127.0.0.1:'+PORT);
    if (url.pathname.startsWith('/api/')) {
      if(!authorized(req)) return json(res,403,{error:'로컬 Orbit 화면에서만 접근 가능합니다.'});
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
server.listen(PORT,'127.0.0.1',()=>{
  console.log(`\nOrbit 실행됨: http://127.0.0.1:${PORT}`);
  console.log(`문자·음성 명령, Windows 도구, Edge/Chrome 웹 조작 지원`);
  if(process.env.ORBIT_OPEN_BROWSER==='1') {
    const target=`http://127.0.0.1:${PORT}`;
    try {
      if(process.platform==='win32') {const p=spawn('explorer.exe',[target],{detached:true,stdio:'ignore'});p.unref();}
      else if(process.platform==='darwin') {const p=spawn('open',[target],{detached:true,stdio:'ignore'});p.unref();}
    } catch(e) {console.log('브라우저를 수동으로 열어주세요:',target);}
  }
});
