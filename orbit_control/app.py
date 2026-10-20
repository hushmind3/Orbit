"""Optional standalone FastAPI app. Existing apps should instead include_router(create_router())."""
import os
from fastapi import FastAPI
from fastapi.responses import RedirectResponse
from .router import create_router

app = FastAPI(title='Orbit management API',docs_url=None,redoc_url=None)
app.include_router(create_router(worker_url=os.getenv('ORBIT_WORKER_URL','http://127.0.0.1:4786'),prefix='/orbit'), prefix='/orbit')

@app.get('/',include_in_schema=False)
def home():
    return RedirectResponse('/orbit/')
