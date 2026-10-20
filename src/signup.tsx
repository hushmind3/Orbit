import React,{useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {CheckCircle2,ExternalLink,LoaderCircle,ShieldCheck} from 'lucide-react';
import './style.css';

type Session={id:string;status:string;link?:string|null;expiresAt:number;verified?:boolean;message?:string;ok?:boolean};
type Setup={ready:boolean;note:string;smsRequired:boolean};
async function api<T>(route:string,payload?:object):Promise<T>{
 const response=await fetch(route,{method:payload?'POST':'GET',headers:{'Content-Type':'application/json'},body:payload?JSON.stringify(payload):undefined,credentials:'omit',cache:'no-store'});
 const raw=await response.text();let value:any;try{value=JSON.parse(raw);}catch{throw Error('가입 서비스 응답을 확인할 수 없습니다.');}
 if(!response.ok)throw Error(value.error||value.detail||'가입 요청에 실패했습니다.');
 return value as T;
}
function Signup(){
 const [setup,setSetup]=useState<Setup|null>(null),[session,setSession]=useState<Session|null>(null);
 const [name,setName]=useState(''),[email,setEmail]=useState(''),[phone,setPhone]=useState(''),[otp,setOtp]=useState('');
 const [busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 useEffect(()=>{void api<Setup>('/onboarding/config').then(setSetup).catch(e=>setNotice(String(e.message||e)));},[]);
 useEffect(()=>{if(!session?.id||!['awaiting_whatsapp','awaiting_sms'].includes(session.status))return;
  const timer=setInterval(()=>{void api<Session>('/onboarding/session/'+encodeURIComponent(session.id)).then(next=>{
   setSession(next);if(next.status==='verified')setNotice('가입이 완료됐습니다. WhatsApp에서 바로 비서에게 업무를 맡기세요.');
   else if(next.status==='expired')setNotice('인증 시간이 만료됐습니다. 다시 가입해 주세요.');
  }).catch(e=>setNotice(String(e.message||e)));},3000);return()=>clearInterval(timer);
 },[session?.id,session?.status]);
 async function action(fn:()=>Promise<void>){setBusy(true);setNotice('');try{await fn();}catch(e){setNotice(String(e instanceof Error?e.message:e));}finally{setBusy(false);}}
 const start=()=>void action(async()=>{const current=await api<Session>('/onboarding/session',{phone,name,email});setSession(current);
  if(current.status==='awaiting_sms'){await api('/onboarding/sms/start',{id:current.id});setNotice('휴대전화로 SMS 인증번호를 보냈습니다.');}
  else if(current.status==='awaiting_whatsapp')setNotice('QR을 스캔하고 연결 메시지를 보내세요.');
  else setNotice(current.message||'서비스 연결 상태를 확인하세요.');
 });
 const verify=()=>void action(async()=>{if(!session)return;const next=await api<Session>('/onboarding/sms/check',{id:session.id,code:otp});
  if(!next.ok)throw Error(next.message||'인증번호가 일치하지 않습니다.');
  setSession({...session,...next,status:'awaiting_whatsapp'});setNotice('본인 인증이 완료됐습니다. WhatsApp에서 연결 메시지를 보내세요.');
 });
 return <main className="min-h-screen bg-slate-950 px-4 py-12 text-slate-100"><div className="mx-auto max-w-xl">
  <header className="mb-8 flex items-center gap-3"><span className="logo-mark">O</span><div><h1 className="text-2xl font-semibold">Orbit</h1><p className="text-sm text-slate-400">내 일을 대신하는 WhatsApp AI 비서</p></div></header>
  <section className="panel space-y-5">
   <div><h2 className="text-xl font-semibold">가입하고 바로 사용하세요</h2><p className="mt-3 text-sm leading-6 text-slate-400">가입자가 직접 전화번호를 인증합니다. 운영자의 개별 승인은 필요하지 않습니다.</p></div>
   {setup&&!setup.ready?<div className="notice">{setup.note||'가입 서비스 준비 중입니다.'}</div>
   :session?.status==='verified'?<div className="space-y-4 py-8 text-center"><CheckCircle2 className="mx-auto text-emerald-400" size={54}/><h3 className="text-xl font-semibold">연결 완료</h3><p className="text-sm text-slate-300">이제 WhatsApp에서 비서에게 업무를 맡기시면 됩니다. 관리페이지 접속은 필요 없습니다.</p></div>
   :session?.status==='awaiting_whatsapp'?<div className="space-y-5 text-center"><p className="text-sm text-slate-300">QR을 스캔하거나 버튼을 눌러 WhatsApp 연결 메시지를 전송하세요.</p>
    <div className="mx-auto w-fit rounded-2xl bg-white p-4"><img className="h-60 w-60" src={'/onboarding/qr/'+encodeURIComponent(session.id)} alt="Orbit WhatsApp 연결 QR"/></div>
    {session.link&&<a href={session.link} className="btn-primary inline-flex items-center justify-center gap-2" target="_blank" rel="noreferrer">WhatsApp 연결 <ExternalLink size={16}/></a>}
    <p className="text-xs text-slate-400">최초 연결할 때만 진행합니다. 등록 후 다시 가입 인증할 필요가 없습니다.</p>
   </div>
   :session?.status==='awaiting_sms'?<div className="space-y-4"><label className="block text-sm text-slate-300">SMS 인증번호<input className="input mt-2" autoComplete="one-time-code" inputMode="numeric" value={otp} onChange={e=>setOtp(e.target.value)} placeholder="인증번호"/></label>
    <button disabled={busy||!otp.trim()} className="btn-primary" onClick={verify}>{busy?<LoaderCircle className="animate-spin" size={16}/>:<ShieldCheck size={16}/>} 번호 인증 완료</button></div>
   :<div className="space-y-4"><label className="block text-sm text-slate-300">이름<input className="input mt-2" autoComplete="name" value={name} onChange={e=>setName(e.target.value)}/></label>
    <label className="block text-sm text-slate-300">이메일 (선택)<input className="input mt-2" type="email" value={email} onChange={e=>setEmail(e.target.value)}/></label>
    <label className="block text-sm text-slate-300">WhatsApp 전화번호<input className="input mt-2" type="tel" autoComplete="tel" value={phone} onChange={e=>setPhone(e.target.value)} placeholder="+821012345678"/></label>
    <button disabled={busy||!phone.trim()||!setup?.ready} className="btn-primary" onClick={start}>{busy?<LoaderCircle className="animate-spin" size={16}/>:<ShieldCheck size={16}/>} 본인 인증 후 시작하기</button></div>}
   {session?.status==='expired'&&<button type="button" className="btn-subtle" onClick={()=>{setSession(null);setNotice('');}}>다시 가입하기</button>}
   {notice&&<p role="status" className="notice text-sm">{notice}</p>}
  </section><p className="mt-6 text-center text-xs text-slate-500">회원 자동 등록 · 관리자 가입 승인 없음</p>
 </div></main>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><Signup/></React.StrictMode>);
