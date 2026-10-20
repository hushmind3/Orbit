import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

const HOME = os.homedir();
const BASES = ['Desktop', 'Documents', 'Downloads'];
const RUNTIME = path.resolve(process.cwd(), '.runtime');
const safety = (input) => {
  if (typeof input !== 'string' || input.length > 700 || input.includes('\0')) throw new Error('경로가 올바르지 않습니다.');
  const normalized = input.replace(/^~(?=[\\/]|$)/, HOME);
  const p = path.resolve(HOME, normalized);
  const allowed = BASES.map(d => path.resolve(HOME, d));
  if (!allowed.some(root => p === root || p.startsWith(root + path.sep))) throw new Error('데스크톱/문서/다운로드 폴더 내에서만 접근할 수 있습니다.');
  return p;
};

async function safeExistingPath(file) {
  const original = safety(file);
  const canonical = await fs.realpath(original);
  const roots = await Promise.all(BASES.map(async name => {
    try { return await fs.realpath(path.join(HOME,name)); }
    catch { return path.join(HOME,name); }
  }));
  if (!roots.some(root => canonical === root || canonical.startsWith(root+path.sep))) throw new Error('링크를 통한 외부 폴더 접근은 허용하지 않습니다.');
  return canonical;
}
async function safeWritablePath(file) {
  const target = safety(file);
  const parent = await safeExistingPath(path.dirname(target));
  return path.join(parent,path.basename(target));
}

async function scanTree(base, query, limit=20, depth=2) {
  const found = [];
  async function visit(dir, level) {
    if (level > depth || found.length >= limit) return;
    let entries = [];
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const ent of entries) {
      if (found.length >= limit) break;
      if (ent.name.startsWith('.') || ent.isSymbolicLink()) continue;
      const file = path.join(dir, ent.name);
      if (ent.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())) found.push(file);
      if (ent.isDirectory()) await visit(file, level + 1);
    }
  }
  await visit(base,0);
  return found;
}

let browserContext;
let browserPage;
async function page() {
  if (process.platform === 'linux' && !process.env.DISPLAY) throw new Error('화면이 없는 환경에서는 브라우저를 실행할 수 없습니다.');
  if (!browserContext) {
    let chromium;
    try { ({ chromium } = await import('playwright-core')); }
    catch { throw new Error('Playwright가 설치되지 않았습니다. npm install을 실행하세요.'); }
    await fs.mkdir(RUNTIME, { recursive: true });
    let lastError;
    for (const channel of ['msedge','chrome']) {
      try {
        browserContext = await chromium.launchPersistentContext(path.join(RUNTIME,'browser-profile'),{
          channel, headless:false, acceptDownloads:false, viewport:null,
          args:['--no-first-run','--no-default-browser-check']
        });
        break;
      } catch (e) { lastError = e; }
    }
    if (!browserContext) throw new Error(`Edge 또는 Chrome 실행 실패: ${String(lastError?.message || lastError).slice(0,200)}`);
    browserContext.on('close', () => { browserContext = undefined; browserPage = undefined; });
    browserPage = browserContext.pages()[0] || await browserContext.newPage();
  }
  if (!browserPage || browserPage.isClosed()) browserPage = await browserContext.newPage();
  return browserPage;
}

