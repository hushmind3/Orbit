import React, {useCallback,useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ArrowUp, Bot, Check, ChevronRight, CircleHelp, Cpu, FolderOpen, Globe, LoaderCircle, MessageCircle, Mic, Monitor, PanelRightClose, PanelRightOpen, RotateCcw, Settings2, ShieldCheck, Sparkles, Volume2, VolumeX, X, Zap} from 'lucide-react';
import './style.css';

type Config={provider:'ollama'|'openai';base:string;model:string;key:string};
type Message={id:string;role:'user'|'assistant';text:string;time?:string};
type Activity={id:string;type:'status'|'tool_result'|'error';text:string;tool?:string;args?:unknown};
type Approval={id:string;tool:string;args:Record<string,unknown>;answered?:boolean};
type Event={type:'status'|'tool_result'|'approval'|'answer'|'done'|'error';id?:string;tool?:string;text?:string;args?:Record<string,unknown>;result?:string};
type SpeechEvent={results: ArrayLike<{isFinal:boolean;0:{transcript:string}}>};
type Recognizer={lang:string;continuous:boolean;interimResults:boolean;onresult:((e:SpeechEvent)=>void)|null;onerror:((e:{error:string})=>void)|null;onend:(()=>void)|null;start:()=>void;stop:()=>void;};
const getSpeechCtor=()=> (window as unknown as {webkitSpeechRecognition?:new()=>Recognizer;SpeechRecognition?:new()=>Recognizer}).SpeechRecognition ?? (window as unknown as {webkitSpeechRecognition?:new()=>Recognizer}).webkitSpeechRecognition;
const HEADERS={'Content-Type':'application/json','X-Orbit-Agent':'1'};
const DEFAULT:Config={provider:'ollama',base:'http://127.0.0.1:11434',model:'qwen3:4b',key:''};
function loadConfig():Config {try { const saved=sessionStorage.getItem('orbit-settings');return saved?{...DEFAULT,...JSON.parse(saved)}:DEFAULT;}catch{return DEFAULT;}}
const templates=[
 {title:'웹에서 찾아줘',prompt:'구글에서 오늘 AI 에이전트 관련 최신 뉴스를 찾아서 제목을 읽어줘.',icon:Globe},
 {title:'파일 정리 확인',prompt:'내 다운로드 폴더에 있는 파일 목록과 최근 수정한 파일을 알려줘.',icon:FolderOpen},
 {title:'프로그램 실행',prompt:'Windows 메모장 열어줘.',icon:Monitor},
 {title:'정보 기억',prompt:'내가 말하는 내용을 앞으로 기억해 둬.',icon:Sparkles}
];
const toolNames:Record<string,string>={open_app:'프로그램 실행',list_files:'폴더 탐색',search_files:'파일 검색',read_text_file:'파일 읽기',write_text_file:'파일 저장',browser_open:'웹사이트 열기',browser_search:'웹 검색',browser_read:'웹 내용 읽기',browser_click:'웹 요소 클릭',browser_fill:'웹 입력',browser_press:'키 입력',remember:'장기 기억 저장'};
function toText(v:unknown) {if(v==null)return '';if(typeof v==='string')return v;return JSON.stringify(v,null,2);}
const short=(value:string,max=200)=>value.length<=max?value:value.slice(0,max)+'…';

