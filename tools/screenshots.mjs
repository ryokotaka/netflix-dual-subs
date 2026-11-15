// Takes the README screenshots: the real extension UI (lib.js, content.js, styles.css)
// on a stand-in player page, with made-up dialogue. Nothing from Netflix is shown.
//
//   node tools/screenshots.mjs        → docs/screenshot-*.png
//
// Uses the installed Google Chrome, headless, with a throwaway profile, driven over the
// DevTools protocol (no npm packages). The chrome.* APIs are stubbed: translations and
// the AI answer are canned below, so no network request leaves the machine.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sceneSvg } from './demo-scene.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXT = path.join(ROOT, 'ext');
const OUT = path.join(ROOT, 'docs');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const MOVIE = '80000001';

// [start s, end s, English, Japanese (as a machine translation would put it)]
const LINES = [
  [1, 4, 'Okay, we need to figure it out before the demo tomorrow.', 'よし、明日のデモの前にそれを解決する必要がある。'],
  [5, 7.5, "Relax. I've got a backup plan.", '落ち着いて。予備の計画がある。'],
  [8, 11, 'You always say that, and then you just wing it.', '君はいつもそう言って、それからただぶっつけ本番でやる。'],
  [12, 15.5, 'Fair enough. But this time I actually came up with something.', 'もっともだ。でも今回は実際に何か思いついたんだ。'],
  [16, 18, 'Fine. Walk me through it.', 'わかった。順を追って説明して。'],
  [19, 22, 'First, we stall them for ten minutes.', 'まず、彼らを10分間引き止める。'],
  [23, 25.5, "That's not a plan. That's a prayer.", 'それは計画じゃない。祈りだ。'],
  [26, 29, 'Trust me, I can pull it off.', '信じて、私ならやってのけられる。'],
  [30, 33, '-You said that last time.\n-And I was right last time!', '-前回もそう言った。\n-そして前回は正しかった！'],
  [34, 37, "[door slams]\nSomebody's in a hurry.", '誰かさん、急いでるね。'],
  [38, 41, "Let's get this over with.", 'さっさと終わらせよう。'],
  [42, 45, "I'll cover for you if anyone asks.", '誰かに聞かれたら、かばっておくよ。'],
  [46, 49, "Don't make me regret this.", '後悔させないでよね。'],
];
const JA = {};
for (const [, , en, ja] of LINES) {
  const e = en.replace(/\[[^\]]*\]\n?/g, '').split('\n'), j = ja.split('\n');
  e.forEach((x, i) => { JA[x.replace(/^-/, '').trim()] = (j[i] || j[0]).replace(/^-/, '').trim(); });
}
const ts = s => new Date(s * 1000).toISOString().slice(11, 23);
const VTT = 'WEBVTT\n\n' + LINES.map(([a, b, en]) => `${ts(a)} --> ${ts(b)}\n${en}\n`).join('\n');

const AI = {
  'pull it off': {
    meaning: '（難しいことを）うまくやってのける', usage: '無理そうな計画でも「自分ならできる」と自信を見せ、相手を安心させる言い方。',
    toFriend: '◎', toColleague: '○', toSuperior: '△', pattern: 'pull ~ off / pull off ~',
    exampleTo: '友人に', example: "I can't believe you pulled it off!", exampleJa: '本当にやってのけるなんて信じられない！',
  },
};
const SAVED = [
  ['wing it', 'ぶっつけ本番でやる', 2], ['come up with', '思いつく', 3], ['walk through', '順を追って説明する', 4],
  ['stall', '時間を稼ぐ、引き止める', 5], ['figure out', '解決する、理解する', 0],
].map(([head, mean, i], k) => ({ // saved in another episode, so the review asks for the meaning
  head, mean, ctx: mean, context: LINES[i][2].replace(/\n/g, ' '), movieId: '80000002', title: 'Demo',
  time: LINES[i][0] * 1000, at: Date.now() - k * 3600e3,
}));
// Japanese shown plainly (not blurred) and under the English too, so it reads at a glance.
const SETTINGS = { jaBlur: false, jaBottom: true };

