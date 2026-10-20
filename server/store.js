/** Durable notes/history for the local PC owner. Independent WhatsApp users use member-tools.js. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
const runtime=()=>process.env.ORBIT_STORE_PATH||path.resolve(process.cwd(),'.runtime');
const historyFile=()=>path.join(runtime(),'history.json');
const notesFile=()=>path.join(runtime(),'notes.json');
const locks=new Map();
async function getJSON(file,fallback){try{return JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw e;}}
async function mutate(file,initial,fn){const prev=locks.get(file)||Promise.resolve();const job=prev.then(async()=>{const original=await getJSON(file,initial);const next=fn(original);await fs.mkdir(path.dirname(file),{recursive:true});const temp=file+'.'+randomUUID()+'.tmp';await fs.writeFile(temp,JSON.stringify(next,null,2),{mode:0o600});await fs.rename(temp,file);return next;});const tail=job.catch(()=>{});locks.set(file,tail);void tail.then(()=>{if(locks.get(file)===tail)locks.delete(file);});return job;}
export const store={
 async history(){const d=await getJSON(historyFile(),[]);return Array.isArray(d)?d.slice(-80):[];},
 async push(role,content){await mutate(historyFile(),[],d=>[...d,{role,content,time:new Date().toISOString()}].slice(-80));},
 async notes(){const d=await getJSON(notesFile(),[]);return Array.isArray(d)?d.slice(-50):[];},
 async addNote(note){await mutate(notesFile(),[],d=>[...d,{note,time:new Date().toISOString()}].slice(-50));},
 async clearHistory(){await mutate(historyFile(),[],()=>[]);}
};