function App(){
 const [config,setConfig]=useState<Config>(loadConfig);
 const [settings,setSettings]=useState(false);
 const [input,setInput]=useState('');
 const [messages,setMessages]=useState<Message[]>([]);
 const [activities,setActivities]=useState<Activity[]>([]);
 const [approval,setApproval]=useState<Approval|null>(null);
 const [busy,setBusy]=useState(false);
 const [speaking,setSpeaking]=useState(false);
 const [voiceOn,setVoiceOn]=useState(false);
 const [autoSpeak,setAutoSpeak]=useState(false);
 const [sideOpen,setSideOpen]=useState(true);
 const [models,setModels]=useState<string[]>([]);
 const [modelsError,setModelsError]=useState('');
 const [serverOnline,setServerOnline]=useState(false);
 const bottomRef=useRef<HTMLDivElement|null>(null);
 const inputRef=useRef<HTMLTextAreaElement|null>(null);
 const activeSpeech=useRef<Recognizer|null>(null);
 const busyRef=useRef(false);
 useEffect(()=>{sessionStorage.setItem('orbit-settings',JSON.stringify(config));},[config]);
 useEffect(()=>{bottomRef.current?.scrollIntoView({behavior:'smooth'});},[messages,activities,approval,busy]);
 useEffect(()=>{
  let cancelled=false;
  void fetch('/api/history',{headers:{'X-Orbit-Agent':'1'}}).then(r=>r.json()).then(data=>{
    if(!cancelled){setMessages((data.items||[]).map((m:{role:'user'|'assistant';content:string;time:string},i:number)=>({id:'history-'+i,role:m.role,text:m.content,time:m.time})));setServerOnline(true);}
  }).catch(()=>setServerOnline(false));
  return ()=>{cancelled=true;};
 },[]);
 const readAloud=useCallback((text:string)=>{
  if(!window.speechSynthesis)return;
  window.speechSynthesis.cancel();
  const utterance=new SpeechSynthesisUtterance(text.replace(/[*#`]/g,''));utterance.lang='ko-KR';utterance.rate=1.05;
  utterance.onstart=()=>setSpeaking(true);utterance.onend=()=>setSpeaking(false);utterance.onerror=()=>setSpeaking(false);
  window.speechSynthesis.speak(utterance);
 },[]);
 const send=useCallback(async(raw:string)=>{
  const text=raw.trim();if(!text||busyRef.current)return;
  busyRef.current=true;setBusy(true);setInput('');setApproval(null);setActivities([]);
  setMessages(prev=>[...prev,{id:crypto.randomUUID(),role:'user',text}]);
  try {
    const response=await fetch('/api/message',{method:'POST',headers:HEADERS,body:JSON.stringify({text,config})});
    if(!response.ok){const err=await response.json().catch(()=>({error:'서버 오류'}));throw new Error(err.error||`서버 응답 ${response.status}`);}
    if(!response.body)throw new Error('스트리밍을 지원하지 않는 환경입니다.');
    const reader=response.body.getReader();const decoder=new TextDecoder();let buffer='';
    const onEvent=(event:Event)=>{
      if(event.type==='status')setActivities(prev=>[...prev,{id:crypto.randomUUID(),type:'status',text:event.text||'',args:event.args}].slice(-25));
      if(event.type==='tool_result')setActivities(prev=>[...prev,{id:crypto.randomUUID(),type:'tool_result',text:event.result||'',tool:event.tool}].slice(-25));
      if(event.type==='approval'&&event.id&&event.tool)setApproval({id:event.id,tool:event.tool,args:event.args||{}});
      if(event.type==='error')setActivities(prev=>[...prev,{id:crypto.randomUUID(),type:'error',text:event.text||'오류'}]);
      if(event.type==='answer') {
        const reply=event.text||'';
        setMessages(prev=>[...prev,{id:crypto.randomUUID(),role:'assistant',text:reply}]);
        if(autoSpeak)readAloud(reply);
      }
    };
    while(true){const {value,done}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});
      while(buffer.includes('\n')){const index=buffer.indexOf('\n');const line=buffer.slice(0,index).trim();buffer=buffer.slice(index+1);if(line){try{onEvent(JSON.parse(line));}catch{}}}
    }
    if(buffer.trim()){try{onEvent(JSON.parse(buffer));}catch{}}
  }catch(err){setActivities(prev=>[...prev,{id:crypto.randomUUID(),type:'error',text:err instanceof Error?err.message:'알 수 없는 오류'}]);}
  finally {busyRef.current=false;setBusy(false);setApproval(null);inputRef.current?.focus();}
 },[config,autoSpeak,readAloud]);
 const toggleVoice=()=>{
  if(voiceOn){activeSpeech.current?.stop();setVoiceOn(false);return;}
  const Ctor=getSpeechCtor();
  if(!Ctor){setActivities(prev=>[...prev,{id:crypto.randomUUID(),type:'error',text:'이 브라우저는 음성 인식을 지원하지 않습니다. Edge/Chrome을 이용하거나 Windows Win+H 음성 입력을 사용하세요.'}]);return;}
  try {
    const recognition=new Ctor();activeSpeech.current=recognition;recognition.lang='ko-KR';recognition.continuous=false;recognition.interimResults=true;
    let sent=false;
    recognition.onresult=e=>{
      let final='';let interim='';
      for(let i=0;i<e.results.length;i++){const result=e.results[i];if(result.isFinal)final+=result[0].transcript;else interim+=result[0].transcript;}
      if(final.trim()&&!sent){sent=true;setInput(final);recognition.stop();void send(final);}
      else if(!sent)setInput(interim);
    };
    recognition.onerror=e=>{if(e.error!=='no-speech')setActivities(prev=>[...prev,{id:crypto.randomUUID(),type:'error',text:`마이크 오류: ${e.error}. 브라우저 권한을 확인하세요.`}]);setVoiceOn(false);};
    recognition.onend=()=>{setVoiceOn(false);activeSpeech.current=null;};
    recognition.start();setVoiceOn(true);
  }catch(err){setVoiceOn(false);setActivities(prev=>[...prev,{id:crypto.randomUUID(),type:'error',text:String(err)}]);}
 };
 const respondApproval=async(allowed:boolean)=>{
   if(!approval||approval.answered)return;
   const id=approval.id;setApproval({...approval,answered:true});
   try{
     // All approvals are now ordinary assistant messages handled by the same work engine.
     // Never call the removed /api/approval endpoint.
     await send(`${allowed?'승인':'거절'} ${id}`);
   }catch(err){setActivities(prev=>[...prev,{id:crypto.randomUUID(),type:'error',text:String(err)}]);}
   finally{setApproval(null);}
 };
 const fetchModels=async()=>{
   setModelsError('');
   try{const r=await fetch('/api/models?host='+encodeURIComponent(config.provider==='ollama'?config.base:'http://127.0.0.1:11434'),{headers:{'X-Orbit-Agent':'1'}});
     const data=await r.json();setModels(data.models||[]);if(data.error)setModelsError(data.error);
   }catch{setModelsError('모델 목록을 확인할 수 없습니다.');}
 };
 const clear=async()=>{
   if(busy)return;
   try{const r=await fetch('/api/clear',{method:'POST',headers:HEADERS,body:'{}'});if(!r.ok)throw new Error();setMessages([]);setActivities([]);}
   catch{setActivities(prev=>[...prev,{id:crypto.randomUUID(),type:'error',text:'대화 기록을 지우지 못했습니다.'}]);}
 };
 const handleKey=(e:React.KeyboardEvent<HTMLTextAreaElement>)=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();void send(input);}};
 return <div className="app">
  <aside className="navrail">
   <div className="mark"><Sparkles size={25} strokeWidth={2.4}/></div>
   <div className="navbuttons"><button className="navbutton active" title="대화"><MessageCircle size={22}/></button><button className="navbutton" title="전화 협상 비서" onClick={()=>{window.location.href='/phone';}}><Bot size={21}/></button><button className="navbutton" title="기록 초기화" disabled={busy} onClick={()=>void clear()}><RotateCcw size={20}/></button><button className="navbutton" title="설정" onClick={()=>setSettings(true)}><Settings2 size={21}/></button></div>
   <div className="navbottom"><div className={'statusdot '+(serverOnline?'online':'offline')}/><span>LOCAL</span></div>
  </aside>
  <main className="mainpanel">
    <header className="topbar">
      <div className="identity"><span className="tiny-eye">◉</span> <span>ORBIT</span><span className="beta">BETA 0.1</span></div>
      <div className="topactions"><span className="model-chip"><span className="greenpulse"/>{config.model}</span><button className="iconbutton mobile-hide" title={autoSpeak?'음성 답변 끄기':'음성 답변 켜기'} onClick={()=>{setAutoSpeak(!autoSpeak);window.speechSynthesis?.cancel();}}>{autoSpeak?<Volume2 size={18}/>:<VolumeX size={18}/>}</button><button className="iconbutton" title="도구 패널" onClick={()=>setSideOpen(!sideOpen)}>{sideOpen?<PanelRightClose size={20}/>:<PanelRightOpen size={20}/>}</button></div>
    </header>
    <section className="content">
      {messages.length===0 ? <div className="welcome">
        <div className="hero-symbol"><span className="hero-inner"><Sparkles size={38}/></span></div>
        <p className="eyebrow">YOUR PERSONAL OPERATOR</p>
        <h1>말씀만 하세요.<br/><span>나머지는 제가 합니다.</span></h1>
        <p className="lead">검색에서 실행까지. 메모장 열기, 파일 찾기, 웹 탐색을<br className="mobile-hide"/> 이제 음성이나 문자로 명령하세요.</p>
        <div className="suggestions">{templates.map(t=><button key={t.title} className="suggestion" onClick={()=>void send(t.prompt)}><t.icon size={19}/><span>{t.title}</span><ChevronRight size={16} className="suggest-arrow"/></button>)}</div>
      </div>:<div className="thread">{messages.map(m=><div className={'message '+m.role} key={m.id}>
        <div className="avatar">{m.role==='assistant'?<Sparkles size={19}/>:<span>나</span>}</div>
        <div className="bubble"><div className="msglabel">{m.role==='assistant'?'ORBIT':'ME'}</div><p>{m.text}</p>{m.role==='assistant'&&<button className="hear" onClick={()=>readAloud(m.text)} title="답변 음성 재생"><Volume2 size={14}/> 읽어주기</button>}</div>
      </div>)}</div>}
      {(busy||activities.length>0)&&<div className="activity"><div className="activity-title"><span>실행 기록</span>{busy&&<LoaderCircle size={15} className="spin"/>}</div>
        {activities.slice(-8).map(a=><div className={'activity-line '+a.type} key={a.id}><span className="eventglyph">{a.type==='error'?'!':a.type==='tool_result'?'✓':'↳'}</span><div>{a.tool&&<b>{toolNames[a.tool]||a.tool}</b>}<span>{short(a.text,550)}</span>{a.args&&<small>{short(toText(a.args),150)}</small>}</div></div>)}
        {approval&&<div className="approval"><div className="approval-head"><ShieldCheck size={21}/> 실행 승인 요청</div>
          <div className="approval-name">{toolNames[approval.tool]||approval.tool}</div><pre>{short(toText(approval.args),900)}</pre>
          <div className="approval-actions"><button className="reject" disabled={approval.answered} onClick={()=>void respondApproval(false)}><X size={17}/> 거절</button><button className="allow" disabled={approval.answered} onClick={()=>void respondApproval(true)}><Check size={17}/> 실행 승인</button></div>
        </div>}
      </div>}
      <div ref={bottomRef}/>
    </section>
    <div className="composer-wrap"><div className={'composer '+(voiceOn?'recording':'')}>
      <textarea ref={inputRef} value={input} placeholder={voiceOn?'듣고 있습니다. 말씀하세요…':'Orbit에게 할 일을 말씀하세요…'} rows={2} onChange={e=>setInput(e.target.value)} onKeyDown={handleKey}/>
      <div className="composer-footer"><span className="hint">{voiceOn?<><span className="redpulse"/> 음성 듣는 중</>:'Enter 전송 · Shift+Enter 줄바꿈'}</span><div className="composer-buttons"><button className={'microphone '+(voiceOn?'listening':'')} title="한국어 음성 명령" onClick={toggleVoice} disabled={busy}><Mic size={20}/></button><button className="submit" disabled={!input.trim()||busy} title="보내기" onClick={()=>void send(input)}>{busy?<LoaderCircle className="spin" size={19}/>:<ArrowUp size={21}/>}</button></div></div>
    </div><div className="disclaimer">LOCAL FIRST · 외부 실행은 승인 후 진행 · 개인 PC에서만 구동</div></div>
  </main>
  {sideOpen&&<aside className="sidepanel"><div className="sideheading"><span>WORKSPACE</span><span className="circle-dot"/></div>
    <div className="sidebar-box"><div className="sidebox-title"><Zap size={18}/> 실행 가능한 도구</div><p>명령이 오면 모델이 필요한 작업을 골라 직접 실행합니다.</p>
      <div className="capability"><div className="capicon"><Monitor size={19}/></div><div><b>Windows 제어</b><span>프로그램 실행 · 로컬 파일</span></div><Check size={15}/></div>
      <div className="capability"><div className="capicon"><Globe size={19}/></div><div><b>웹 자동화</b><span>Edge/Chrome 탐색 · 입력 · 클릭</span></div><Check size={15}/></div>
      <div className="capability"><div className="capicon"><Mic size={19}/></div><div><b>음성 인터페이스</b><span>한국어 인식 · 음성 답변</span></div><Check size={15}/></div>
      <div className="capability"><div className="capicon"><Cpu size={19}/></div><div><b>모델 선택</b><span>Ollama · 외부 호환 API</span></div><Check size={15}/></div>
    </div>
    <div className="sidebar-box"><div className="sidebox-title"><ShieldCheck size={18}/> 작업 권한</div><p>웹 클릭, 정보 입력, 파일 변경은 승인받은 뒤 실행합니다.</p><button className="secondary-action" onClick={()=>setSettings(true)}>AI 연결 설정 <ChevronRight size={16}/></button></div>
    <div className="sidebar-foot"><span className="footcircle">◈</span> 내 PC 안에서 작동하는 비서<br/><small>실제 전화·문자·결제 기능은 아직 없습니다.</small></div>
  </aside>}
  {settings&&<div className="overlay" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)setSettings(false)}}><div className="modal" role="dialog" aria-modal="true" aria-label="AI 연결 설정">
    <div className="modal-header"><div><p className="eyebrow">CONNECTION</p><h2>AI 연결 설정</h2></div><button className="iconbutton" onClick={()=>setSettings(false)}><X size={20}/></button></div>
    <p className="modal-lead">로컬 Ollama 또는 OpenAI 호환 모델을 연결합니다. 모델이 없다면 먼저 Ollama에서 내려받아 주세요.</p>
    <div className="segment"><button className={config.provider==='ollama'?'selected':''} onClick={()=>setConfig({...config,provider:'ollama',base:'http://127.0.0.1:11434'})}>로컬 Ollama</button><button className={config.provider==='openai'?'selected':''} onClick={()=>setConfig({...config,provider:'openai',base:'https://api.openai.com/v1'})}>OpenAI 호환</button></div>
    <label>API 주소<input value={config.base} onChange={e=>setConfig({...config,base:e.target.value})} placeholder="http://127.0.0.1:11434"/></label>
    <label>모델 이름<input value={config.model} onChange={e=>setConfig({...config,model:e.target.value})} placeholder="qwen3:4b"/></label>
    {config.provider==='ollama'?<><button className="secondary-action" onClick={()=>void fetchModels()}>설치된 모델 조회 <ChevronRight size={15}/></button>{modelsError&&<p className="error-text">{modelsError}</p>}{models.length>0&&<div className="model-list">{models.map(m=><button key={m} onClick={()=>setConfig({...config,model:m})}>{m}{config.model===m&&<Check size={15}/>}</button>)}</div>}</>
    :<label>API 키 (이 브라우저 탭에만 저장)<input type="password" value={config.key} onChange={e=>setConfig({...config,key:e.target.value})} placeholder="sk-..." autoComplete="off"/></label>}
    <div className="modal-actions"><button onClick={()=>setSettings(false)} className="savebtn"><Check size={17}/> 설정 완료</button></div>
    <p className="privacy"><CircleHelp size={14}/> 로컬 모드에서는 모델이 내 PC에서 실행됩니다. 외부 API 모드를 쓰면 요청이 지정한 서비스로 전송됩니다.</p>
  </div></div>}
 </div>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