const STUB = `
(() => {
  const store = { nds_ai: 'claude', nds_saved: ${JSON.stringify(SAVED)}, nds_settings: ${JSON.stringify(SETTINGS)} };
  const pick = k => k == null ? { ...store } : Object.fromEntries([].concat(k).filter(x => x in store).map(x => [x, store[x]]));
  const get = (k, cb) => { const r = pick(k); if (cb) setTimeout(() => cb(r)); return Promise.resolve(r); };
  const JA = ${JSON.stringify(JA)}, AI = ${JSON.stringify(AI)};
  const reply = m => {
    if (m.type === 'fetchText') return fetch(m.url).then(r => r.text()).then(text => ({ ok: true, text }));
    if (m.type === 'gtranslate') return Promise.resolve({ ok: true, texts: m.texts.map(t => t.split('\\n').map(x => JA[x.replace(/^-/, '').trim()] || x).join('\\n')) });
    if (m.type === 'claude') {
      const target = (m.prompt.match(/対象: (.*)/) || [])[1] || '';
      const a = AI[target] || Object.values(AI)[0];
      return new Promise(r => setTimeout(() => r({ ok: true, text: JSON.stringify(a) }), 300));
    }
    return Promise.resolve({ ok: true });
  };
  window.chrome = {
    runtime: { id: 'demo', getURL: p => '/ext/' + p, sendMessage: (m, cb) => { const p = reply(m); if (cb) p.then(cb); return p; } },
    storage: { local: { get, set: o => { Object.assign(store, o); return Promise.resolve(); }, remove: () => Promise.resolve() },
      onChanged: { addListener() {} } },
  };
  // a <video> that never plays: the time is set from outside
  let t = 0, paused = false;
  window.__setT = x => { t = x; };
  addEventListener('DOMContentLoaded', () => {
    const v = document.querySelector('video');
    Object.defineProperty(v, 'currentTime', { get: () => t, set: x => { t = x; } });
    Object.defineProperty(v, 'paused', { get: () => paused });
    Object.defineProperty(v, 'duration', { get: () => 50 * 60 });
    v.pause = () => { paused = true; }; v.play = () => { paused = false; return Promise.resolve(); };
  });
  addEventListener('message', e => { if (e.data && e.data.__nds === 'seek') t = e.data.ms / 1000; });
})();`;

