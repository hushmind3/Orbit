import fs from 'node:fs/promises';
import path from 'node:path';
const runtime = path.resolve(process.cwd(),'.runtime');
const historyFile = path.join(runtime,'history.json');
const notesFile = path.join(runtime,'notes.json');
async function getJSON(file, fallback) { try { return JSON.parse(await fs.readFile(file,'utf8')); } catch { return fallback; } }
async function putJSON(file,value) { await fs.mkdir(runtime,{recursive:true}); const temp=file+'.tmp'; await fs.writeFile(temp,JSON.stringify(value,null,2),'utf8'); await fs.rename(temp,file); }
export const store = {
  async history() { const data=await getJSON(historyFile,[]); return Array.isArray(data)?data.slice(-80):[]; },
  async push(role,content) { const list=await this.history();list.push({role,content,time:new Date().toISOString()});await putJSON(historyFile,list.slice(-80)); },
  async notes() { const data=await getJSON(notesFile,[]);return Array.isArray(data)?data.slice(-50):[]; },
  async addNote(note) { const entries=await this.notes();entries.push({note,time:new Date().toISOString()});await putJSON(notesFile,entries.slice(-50)); },
  async clearHistory() { await putJSON(historyFile,[]); }
};