const appNames = {
  '메모장': 'notepad.exe', 'notepad': 'notepad.exe',
  '계산기': 'calc.exe', 'calculator': 'calc.exe',
  '탐색기': 'explorer.exe', 'explorer': 'explorer.exe',
  '그림판': 'mspaint.exe', 'paint': 'mspaint.exe'
};
const validUrl = (url) => {
  let u;
  try { u = new URL(url); } catch { throw new Error('올바른 웹 주소를 지정하세요.'); }
  if (!['https:','http:'].includes(u.protocol)) throw new Error('http/https 웹 주소만 사용할 수 있습니다.');
  if (/^(localhost|127\.|0\.|169\.254\.|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(u.hostname)) throw new Error('로컬·사설망 접근은 차단됩니다.');
  return u.href;
};
const str = (obj,key,limit=500) => {
  if (typeof obj?.[key] !== 'string' || obj[key].trim().length === 0 || obj[key].length > limit) throw new Error(`${key} 값을 확인하세요.`);
  return obj[key].trim();
};

export const definitions = [
  {name:'open_app',description:'Windows에서 메모장, 계산기, 파일 탐색기, 그림판 프로그램을 실행',parameters:{type:'object',properties:{name:{type:'string',description:'메모장, 계산기, 탐색기, 그림판 중 하나'}},required:['name']}},
  {name:'list_files',description:'내 PC의 Desktop, Documents, Downloads 폴더에 있는 파일 및 하위 폴더 목록',parameters:{type:'object',properties:{folder:{type:'string',description:'예: ~/Downloads 또는 Documents'}},required:['folder']}},
  {name:'search_files',description:'내 PC 바탕화면/문서/다운로드 폴더에서 파일 이름 검색',parameters:{type:'object',properties:{query:{type:'string'}},required:['query']}},
  {name:'read_text_file',description:'내 PC에서 텍스트 파일 내용을 읽음',parameters:{type:'object',properties:{file:{type:'string'}},required:['file']}},
  {name:'write_text_file',description:'내 PC에 txt/md/csv/json 텍스트 파일 생성 또는 수정; 실행 전 사용자 승인 필요',parameters:{type:'object',properties:{file:{type:'string'},content:{type:'string'},overwrite:{type:'boolean'}},required:['file','content']}},
  {name:'browser_open',description:'브라우저 창에서 웹사이트 또는 구글 검색 결과 열기',parameters:{type:'object',properties:{url:{type:'string',description:'http 또는 https로 시작하는 주소'}},required:['url']}},
  {name:'browser_search',description:'브라우저에서 웹 검색 수행',parameters:{type:'object',properties:{query:{type:'string'}},required:['query']}},
  {name:'browser_read',description:'현재 열린 웹페이지 글과 주요 버튼·링크·입력창 정보 읽기',parameters:{type:'object',properties:{},required:[]}},
  {name:'browser_click',description:'현재 웹페이지 버튼이나 링크 클릭 (사용자 승인 후)',parameters:{type:'object',properties:{text:{type:'string',description:'화면에 보이는 버튼/링크 텍스트'},selector:{type:'string',description:'선택자(알 때만)'}},required:[]}},
  {name:'browser_fill',description:'웹페이지 입력칸에 문자 입력 (사용자 승인 후)',parameters:{type:'object',properties:{selector:{type:'string'},label:{type:'string'},value:{type:'string'}},required:['value']}},
  {name:'browser_press',description:'현재 웹페이지에서 지정된 키 누름 (사용자 승인 후)',parameters:{type:'object',properties:{key:{type:'string',enum:['Enter','Tab','Escape','ArrowDown','ArrowUp']}},required:['key']}},
  {name:'remember',description:'앞으로 대화에도 남길 중요 정보를 메모장에 저장 (사용자 승인 후)',parameters:{type:'object',properties:{note:{type:'string'}},required:['note']}}
];
export const permissionRequired = new Set(['browser_click','browser_fill','browser_press','write_text_file','remember']);
export const toolMap = Object.fromEntries(definitions.map(x => [x.name,x]));

export async function runTool(name, args, { store }) {
  if (!toolMap[name]) throw new Error('허용되지 않은 작업입니다.');
  const a = args && typeof args === 'object' && !Array.isArray(args) ? args : {};
  switch (name) {
    case 'open_app': {
      if (process.platform !== 'win32') throw new Error('앱 실행은 Windows에서 지원합니다.');
      const app = appNames[str(a,'name',40).toLocaleLowerCase()];
      if (!app) throw new Error('이 버전은 메모장/계산기/탐색기/그림판만 실행합니다.');
      const proc = spawn(app,[],{detached:true,stdio:'ignore',windowsHide:false});
      proc.on('error',() => {}); proc.unref();
      return `${a.name} 실행을 요청했습니다.`;
    }
    case 'list_files': {
      const folder = await safeExistingPath(str(a,'folder',700));
      const entries = await fs.readdir(folder,{withFileTypes:true});
      const items = await Promise.all(entries.filter(e => !e.isSymbolicLink()).slice(0,70).map(async e => {
        const full = path.join(folder,e.name);
        try { const s = await fs.stat(full); return { name:e.name, type:e.isDirectory()?'폴더':'파일', bytes:s.size, modified:s.mtime.toISOString() }; }
        catch {return {name:e.name};}
      }));
      return JSON.stringify({folder,items},null,2);
    }
    case 'search_files': {
      const query = str(a,'query',100); const matches=[];
      for (const root of BASES) matches.push(...await scanTree(path.join(HOME,root),query,20,2));
      return JSON.stringify(matches.slice(0,30));
    }
    case 'read_text_file': {
      const file = await safeExistingPath(str(a,'file',700));
      const ext=path.extname(file).toLowerCase();
      if (!['.txt','.md','.csv','.json','.log','.yaml','.yml','.js','.ts','.tsx','.py','.html','.css'].includes(ext)) throw new Error('텍스트 파일만 읽을 수 있습니다.');
      const stat = await fs.stat(file);
      if (stat.size > 100000) throw new Error('100KB 이하 파일만 읽을 수 있습니다.');
      return (await fs.readFile(file,'utf8')).slice(0,20000);
    }
    case 'write_text_file': {
      const file = await safeWritablePath(str(a,'file',700)); const content=str(a,'content',30000);
      const ext=path.extname(file).toLowerCase();
      if (!['.txt','.md','.csv','.json'].includes(ext)) throw new Error('txt/md/csv/json 파일만 저장할 수 있습니다.');
      await fs.writeFile(file,content,{flag:a.overwrite === true?'w':'wx'});
      return `저장 완료: ${file} (${Buffer.byteLength(content)} bytes)`;
    }
    case 'browser_open': {
      const url = validUrl(str(a,'url',2000));
      const p=await page(); await p.goto(url,{waitUntil:'domcontentloaded',timeout:22000});
      return `${p.url()} 열었습니다. 제목: ${await p.title()}`;
    }
    case 'browser_search': {
      const q=str(a,'query',250);const p=await page();
      await p.goto('https://www.google.com/search?q='+encodeURIComponent(q),{waitUntil:'domcontentloaded',timeout:22000});
      return `검색 완료: ${q}\n${(await p.locator('body').innerText({timeout:8000})).slice(0,4000)}`;
    }
    case 'browser_read': {
      const p=await page();
      const data=await p.evaluate(() => ({
        title:document.title,url:location.href,text:(document.body?.innerText || '').slice(0,8000),
        controls:[...document.querySelectorAll('a,button,input,textarea')].slice(0,65).map(el=>({
          tag:el.tagName.toLowerCase(),text:(el.innerText||el.getAttribute('aria-label')||'').trim().slice(0,70),
          placeholder:el.getAttribute('placeholder'),href:el.tagName==='A'?el.getAttribute('href'):undefined
        }))
      }));
      return JSON.stringify(data).slice(0,15000);
    }
    case 'browser_click': {
      const p=await page();
      if (typeof a.selector==='string' && a.selector.trim()) await p.locator(a.selector).first().click({timeout:10000});
      else if (typeof a.text==='string' && a.text.trim()) await p.getByText(a.text,{exact:false}).first().click({timeout:10000});
      else throw new Error('클릭할 버튼 텍스트 또는 CSS 선택자가 필요합니다.');
      return `클릭 완료. 현재 URL: ${p.url()}`;
    }
    case 'browser_fill': {
      const p=await page();const value=str(a,'value',3000);
      if (typeof a.selector === 'string' && a.selector.trim()) await p.locator(a.selector).first().fill(value,{timeout:10000});
      else if (typeof a.label === 'string' && a.label.trim()) await p.getByLabel(a.label,{exact:false}).first().fill(value,{timeout:10000});
      else throw new Error('입력창 선택자 또는 이름이 필요합니다.');
      return `입력 완료 (${value.length}자).`;
    }
    case 'browser_press': {
      const key=str(a,'key',30);
      if (!['Enter','Tab','Escape','ArrowDown','ArrowUp'].includes(key)) throw new Error('허용하지 않는 키입니다.');
      await (await page()).keyboard.press(key);
      return `${key} 키를 눌렀습니다.`;
    }
    case 'remember': {
      const note=str(a,'note',1200);
      await store.addNote(note);
      return '다음 대화에도 남도록 기억했습니다.';
    }
    default: throw new Error('등록되지 않은 명령');
  }
}

export { safety, validUrl, scanTree };

/** Inspect visible browser controls instead of treating all clicks as dangerous. */
export async function inspectBrowserTarget(name,args={}){
 const p=await page();
 let locator;
 if(name==='browser_click')locator=typeof args.selector==='string'&&args.selector.trim()?p.locator(args.selector).first():p.getByText(String(args.text||''),{exact:false}).first();
 if(name==='browser_press')locator=p.locator(':focus');
 const label=locator?await locator.evaluate(el=>[
  el.innerText||'',el.getAttribute('aria-label')||'',el.getAttribute('title')||'',el.getAttribute('value')||'',el.getAttribute('type')||''
 ].join(' ').slice(0,400)).catch(()=>''):'';
 const context=await p.locator('body').innerText({timeout:3000}).then(t=>t.slice(0,5000)).catch(()=>'');
 return {label:label||String(args.text||args.selector||args.key||''),context};
}
