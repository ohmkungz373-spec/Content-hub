#!/usr/bin/env node
/**
 * Build script for Vercel deployment.
 *
 * Vercel is a static/serverless host: it can't run the always-on
 * `server.js` that scans the `content/` folder on every request.
 * This script does that scan once, at build time, and produces a
 * plain static site in /public:
 *
 *   public/index.html   - the same front-end, pointed at hub.json
 *   public/hub.json      - the registry (replaces GET /api/hub)
 *   public/content/...   - a copy of content/ (README.txt files dropped)
 *
 * `npm start` (server.js) still works for local editing, where you
 * want new files to show up on refresh without a rebuild.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CONFIG = path.join(ROOT, 'hub.config.json');
const CONTENT = path.join(ROOT, 'content');
const PUBLIC = path.join(ROOT, 'public');
const ALLOWED = new Set(['.html', '.htm', '.md', '.markdown', '.txt']);
const HIDDEN = /(^|[\\/])\./;

function norm(s) { return String(s).normalize('NFC').toLowerCase(); }
function strip(s) { return String(s).replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim(); }

function readConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG, 'utf8')); }
  catch (e) { throw new Error(`Cannot read hub.config.json: ${e.message}`); }
}

function titleFromFile(abs, file) {
  try {
    const text = fs.readFileSync(abs, 'utf8').slice(0, 30000);
    const html = text.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (html) return strip(html[1]).split('|')[0].trim();
    const md = text.match(/^\s*#\s+(.+)$/m);
    if (md) return md[1].trim();
  } catch { /* fall through to filename-derived title */ }
  return file.replace(/\.(html?|markdown|md|txt)$/i, '').replace(/^\d+[-_.\s]*/, '').replace(/[-_]+/g, ' ').trim() || file;
}

function walk(dir, base = '') {
  let out = [];
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    if (HIDDEN.test(e.name)) continue;
    const rel = path.join(base, e.name);
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) out = out.concat(walk(abs, rel));
    else if (ALLOWED.has(path.extname(e.name).toLowerCase())) out.push({ rel, abs, name: e.name });
  }
  return out;
}

function subjectRegistry() {
  const cfg = readConfig();
  let dirs = [];
  try {
    dirs = fs.readdirSync(CONTENT, { withFileTypes: true })
      .filter(e => e.isDirectory() && !HIDDEN.test(e.name))
      .map(e => e.name);
  } catch (e) {
    throw new Error(`Cannot read content/: ${e.message}`);
  }
  const used = new Set();
  const entries = (cfg.subjects || []).map(meta => {
    const dir = dirs.find(d => norm(d) === norm(meta.folder));
    if (dir) used.add(dir);
    return { meta, dir: dir || meta.folder };
  });
  for (const dir of dirs.filter(d => !used.has(d))) {
    entries.push({ meta: { name: dir, icon: '📚', group: 'อื่น ๆ' }, dir });
  }
  const subjects = entries.map(({ meta, dir }) => {
    const base = path.join(CONTENT, dir);
    const files = walk(base)
      .filter(x => x.rel.toLowerCase() !== 'readme.txt')
      .sort((a, b) => a.rel.localeCompare(b.rel, 'th', { numeric: true, sensitivity: 'base' }));
    const chapters = files.map((f, i) => ({
      id: f.rel.replaceAll('\\', '/'),
      file: f.rel.replaceAll('\\', '/'),
      title: titleFromFile(f.abs, f.name),
      number: i + 1,
    }));
    return { folder: dir, name: meta.name || dir, icon: meta.icon || '📚', group: meta.group || 'อื่น ๆ', chapters };
  });
  return { title: cfg.title || 'คลังเนื้อหา', subtitle: cfg.subtitle || '', groups: cfg.groups || [], subjects };
}

function copyContentDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  let ents = [];
  try { ents = fs.readdirSync(src, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    if (HIDDEN.test(e.name)) continue;
    if (norm(e.name) === 'readme.txt') continue; // internal instructions, not a lesson
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    if (e.isDirectory()) copyContentDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function build() {
  if (!fs.existsSync(CONTENT)) throw new Error('content/ folder is missing');
  if (!fs.existsSync(path.join(ROOT, 'index.html'))) throw new Error('index.html is missing');

  fs.rmSync(PUBLIC, { recursive: true, force: true });
  fs.mkdirSync(PUBLIC, { recursive: true });

  const data = subjectRegistry();
  fs.writeFileSync(path.join(PUBLIC, 'hub.json'), JSON.stringify(data));

  copyContentDir(CONTENT, path.join(PUBLIC, 'content'));

  fs.copyFileSync(path.join(ROOT, 'index.html'), path.join(PUBLIC, 'index.html'));

  const chapterCount = data.subjects.reduce((n, s) => n + s.chapters.length, 0);
  console.log(`✓ Built ${data.subjects.length} subjects / ${chapterCount} chapters into public/`);
}

build();
