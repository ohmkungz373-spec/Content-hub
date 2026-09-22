const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const ROOT = __dirname;
const PORT = process.env.PORT || 3000;
const CONFIG = path.join(ROOT, 'hub.config.json');
const CONTENT = path.join(ROOT, process.env.CONTENT_DIR || 'content');
const ALLOWED = new Set(['.html','.htm','.md','.markdown','.txt']);
const MIME = {'.html':'text/html; charset=utf-8','.htm':'text/html; charset=utf-8','.md':'text/plain; charset=utf-8','.markdown':'text/plain; charset=utf-8','.txt':'text/plain; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml','.gif':'image/gif','.pdf':'application/pdf','.mp3':'audio/mpeg','.woff2':'font/woff2'};
const HIDDEN = /(^|[\\/])\./;
let registryCache = {stamp:0,data:null};

function safeDecode(s){ try{return decodeURIComponent(s)}catch{return ''} }
function norm(s){return String(s).normalize('NFC').toLowerCase()}
function readConfig(){ try{return JSON.parse(fs.readFileSync(CONFIG,'utf8'))}catch{return {title:'คลังเนื้อหา',groups:[],subjects:[]}} }
function titleFromFile(abs, file){
  try{
    const text = fs.readFileSync(abs,'utf8').slice(0,30000);
    const html = text.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if(html) return strip(html[1]).split('|')[0].trim();
    const md = text.match(/^\s*#\s+(.+)$/m);
    if(md) return md[1].trim();
  }catch{}
  return file.replace(/\.(html?|markdown|md|txt)$/i,'').replace(/^\d+[-_.\s]*/,'').replace(/[-_]+/g,' ').trim() || file;
}
function strip(s){return String(s).replace(/<[^>]*>/g,'').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').trim()}
function walk(dir, base=''){
  let out=[]; let ents=[]; try{ents=fs.readdirSync(dir,{withFileTypes:true})}catch{return out}
  for(const e of ents){ if(HIDDEN.test(e.name)) continue; const rel=path.join(base,e.name); const abs=path.join(dir,e.name); if(e.isDirectory()) out=out.concat(walk(abs,rel)); else if(ALLOWED.has(path.extname(e.name).toLowerCase())) out.push({rel,abs,name:e.name}); }
  return out;
}
function subjectRegistry(){
  const cfg=readConfig();
  let dirs=[]; try{dirs=fs.readdirSync(CONTENT,{withFileTypes:true}).filter(e=>e.isDirectory()&&!HIDDEN.test(e.name)).map(e=>e.name)}catch{}
  const used=new Set();
  const entries=(cfg.subjects||[]).map(meta=>{const dir=dirs.find(d=>norm(d)===norm(meta.folder)); if(dir) used.add(dir); return {meta,dir:dir||meta.folder}});
  for(const dir of dirs.filter(d=>!used.has(d))) entries.push({meta:{name:dir,icon:'📚',group:'อื่น ๆ'},dir});
  const subjects=entries.map(({meta,dir})=>{
    const base=path.join(CONTENT,dir); const files=walk(base).filter(x=>x.rel.toLowerCase()!=='readme.txt').sort((a,b)=>a.rel.localeCompare(b.rel,'th',{numeric:true,sensitivity:'base'}));
    const chapters=files.map((f,i)=>({id:f.rel.replaceAll('\\','/'),file:f.rel.replaceAll('\\','/'),title:titleFromFile(f.abs,f.name),number:i+1}));
    return {folder:dir,name:meta.name||dir,icon:meta.icon||'📚',group:meta.group||'อื่น ๆ',chapters};
  });
  return {title:cfg.title||'คลังเนื้อหา',subtitle:cfg.subtitle||'',groups:cfg.groups||[],subjects};
}
function registry(){
  const now=Date.now(); if(registryCache.data&&now-registryCache.stamp<700) return registryCache.data;
  registryCache={stamp:now,data:subjectRegistry()}; return registryCache.data;
}
function inside(base,target){const b=path.resolve(base)+path.sep; const t=path.resolve(target); return t.startsWith(b)}
function serveFile(req,res,abs){
  try{const st=fs.statSync(abs); if(!st.isFile()) throw new Error('not file'); const ext=path.extname(abs).toLowerCase();
    if(ext==='.md'||ext==='.markdown'||ext==='.txt'){const raw=fs.readFileSync(abs,'utf8'); res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-cache'}); return res.end(raw)}
    res.writeHead(200,{'Content-Type':MIME[ext]||'application/octet-stream','Cache-Control':'no-cache'}); fs.createReadStream(abs).pipe(res);
  }catch{res.writeHead(404);res.end('Not found')}
}
function page(){return fs.readFileSync(path.join(ROOT,'index.html'))}

http.createServer((req,res)=>{
  try{
    const p=safeDecode(url.parse(req.url).pathname||'/');
    if(p==='/api/hub'){res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); return res.end(JSON.stringify(registry()))}
    if(p==='/api/debug'){res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); return res.end(JSON.stringify({root:ROOT,content:CONTENT,contentExists:fs.existsSync(CONTENT),hub:registry()},null,2))}
    if(p.startsWith('/content/')){
      const parts=p.slice('/content/'.length).split('/').filter(Boolean); const folder=parts.shift(); if(!folder){res.writeHead(404);return res.end('Not found')}
      const abs=path.resolve(CONTENT,folder,...parts); if(!inside(CONTENT,abs)){res.writeHead(403);return res.end('Forbidden')}
      return serveFile(req,res,abs);
    }
    return res.end(page());
  }catch(e){res.writeHead(500);res.end('Server error')}
}).listen(PORT,()=>console.log(`Content Hub v2 running on ${PORT}`));
