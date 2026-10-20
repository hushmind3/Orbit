"""Optional public FastAPI app; existing FastAPI can also mount create_public_router."""
import os
from fastapi import FastAPI
from .public import create_public_router
app=FastAPI(title='Orbit public signup',docs_url=None,redoc_url=None)
app.include_router(create_public_router(worker_url=os.getenv('ORBIT_WORKER_URL','http://127.0.0.1:4786')))
