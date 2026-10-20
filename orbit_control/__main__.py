"""Optional standalone launch; the existing FastAPI app can mount create_router()."""
import os
import uvicorn

if __name__=='__main__':
    uvicorn.run('orbit_control.app:app',host=os.getenv('ORBIT_CONTROL_HOST','127.0.0.1'),
                port=int(os.getenv('ORBIT_CONTROL_PORT','8766')))
