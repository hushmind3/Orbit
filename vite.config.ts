import {defineConfig} from 'vite';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({
  plugins:[tailwindcss()],
  base:'./',
  build:{rollupOptions:{input:['index.html','join.html']}},
  server:{host:'127.0.0.1',port:5173,proxy:{'/api':'http://127.0.0.1:4786','/onboarding':'http://127.0.0.1:4786','/webhook':'http://127.0.0.1:4786','/twilio':'http://127.0.0.1:4786'}},
});
