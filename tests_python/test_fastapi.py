import hashlib
import hmac
import json
from pathlib import Path
from threading import Thread
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from tempfile import TemporaryDirectory
import unittest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from orbit_control import create_router, create_public_router

class NodeMock(BaseHTTPRequestHandler):
    calls=[]
    def do_GET(self): self.process()
    def do_POST(self): self.process()
    def process(self):
        n=int(self.headers.get('content-length',0));body=self.rfile.read(n)
        self.calls.append((self.path,body,dict(self.headers)))
        data=json.dumps({'path':self.path,'body':body.decode(),'headers':dict(self.headers)},ensure_ascii=False).encode()
        self.send_response(201);self.send_header('Content-Type','application/json')
        self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
    def log_message(self,*args): pass

class ControlTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.worker=ThreadingHTTPServer(('127.0.0.1',0),NodeMock)
        cls.thread=Thread(target=cls.worker.serve_forever,daemon=True);cls.thread.start()
        cls.temp=TemporaryDirectory();cls.static=Path(cls.temp.name)
        (cls.static/'index.html').write_text('<html>Orbit admin</html>',encoding='utf-8')
        (cls.static/'join.html').write_text('<html>Orbit QR signup</html>',encoding='utf-8')
        (cls.static/'assets').mkdir()
        (cls.static/'assets'/'app.js').write_text('console.log("app")')
        cls.app=FastAPI()
        cls.app.include_router(create_router(worker_url=f'http://127.0.0.1:{cls.worker.server_port}',
                                              prefix='/orbit',static_dir=cls.static,admin_token='some-secret-token'),prefix='/orbit')
        cls.client=TestClient(cls.app)
        cls.public_app=FastAPI()
        cls.public_app.include_router(create_public_router(worker_url=f'http://127.0.0.1:{cls.worker.server_port}',static_dir=cls.static))
        cls.public=TestClient(cls.public_app)
    @classmethod
    def tearDownClass(cls):
        cls.client.close();cls.public.close();cls.worker.shutdown();cls.worker.server_close();cls.temp.cleanup()

    def test_mount_static_and_public_join(self):
        self.assertEqual(self.client.get('/orbit/').status_code,200)
        self.assertEqual(self.client.get('/orbit/join').status_code,404)
        self.assertEqual(self.public.get('/join').status_code,200)
        self.assertEqual(self.public.get('/').status_code,200)
        self.assertEqual(self.public.get('/api/admin/state').status_code,404)
        self.assertEqual(self.client.get('/orbit/onboarding/config').status_code,404)
        self.assertEqual(self.client.post('/orbit/webhook/whatsapp').status_code,404)
        self.assertEqual(self.client.get('/orbit/assets/app.js').status_code,200)
        self.assertEqual(self.client.get('/orbit/assets/../hidden').status_code,404)
        self.assertEqual(self.client.get('/orbit/healthz').json()['role'],'fastapi-management')

    def test_admin_session_login_and_proxy(self):
        self.assertEqual(self.client.post('/orbit/api/control/session',json={'password':'wrong'}).status_code,401)
        self.assertEqual(self.client.post('/orbit/api/control/session',json={'password':'some-secret-token'}).status_code,200)
        result=self.client.get('/orbit/api/admin/state?x=one')
        self.assertEqual(result.status_code,201)
        payload=result.json()
        self.assertEqual(payload['path'],'/api/admin/state?x=one')
        self.assertEqual(payload['headers'].get('x-orbit-agent'), '1')
        self.assertEqual(self.client.post('/orbit/api/admin/state',json={},headers={'Origin':'https://evil.example'}).status_code,403)
        self.client.delete('/orbit/api/control/session')

    def test_meta_webhook_body_and_signature_forwarded(self):
        raw=b'{"entry":[{"message":"a b"}]}'
        headers={'Content-Type':'application/json','X-Hub-Signature-256':'sha256=deadbeef'}
        response=self.public.post('/webhook/whatsapp?example=1',content=raw,headers=headers)
        self.assertEqual(response.status_code,201)
        obj=response.json()
        self.assertEqual(obj['body'],raw.decode())
        self.assertEqual(obj['path'],'/webhook/whatsapp?example=1')
        self.assertEqual(obj['headers']['x-hub-signature-256'],'sha256=deadbeef')

    def test_twilio_raw_form_and_onboarding(self):
        raw=b'CallStatus=completed&SpeechResult=%ED%95%9C%EA%B8%80'
        response=self.public.post('/twilio/status/call-x?token=abc',content=raw,
                                  headers={'Content-Type':'application/x-www-form-urlencoded','X-Twilio-Signature':'valid-signature'})
        self.assertEqual(response.status_code,201)
        self.assertEqual(response.json()['body'],raw.decode())
        self.assertEqual(response.json()['headers']['x-twilio-signature'],'valid-signature')
        self.assertEqual(self.public.get('/onboarding/config').json()['path'],'/onboarding/config')

    def test_multiple_signup_users_keep_independent_rate_limit_identities(self):
        with TestClient(self.public_app, client=('203.0.113.42',12345)) as external:
            resp=external.post('/onboarding/session',json={'phone':'+821012345678'},
                               headers={'Origin':'http://testserver','X-Orbit-Client-IP':'1.2.3.4'})
            self.assertEqual(resp.status_code,201)
            headers=resp.json()['headers']
            self.assertEqual(headers['x-orbit-client-ip'],'203.0.113.42')
            self.assertNotIn('origin',headers)
        with TestClient(self.public_app, client=('203.0.113.43',12345)) as second:
            resp=second.post('/onboarding/session',json={'phone':'+821011122233'},
                             headers={'Origin':'http://testserver'})
            self.assertEqual(resp.status_code,201)
            self.assertEqual(resp.json()['headers']['x-orbit-client-ip'],'203.0.113.43')

    def test_no_remote_admin_without_login(self):
        # Pretend a reverse-proxy forwarded the incoming request, which rules out local-trust bypass.
        res=self.client.get('/orbit/api/admin/state',headers={'X-Forwarded-For':'1.1.1.1','X-Orbit-Agent':'1'})
        self.assertEqual(res.status_code,401)

if __name__=='__main__':unittest.main()
