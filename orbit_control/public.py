"""Public self-service signup and provider callbacks. No admin routes or admin cookies."""
from pathlib import Path
from urllib.parse import urlsplit
import httpx
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, StreamingResponse

ROOT=Path(__file__).resolve().parents[1]
DROP={'host','connection','keep-alive','transfer-encoding','content-length','content-encoding',
      'x-orbit-agent','x-orbit-pairing','x-orbit-client-ip','forwarded','x-forwarded-for',
      'x-real-ip','proxy-authorization','proxy-authenticate','te','trailer','upgrade'}
DROP_RESPONSE={'connection','keep-alive','transfer-encoding','content-length','content-encoding',
               'set-cookie','access-control-allow-origin'}

def create_public_router(*,worker_url:str='http://127.0.0.1:4786',static_dir:str|Path|None=None)->APIRouter:
    parsed=urlsplit(worker_url)
    if parsed.scheme!='http' or parsed.hostname not in {'127.0.0.1','localhost','::1'} or parsed.username or parsed.password or parsed.path not in ('','/'):
        raise ValueError('Orbit worker must be a loopback origin')
    base=f'http://127.0.0.1:{parsed.port or 80}'
    assets=Path(static_dir or ROOT/'dist').resolve()
    router=APIRouter()

    @router.get('/',include_in_schema=False)
    @router.get('/join',include_in_schema=False)
    @router.get('/join.html',include_in_schema=False)
    async def join():
        page=assets/'join.html'
        if not page.is_file():raise HTTPException(503,detail='가입 화면 빌드가 없습니다: npm run build')
        return FileResponse(page,media_type='text/html',headers={'Cache-Control':'no-store'})

    @router.get('/assets/{asset_path:path}',include_in_schema=False)
    async def assets_route(asset_path:str):
        if not asset_path or '\\' in asset_path or '\x00' in asset_path:raise HTTPException(404)
        target=(assets/'assets'/asset_path).resolve()
        if not target.is_relative_to(assets/'assets') or not target.is_file():raise HTTPException(404)
        return FileResponse(target,headers={'X-Content-Type-Options':'nosniff','Cache-Control':'public,max-age=31536000,immutable'})

    async def proxy(req:Request,target:str):
        origin=req.headers.get('origin')
        if origin:
            o=urlsplit(origin)
            if o.scheme not in ('https','http') or o.netloc!=req.headers.get('host'):
                raise HTTPException(403,detail='허용되지 않은 가입 Origin')
        raw=await req.body()
        if len(raw)>300_000:raise HTTPException(413,detail='요청 크기 초과')
        headers={k:v for k,v in req.headers.items() if k.lower() not in DROP}
        headers['host']=urlsplit(base).netloc
        headers.pop('origin',None)
        if target.startswith('/onboarding/') and req.client:headers['x-orbit-client-ip']=req.client.host
        query=('?'+req.url.query) if req.url.query else ''
        client=httpx.AsyncClient(timeout=httpx.Timeout(95.0,connect=5.0),trust_env=False,follow_redirects=False)
        try:
            upstream=client.build_request(req.method,base+target+query,headers=headers,content=raw)
            result=await client.send(upstream,stream=True)
        except httpx.HTTPError as exc:
            await client.aclose()
            raise HTTPException(502,detail='가입·웹훅 실행 엔진에 연결할 수 없습니다.') from exc
        h={k:v for k,v in result.headers.items() if k.lower() not in DROP_RESPONSE}
        h['Cache-Control']='no-store'
        async def chunks():
            try:
                async for ch in result.aiter_raw():yield ch
            finally:
                await result.aclose()
                await client.aclose()
        return StreamingResponse(chunks(),status_code=result.status_code,headers=h)

    @router.api_route('/onboarding/{tail:path}',methods=['GET','POST'])
    async def onboarding(req:Request,tail:str):
        return await proxy(req,'/onboarding/'+tail)

    @router.api_route('/webhook/whatsapp',methods=['GET','POST'])
    async def whatsapp(req:Request):
        return await proxy(req,'/webhook/whatsapp')

    @router.api_route('/twilio/{tail:path}',methods=['POST'])
    async def twilio(req:Request,tail:str):
        return await proxy(req,'/twilio/'+tail)

    @router.get('/healthz')
    async def health():
        return {'ok':True,'role':'public-signup','admin':False}

    return router
