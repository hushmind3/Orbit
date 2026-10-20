"""Mountable FastAPI management plane for Orbit's existing Node execution worker.

The LLM agent, WhatsApp and Twilio business logic remain in the Node worker. FastAPI
owns the management HTTP interface, admin authentication. Public signup and callbacks are mounted separately.
"""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import os
from pathlib import Path
import re
import secrets
import time
from urllib.parse import urlsplit

import httpx
from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse, StreamingResponse

ROOT = Path(__file__).resolve().parents[1]
BLOCKED_HEADERS = {'host','connection','keep-alive','transfer-encoding','proxy-authorization',
                   'proxy-authenticate','te','trailer','upgrade','content-length','content-encoding',
                   'x-orbit-agent','x-orbit-pairing','x-orbit-client-ip','forwarded','x-forwarded-for'}
BLOCKED_REPLY_HEADERS = {'connection','keep-alive','transfer-encoding','content-length',
                         'content-encoding','set-cookie','access-control-allow-origin'}
COOKIE = 'orbit_admin'
LOGIN_WINDOW = 900


def create_router(*, worker_url: str = 'http://127.0.0.1:4786', prefix: str = '/orbit',
                  static_dir: str | Path | None = None, admin_token: str | None = None) -> APIRouter:
    """Return an APIRouter for app.include_router(...); no extra Python server required.

    Only a loopback Node worker is accepted. For remotely accessed admin views set
    ORBIT_ADMIN_TOKEN; this is not required for loopback-only local access.
    """
    parsed = urlsplit(worker_url)
    if parsed.scheme != 'http' or parsed.hostname not in {'127.0.0.1','localhost','::1'} or parsed.username or parsed.password or parsed.path not in ('','/'):
        raise ValueError('Orbit Node worker must be a loopback HTTP origin')
    base = f'http://127.0.0.1:{parsed.port or 80}'
    prefix = ('/' + prefix.strip('/')) if prefix.strip('/') else ''
    assets = Path(static_dir or ROOT / 'dist').resolve()
    configured_token = admin_token if admin_token is not None else os.environ.get('ORBIT_ADMIN_TOKEN','')
    attempts: dict[str, list[float]] = {}
    router = APIRouter()

    def loopback(req: Request) -> bool:
        # A reverse proxy can connect from 127.0.0.1. Never trust that alone.
        host = req.headers.get('host', '').split(':',1)[0].strip('[]').lower()
        peer = (req.client.host if req.client else '')
        return (peer in ('127.0.0.1','::1') and host in ('127.0.0.1','localhost','::1')
                and not any(x in req.headers for x in ('forwarded','x-forwarded-for','x-real-ip')))

    def cookie(req: Request) -> bool:
        if not configured_token:
            return False
        value = req.cookies.get(COOKIE,'')
        try:
            issued,mac = value.split('.',1)
            when = int(issued)
        except (ValueError, TypeError):
            return False
        if when > time.time()+60 or when < time.time()-12*3600:
            return False
        expected = hmac.new(configured_token.encode(),issued.encode(),hashlib.sha256).hexdigest()
        return hmac.compare_digest(expected, mac)

    def allowed(req: Request) -> bool:
        return cookie(req) or loopback(req)

    def check(req: Request) -> None:
        if not allowed(req):
            raise HTTPException(status_code=401, detail='Orbit 관리 인증이 필요합니다.')
        origin = req.headers.get('origin')
        if origin:
            try:
                o = urlsplit(origin)
                if o.scheme not in ('http','https') or o.netloc != req.headers.get('host'):
                    raise ValueError('origin mismatch')
            except ValueError:
                raise HTTPException(status_code=403,detail='허용되지 않은 요청 Origin')

    def built_index() -> Path:
        page = assets / 'index.html'
        if not page.is_file():
            raise HTTPException(status_code=503,detail='관리 화면 빌드가 없습니다: npm run build')
        return page

    @router.get('/', include_in_schema=False)
    @router.get('/admin', include_in_schema=False)
    @router.get('/admin/', include_in_schema=False)
    async def dashboard(req: Request):
        # Serve the app shell; all management data and mutations remain authenticated.
        return FileResponse(built_index(),media_type='text/html',headers={'Cache-Control':'no-store'})

    @router.get('/assets/{asset_path:path}', include_in_schema=False)
    async def bundled_assets(asset_path: str):
        if not asset_path or '\\' in asset_path or '\x00' in asset_path:
            raise HTTPException(404)
        target = (assets/'assets'/asset_path).resolve()
        if not target.is_relative_to(assets/'assets') or not target.is_file():
            raise HTTPException(404)
        return FileResponse(target, headers={'Cache-Control':'public,max-age=31536000,immutable',
                                             'X-Content-Type-Options':'nosniff'})

    @router.get('/api/control/session')
    async def session(req: Request):
        return {'authenticated': allowed(req),'tokenConfigured':bool(configured_token),
                'mode':'local' if loopback(req) else 'session'}

    @router.post('/api/control/session')
    async def login(req: Request):
        if not configured_token:
            raise HTTPException(403,detail='원격 관리를 사용하려면 ORBIT_ADMIN_TOKEN을 설정하세요.')
        origin = req.headers.get('origin')
        if origin and urlsplit(origin).netloc != req.headers.get('host'):
            raise HTTPException(403,detail='허용되지 않은 요청')
        peer = str(req.client.host if req.client else 'unknown')
        now = time.time()
        recent = [t for t in attempts.get(peer,[]) if now-t<LOGIN_WINDOW]
        if len(recent)>=6:
            raise HTTPException(429,detail='인증 시도가 너무 많습니다.')
        attempts[peer] = (recent+[now])[-10:]
        body = await req.json()
        password = body.get('password','') if isinstance(body,dict) else ''
        if not isinstance(password,str) or not hmac.compare_digest(password,configured_token):
            raise HTTPException(401,detail='관리 암호가 올바르지 않습니다.')
        attempts.pop(peer,None)
        issued=str(int(now))
        signature=hmac.new(configured_token.encode(),issued.encode(),hashlib.sha256).hexdigest()
        answer=JSONResponse({'authenticated':True})
        secure=req.url.scheme=='https' or req.headers.get('x-forwarded-proto')=='https'
        answer.set_cookie(COOKIE,f'{issued}.{signature}',secure=secure,httponly=True,
                          samesite='strict',max_age=12*3600,path=prefix+'/')
        return answer

    @router.delete('/api/control/session')
    async def logout():
        answer=JSONResponse({'authenticated':False})
        answer.delete_cookie(COOKIE,path=prefix+'/')
        return answer

    async def proxy(req: Request, target: str, *, admin: bool = False):
        if admin:
            check(req)
        if req.method not in ('GET','HEAD','POST','PUT','PATCH','DELETE'):
            raise HTTPException(405)
        # Enforce same-origin browser mutations before stripping public Origin.
        origin=req.headers.get('origin')
        if origin and req.method not in ('GET','HEAD'):
            p=urlsplit(origin)
            if p.scheme not in ('http','https') or p.netloc != req.headers.get('host'):
                raise HTTPException(403,detail='허용되지 않은 가입/관리 Origin')
        # Keep provider webhook bytes unchanged so signature checks run in Node.
        raw = await req.body()
        if len(raw)>300_000:
            raise HTTPException(413,detail='요청 크기 초과')
        headers={key:val for key,val in req.headers.items() if key.lower() not in BLOCKED_HEADERS}
        headers['host']=urlsplit(base).netloc
        # The Node worker sees only this loopback gateway, not each visitor.
        # Supply the peer identity separately for per-user signup rate limits.
        if target.startswith('/onboarding/') and req.client:
            headers['x-orbit-client-ip']=req.client.host
        if admin:
            headers['x-orbit-agent']='1'
        # Node is bound to loopback and validates requests against its own host.
        # Check the public origin at the gateway, then remove it when forwarding.
        # Otherwise the Node signup handler rejects legitimate browser signup.
        headers.pop('origin',None)
        query = ('?' + req.url.query) if req.url.query else ''
        client=httpx.AsyncClient(timeout=httpx.Timeout(95.0,connect=5.0),trust_env=False,follow_redirects=False)
        try:
            upstream=client.build_request(req.method,base+target+query,headers=headers,content=raw)
            result=await client.send(upstream,stream=True)
        except httpx.HTTPError as exc:
            await client.aclose()
            raise HTTPException(502,detail='Node 실행 엔진 연결 실패: '+type(exc).__name__) from exc
        out_headers={k:v for k,v in result.headers.items() if k.lower() not in BLOCKED_REPLY_HEADERS}
        out_headers['Cache-Control']='no-store' if admin else out_headers.get('Cache-Control','no-store')
        async def chunks():
            try:
                async for chunk in result.aiter_raw():
                    yield chunk
            finally:
                await result.aclose()
                await client.aclose()
        return StreamingResponse(chunks(),status_code=result.status_code,headers=out_headers,
                                 background=None)

    @router.api_route('/api/{tail:path}', methods=['GET','POST','PUT','PATCH','DELETE','HEAD'])
    async def management_api(req: Request,tail: str):
        if tail.startswith('control/'):
            raise HTTPException(404)
        return await proxy(req,'/api/'+tail,admin=True)

    @router.get('/healthz')
    async def healthz():
        return {'ok':True,'role':'fastapi-management','worker':base,'prefix':prefix}

    return router