// Screenshot-only overlay: a mouse pointer (headless Chrome draws none) and numbered
// callouts explaining what is on screen. Not part of the extension.
const OVERLAY = `
window.__ov = (() => {
  const layer = document.createElement('div');
  layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;overflow:visible';
  layer.appendChild(svg);
  const mount = () => { if (!layer.parentNode) document.documentElement.appendChild(layer); };
  return {
    clear() { layer.querySelectorAll('.ov').forEach(e => e.remove()); svg.innerHTML = ''; },
    cursor(x, y) {
      mount();
      const c = document.createElement('div'); c.className = 'ov';
      c.style.cssText = 'position:absolute;left:' + (x - 2) + 'px;top:' + (y - 1) + 'px;filter:drop-shadow(0 2px 3px rgba(0,0,0,.5))';
      c.innerHTML = '<svg viewBox="0 0 17 25" width="24" height="35"><path d="M1.2 1.2 L1.2 20.5 L5.8 16.2 L9 23.6 L12.2 22.2 L9.1 15 L15.4 15 Z" fill="#111" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>';
      layer.appendChild(c);
    },
    label({ n, text, x, y, w, tx, ty }) {
      mount();
      const d = document.createElement('div'); d.className = 'ov';
      d.style.cssText = 'position:absolute;left:' + x + 'px;top:' + y + 'px;width:' + w + 'px;box-sizing:border-box;display:flex;gap:10px;align-items:flex-start;' +
        'padding:11px 15px;border-radius:14px;background:rgba(255,255,255,.97);color:#16161a;box-shadow:0 8px 28px rgba(0,0,0,.45);' +
        'font:600 19px/1.38 -apple-system,"Helvetica Neue",sans-serif';
      d.innerHTML = '<b style="flex:none;display:grid;place-items:center;width:28px;height:28px;border-radius:50%;background:#ff5a5f;color:#fff;font-size:17px">' + n + '</b><span>' + text + '</span>';
      layer.appendChild(d);
      const r = d.getBoundingClientRect();
      const ax = Math.max(r.left + 14, Math.min(tx, r.right - 14)), ay = Math.max(r.top + 10, Math.min(ty, r.bottom - 10));
      const ns = 'http://www.w3.org/2000/svg';
      const ln = document.createElementNS(ns, 'line');
      Object.entries({ x1: ax, y1: ay, x2: tx, y2: ty, stroke: '#fff', 'stroke-width': 3, 'stroke-linecap': 'round' }).forEach(([k, v]) => ln.setAttribute(k, v));
      const dot = document.createElementNS(ns, 'circle');
      Object.entries({ cx: tx, cy: ty, r: 7, fill: '#ff5a5f', stroke: '#fff', 'stroke-width': 3 }).forEach(([k, v]) => dot.setAttribute(k, v));
      svg.prepend(ln); svg.appendChild(dot);
    },
  };
})();`;

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Demo</title>
<link rel="stylesheet" href="/ext/styles.css">
<style>
  html, body { margin: 0; height: 100%; background: #000; overflow: hidden; font-family: -apple-system, "Hiragino Sans", sans-serif; }
  .scene { position: fixed; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  video { position: fixed; inset: 0; width: 100%; height: 100%; background: transparent; }
</style></head><body>
<img class="scene" src="/scene.svg" alt=""><video></video>
<script>${STUB}</script>
<script>${OVERLAY}</script>
<script src="/ext/lib.js"></script>
<script src="/ext/content.js"></script>
<script>
  setTimeout(() => postMessage({ __nds: 'tracks', movieId: '${MOVIE}',
    tracks: [{ lang: 'en', type: 'subtitles', forced: false, urls: { 'webvtt-lssdh-ios8': '/en.vtt' } }] }, '*'), 300);
</script>
</body></html>`;

const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  if (u.startsWith('/ext/')) {
    const f = path.join(EXT, path.normalize(u.slice(5)));
    if (!f.startsWith(EXT) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
    const type = { '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' }[path.extname(f)] || 'application/octet-stream';
    res.writeHead(200, { 'content-type': type }); return fs.createReadStream(f).pipe(res);
  }
  if (u === '/en.vtt') { res.writeHead(200, { 'content-type': 'text/vtt' }); return res.end(VTT); }
  if (u === '/scene.svg') { res.writeHead(200, { 'content-type': 'image/svg+xml' }); return res.end(sceneSvg()); }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(PAGE);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'nds-shots-'));
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--window-size=1440,810', 'about:blank']);
const wsUrl = await new Promise((resolve, reject) => {
  let err = '';
  chrome.stderr.on('data', d => { err += d; const m = err.match(/ws:\/\/[^\s]+/); if (m) resolve(m[0]); });
  chrome.on('exit', c => reject(new Error('Chrome exited ' + c + '\n' + err)));
});
const port = new URL(wsUrl).port;
const page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r));
let seq = 0; const pending = new Map();
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise((res, rej) => {
  const id = ++seq; pending.set(id, m => (m.error ? rej(new Error(method + ': ' + m.error.message)) : res(m.result)));
  ws.send(JSON.stringify({ id, method, params }));
});
const sleep = ms => new Promise(r => setTimeout(r, ms));
const js = async expr => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.value;
const until = async (expr, what, ms = 10000) => {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(100)) if (await js(expr)) return;
  throw new Error('timed out waiting for ' + what + ' | ' + await js(`(document.querySelector('.nds-status') || {}).textContent + ' rows=' + document.querySelectorAll('.nds-row').length`));
};
const mouse = (type, x, y) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: 1 });
const center = async sel => js(`(() => { const r = (${sel}).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
// bounds of an element's text (block elements can be much wider than their text)
const box = async sel => js(`(() => { const e = ${sel}; const g = document.createRange(); g.selectNodeContents(e);
  const r = g.getBoundingClientRect().width ? g.getBoundingClientRect() : e.getBoundingClientRect();
  return { l: r.left, t: r.top, r: r.right, b: r.bottom, cx: r.left + r.width / 2, cy: r.top + r.height / 2 }; })()`);
const label = o => js(`__ov.label(${JSON.stringify(o)})`);
const click = async (x, y) => { await mouse('mouseMoved', x, y); await sleep(250); await mouse('mousePressed', x, y); await mouse('mouseReleased', x, y); };
const shot = async name => {
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, name), Buffer.from(data, 'base64'));
  console.log('wrote docs/' + name);
};

try {
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 810, deviceScaleFactor: 2, mobile: false });
  await send('Page.navigate', { url: `${base}/watch/${MOVIE}` });
  await until(`document.querySelectorAll('.nds-row').length >= 12`, 'subtitle rows');
  await until(`[...document.querySelectorAll('.nds-row')].every(r => /[ぁ-んァ-ン一-龥]/.test(r.textContent))`, 'translations');

  // 1) the current line, with the AI explanation of "pull it off" open
  await js('__setT(27)');
  await sleep(800);
  const word = `[...document.querySelectorAll('#nds-sub .nds-en *')].find(e => e.children.length === 0 && e.textContent.trim() === 'pull')`;
  await until(word, 'the word "pull"');
  const w = await box(word);
  await click(w.cx, w.cy);
  await until(`/やってのける/.test(document.body.innerText)`, 'the AI explanation');
  await sleep(1200); // the popup fades in
  const pop = await box(`document.querySelector('#nds-pop')`);
  const en = await box(`document.querySelector('#nds-sub .nds-en')`);
  const ja = await box(`document.querySelector('#nds-sub .nds-ja')`);
  const row = await box(`document.querySelector('.nds-row.on')`);
  const panel = await box(`document.querySelector('#nds-panel')`);
  await label({ n: 1, text: 'Click a word: what it means <u>in this line</u>, who you can say it to, and an example (AI)',
    x: 36, y: 44, w: 410, tx: pop.l - 8, ty: pop.t + 70 });
  await label({ n: 2, text: 'English + Japanese subtitles', x: 36, y: (en.t + ja.b) / 2 - 24, w: Math.min(300, Math.min(en.l, ja.l) - 100), tx: Math.min(en.l, ja.l) - 14, ty: (en.t + ja.b) / 2 });
  const x3 = Math.max(en.r, ja.r) + 28;
  await label({ n: 3, text: 'Transcript of the episode: click any line to jump there', x: x3, y: en.t - 6, w: panel.l - x3 - 18, tx: panel.l + 8, ty: row.cy });
  await js(`__ov.cursor(${w.r - 8}, ${w.b - 12})`);
  await shot('screenshot-lookup.png');

  // 2) the review tab: a meaning question, answered
  await js('__ov.clear()');
  await mouse('mouseMoved', 600, 150); await sleep(300);
  await js('Math.random = () => 0'); // a fixed question
  const [qx, qy] = await center(`document.querySelector('[data-tab="quiz"]')`);
  await click(qx, qy);
  await until(`document.querySelectorAll('.nds-qc').length === 4`, 'the quiz choices');
  const right = `[...document.querySelectorAll('.nds-qc')].find(b => /${SAVED[0].mean}/.test(b.textContent))`;
  const c = await box(right);
  await click(c.cx, c.cy);
  await sleep(600);
  const quiz = await box(`document.querySelector('.nds-quiz')`);
  await label({ n: 4, text: 'Review the words you looked up: four kinds of questions, spaced 1 to 21 days apart',
    x: 500, y: 56, w: 410, tx: panel.l + 8, ty: quiz.t + 60 });
  await js(`__ov.cursor(${c.l + 60}, ${c.cy + 4})`);
  await shot('screenshot-review.png');
} finally {
  ws.close(); chrome.kill(); server.close();
  setTimeout(() => fs.rmSync(profile, { recursive: true, force: true }), 500);
}
