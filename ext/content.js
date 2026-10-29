// Main UI: dual subtitles, subtitle list panel, hover dictionary, shortcuts.
(() => {
  'use strict';
  const N = self.NDS;

  const S = {
    tracksByMovie: {},
    lastTracksMovie: null,
    movieId: null,
    cues: [],          // {start, end, en, ja}
    jaSource: 'none',  // 'netflix' | 'machine' | 'none'
    source: 'none',    // 'track' | 'dom'
    idx: -1,
    pausedAt: -1,
    hoverPaused: false,
    dict: null,
    translator: null,
    translating: false,
    status: '',
    saved: [],
    settings: { showJa: true, hideNetflix: true, autoPause: false, hoverPause: true, panel: true },
    userScrollAt: 0,
  };

  // ---------- storage ----------
  const saveSettings = () => chrome.storage.local.set({ nds_settings: S.settings });
  const saveSaved = () => chrome.storage.local.set({ nds_saved: S.saved });

  fetch(chrome.runtime.getURL('dict.json')).then(r => r.json()).then(d => { S.dict = d; });

  // ---------- helpers ----------
  const $ = (sel, el = document) => el.querySelector(sel);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const video = () => $('video');
  const nowMs = () => { const v = video(); return v ? v.currentTime * 1000 : 0; };
  const watchId = () => { const m = location.pathname.match(/\/watch\/(\d+)/); return m ? m[1] : null; };
  const fmt = ms => { const s = Math.floor(ms / 1000); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  const seek = ms => window.postMessage({ __nds: 'seek', ms }, '*');
  const fetchText = url => new Promise((res, rej) =>
    chrome.runtime.sendMessage({ type: 'fetchText', url }, r => (r && r.ok ? res(r.text) : rej(new Error(r ? r.error : 'no response')))));

  // ---------- UI ----------
  const root = document.createElement('div');
  root.id = 'nds-root';
  root.innerHTML = `
    <div id="nds-sub"><div class="nds-en"></div><div class="nds-ja"></div></div>
    <div id="nds-panel">
      <div class="nds-head">
        <button data-tab="subs" class="on">字幕</button>
        <button data-tab="saved">保存</button>
        <span class="nds-sp"></span>
        <button class="nds-gear" title="設定">⚙</button>
        <button class="nds-close" title="パネルを閉じる">✕</button>
      </div>
      <div class="nds-settings" hidden>
        <label><input type="checkbox" data-k="showJa"> 日本語訳を表示</label>
        <label><input type="checkbox" data-k="hideNetflix"> Netflixの字幕を隠す</label>
        <label><input type="checkbox" data-k="autoPause"> 1文ごとに自動一時停止 (Q)</label>
        <label><input type="checkbox" data-k="hoverPause"> 単語にカーソルで一時停止</label>
        <div class="nds-keys">A 前の文 ・ S もう一度 ・ D 次の文 ・ Q 自動一時停止 ・ P パネル</div>
      </div>
      <div class="nds-status"></div>
      <div class="nds-list"></div>
      <div class="nds-saved" hidden></div>
    </div>
    <button id="nds-open" title="字幕パネル (P)">字</button>
    <div id="nds-pop" hidden></div>`;

  const subEn = $('.nds-en', root), subJa = $('.nds-ja', root), panel = $('#nds-panel', root);
  const list = $('.nds-list', root), savedBox = $('.nds-saved', root), pop = $('#nds-pop', root);
  const statusEl = $('.nds-status', root), settingsBox = $('.nds-settings', root);

  function mount() {
    const host = document.fullscreenElement || document.body;
    if (host && root.parentNode !== host) host.appendChild(root);
  }
  document.addEventListener('fullscreenchange', mount);

  function applySettings() {
    document.documentElement.classList.toggle('nds-hide-nf', !!(S.settings.hideNetflix && S.source === 'track' && S.cues.length));
    root.classList.toggle('nds-noja', !S.settings.showJa);
    root.classList.toggle('nds-panel-on', !!S.settings.panel);
    settingsBox.querySelectorAll('input[data-k]').forEach(i => { i.checked = !!S.settings[i.dataset.k]; });
  }
  settingsBox.addEventListener('change', e => {
    const k = e.target.dataset.k; if (!k) return;
    S.settings[k] = e.target.checked; saveSettings(); applySettings();
  });
  $('.nds-gear', root).onclick = () => { settingsBox.hidden = !settingsBox.hidden; };
  $('.nds-close', root).onclick = () => togglePanel(false);
  $('#nds-open', root).onclick = () => togglePanel(true);
  function togglePanel(on) {
    S.settings.panel = on === undefined ? !S.settings.panel : on; saveSettings(); applySettings();
    if (S.settings.panel) scrollToActive(true);
  }
  panel.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => {
    panel.querySelectorAll('[data-tab]').forEach(x => x.classList.toggle('on', x === b));
    list.hidden = b.dataset.tab !== 'subs';
    savedBox.hidden = b.dataset.tab !== 'saved';
    if (!savedBox.hidden) renderSaved();
  });
  // stop Netflix from treating clicks/keys inside our UI as player input
  for (const ev of ['click', 'mousedown', 'mouseup', 'dblclick', 'wheel']) {
    panel.addEventListener(ev, e => e.stopPropagation());
    pop.addEventListener(ev, e => e.stopPropagation());
    $('#nds-sub', root).addEventListener(ev, e => e.stopPropagation());
  }
  list.addEventListener('wheel', () => { S.userScrollAt = Date.now(); }, { passive: true });

  function setStatus(s) { S.status = s; statusEl.textContent = s; statusEl.hidden = !s; }

  // ---------- subtitle list ----------
  function renderList() {
    list.innerHTML = S.cues.map((c, k) =>
      `<div class="nds-row" data-k="${k}"><span class="nds-t">${fmt(c.start)}</span>` +
      `<div class="nds-rt"><div class="nds-ren">${esc(c.en).replace(/\n/g, ' ')}</div>` +
      `<div class="nds-rja">${esc(c.ja || '').replace(/\n/g, ' ')}</div></div></div>`).join('');
  }
  list.addEventListener('click', e => {
    const row = e.target.closest('.nds-row'); if (!row) return;
    const c = S.cues[+row.dataset.k]; if (c) { S.pausedAt = -1; seek(c.start); }
  });
  function updateRowJa(k) {
    const r = list.querySelector(`.nds-row[data-k="${k}"] .nds-rja`);
    if (r) r.textContent = (S.cues[k].ja || '').replace(/\n/g, ' ');
  }
  function scrollToActive(force) {
    if (!S.settings.panel || (!force && Date.now() - S.userScrollAt < 4000)) return;
    const r = list.querySelector('.nds-row.on');
    if (r) r.scrollIntoView({ block: 'center', behavior: force ? 'auto' : 'smooth' });
  }

  // ---------- current line ----------
  function renderSub() {
    const c = S.cues[S.idx];
    if (!c) { subEn.innerHTML = ''; subJa.textContent = ''; return; }
    let wi = 0;
    subEn.innerHTML = c.en.split('\n').map(line =>
      '<div>' + N.tokenize(line).map(tok => tok.w
        ? `<span class="nds-w" data-i="${wi++}">${esc(tok.t)}</span>`
        : esc(tok.t)).join('') + '</div>').join('');
    subJa.textContent = c.ja || '';
  }
  function currentIndex(t) {
    const cs = S.cues; let lo = 0, hi = cs.length - 1, ans = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (cs[m].start <= t + 40) { ans = m; lo = m + 1; } else hi = m - 1; }
    return ans;
  }

  setInterval(() => {
    const id = watchId();
    root.style.display = id ? '' : 'none';
    if (!id) return;
    mount();
    if (id !== S.movieId) startMovie(id);
    if (!S.cues.length) return;
    const v = video(); if (!v) return;
    const t = nowMs();
    // auto-pause at the end of the line that was playing
    if (S.settings.autoPause && S.idx >= 0 && !v.paused && S.pausedAt !== S.idx) {
      const c = S.cues[S.idx];
      if (t >= c.end - 60 && t < c.end + 400) { v.pause(); S.pausedAt = S.idx; }
    }
    const k = currentIndex(t);
    if (k !== S.idx) {
      S.idx = k;
      renderSub();
      list.querySelectorAll('.nds-row.on').forEach(r => r.classList.remove('on'));
      const row = list.querySelector(`.nds-row[data-k="${k}"]`);
      if (row) row.classList.add('on');
      scrollToActive(false);
      pumpTranslations();
    }
    root.classList.toggle('nds-gap', S.idx >= 0 && t > S.cues[S.idx].end + 800);
  }, 100);

  // ---------- loading subtitles ----------
  window.addEventListener('message', ev => {
    if (ev.source !== window || !ev.data || ev.data.__nds !== 'tracks') return;
    const { movieId, tracks } = ev.data;
    if (!movieId || !tracks.length) return;
    S.tracksByMovie[movieId] = tracks;
    S.lastTracksMovie = movieId;
    if (S.movieId === movieId && S.source !== 'track') loadTracks(movieId);
  });

  let domTimer = null;
  function startMovie(id) {
    S.movieId = id; S.cues = []; S.idx = -1; S.source = 'none'; S.jaSource = 'none'; S.pausedAt = -1;
    list.innerHTML = ''; renderSub(); applySettings();
    setStatus('字幕を読み込み中…');
    clearTimeout(domTimer);
    if (S.tracksByMovie[id]) loadTracks(id);
    domTimer = setTimeout(() => { if (S.movieId === id && S.source === 'none') startDomMode(); }, 9000);
  }

  function pickTrack(tracks, lang) {
    const c = tracks.filter(t => t.lang.toLowerCase().startsWith(lang) && !t.forced);
    c.sort((a, b) => (a.type === 'subtitles' ? 0 : 1) - (b.type === 'subtitles' ? 0 : 1));
    return c[0];
  }
  function pickUrl(track) {
    const order = ['webvtt-lssdh-ios8', 'dfxp-ls-sdh', 'simplesdh', 'imsc1.1'];
    for (const p of order) if (track.urls[p]) return track.urls[p];
    const any = Object.keys(track.urls).find(p => !/cmisc|image/i.test(p));
    return any ? track.urls[any] : null;
  }
  async function loadSub(track) {
    const url = track && pickUrl(track);
    if (!url) return null;
    const cues = N.parseSubtitles(await fetchText(url));
    return cues.length ? cues : null;
  }

  async function loadTracks(id) {
    const tracks = S.tracksByMovie[id];
    try {
      const en = await loadSub(pickTrack(tracks, 'en'));
      if (S.movieId !== id) return;
      if (!en) { setStatus('この作品は英語字幕が見つかりませんでした'); return; }
      S.cues = en.map(c => ({ start: c.start, end: c.end, en: c.text, ja: '' }));
      S.source = 'track';
      let ja = null;
      try { ja = await loadSub(pickTrack(tracks, 'ja')); } catch (e) { /* fall back to machine translation */ }
      if (S.movieId !== id) return;
      if (ja) {
        N.alignCues(en, ja).forEach((t, k) => { S.cues[k].ja = t; });
        S.jaSource = 'netflix';
        setStatus('');
      } else {
        S.jaSource = 'machine';
        setStatus('日本語字幕がないため、Chrome内蔵の翻訳を使います');
        initTranslator(false);
      }
      S.idx = -1; renderList(); applySettings();
    } catch (e) {
      console.warn('[NDS] subtitle load failed', e);
      setStatus('字幕の取得に失敗しました。ページを再読み込みしてください');
    }
  }

  // Fallback: read the lines Netflix itself renders (works without the track list,
  // but the list only grows as you watch).
  function startDomMode() {
    S.source = 'dom'; S.jaSource = 'machine';
    setStatus('簡易モード：Netflixの字幕を英語にしてください（一覧は再生に合わせて増えます）');
    initTranslator(false);
    let last = '';
    const obs = new MutationObserver(() => {
      if (S.source !== 'dom') { obs.disconnect(); return; }
      const box = $('.player-timedtext');
      const text = box ? N.cleanText(box.innerHTML) : '';
      if (!text || text === last) return;
      last = text;
      const t = nowMs();
      const prev = S.cues[S.cues.length - 1];
      if (prev && prev.end > t) prev.end = t;
      S.cues.push({ start: t, end: t + 4000, en: text, ja: '' });
      S.cues.sort((a, b) => a.start - b.start);
      renderList(); S.idx = -1; pumpTranslations();
    });
    obs.observe(document.body, { subtree: true, childList: true, characterData: true });
  }

  // ---------- machine translation (Chrome built-in Translator API) ----------
  async function initTranslator(fromGesture) {
    if (S.translator) return pumpTranslations();
    if (!('Translator' in self)) { setStatus('このChromeでは内蔵翻訳が使えません（Chrome 138以降のPC版が必要）'); return; }
    try {
      const opts = { sourceLanguage: 'en', targetLanguage: 'ja' };
      const av = await Translator.availability(opts);
      if (av === 'unavailable') { setStatus('英→日の内蔵翻訳がこの環境では使えません'); return; }
      if (av !== 'available' && !fromGesture) {
        setStatus('');
        statusEl.innerHTML = '翻訳モデルが未ダウンロードです <button class="nds-dl">ダウンロードして有効化</button>';
        statusEl.hidden = false;
        $('.nds-dl', statusEl).onclick = e => { e.stopPropagation(); initTranslator(true); };
        return;
      }
      setStatus('翻訳モデルを準備中…');
      S.translator = await Translator.create({
        ...opts,
        monitor(m) { m.addEventListener('downloadprogress', e => setStatus(`翻訳モデルをダウンロード中… ${Math.round(e.loaded * 100)}%`)); },
      });
      setStatus('');
      pumpTranslations();
    } catch (e) {
      console.warn('[NDS] translator', e);
      setStatus('翻訳の準備に失敗しました');
    }
  }

  async function pumpTranslations() {
    if (!S.translator || S.translating || S.jaSource !== 'machine') return;
    S.translating = true;
    const cues = S.cues;
    let stale = false;
    try {
      for (;;) {
        const from = Math.max(0, S.idx);
        let k = cues.findIndex((c, j) => j >= from && !c.ja);
        if (k < 0) k = cues.findIndex(c => !c.ja);
        if (k < 0) break;
        const c = cues[k];
        const ja = await S.translator.translate(c.en.replace(/\n/g, ' ')) || ' ';
        // the movie changed while translating: drop the result and start over on the new cues
        if (S.cues !== cues) { stale = true; break; }
        c.ja = ja;
        k = cues.indexOf(c); // DOM mode may have re-sorted the list in the meantime
        updateRowJa(k);
        if (k === S.idx) subJa.textContent = c.ja;
      }
    } catch (e) { console.warn('[NDS] translate', e); }
    S.translating = false;
    if (stale) pumpTranslations();
  }

  // ---------- hover dictionary ----------
  let hoverCtx = null;
  subEn.addEventListener('mouseover', e => {
    const w = e.target.closest('.nds-w');
    if (!w || !S.dict) return;
    const c = S.cues[S.idx]; if (!c) return;
    const words = N.tokenize(c.en.replace(/\n/g, ' ')).filter(t => t.w).map(t => t.w);
    const i = +w.dataset.i;
    const word = N.lookupWord(S.dict, words[i]);
    const phrase = N.lookupPhrase(S.dict, words, i);
    subEn.querySelectorAll('.nds-hl').forEach(x => x.classList.remove('nds-hl'));
    if (phrase) for (let j = phrase.start; j < phrase.end; j++) {
      const s = subEn.querySelector(`.nds-w[data-i="${j}"]`); if (s) s.classList.add('nds-hl');
    }
    w.classList.add('nds-hl');
    hoverCtx = { word, phrase, surface: words[i], cue: c };
    showPop(w, hoverCtx);
    const v = video();
    if (S.settings.hoverPause && v && !v.paused) { v.pause(); S.hoverPaused = true; }
  });

  function entryHtml(head, mean, kind, maxSenses = 5) {
    mean = mean.split(' / ').slice(0, maxSenses).join(' / ');
    return `<div class="nds-e"><div class="nds-eh"><b>${esc(head)}</b>` +
      (kind ? `<span class="nds-kind">${kind}</span>` : '') +
      `<button class="nds-star" data-head="${esc(head)}" title="保存">☆</button></div>` +
      `<div class="nds-em">${esc(mean).replace(/ \/ /g, '<br>')}</div></div>`;
  }
  function showPop(anchor, ctx) {
    let html = '';
    if (ctx.phrase) html += entryHtml(ctx.phrase.head, ctx.phrase.mean, '熟語');
    if (ctx.word) html += entryHtml(ctx.word.head, ctx.word.mean, ctx.phrase ? '単語' : '', ctx.phrase ? 2 : 5);
    if (!html) html = `<div class="nds-e"><b>${esc(ctx.surface)}</b><div class="nds-em">辞書に見つかりませんでした</div></div>`;
    pop.innerHTML = html;
    pop.querySelectorAll('.nds-star').forEach(b => {
      if (S.saved.some(s => s.head === b.dataset.head)) { b.textContent = '★'; b.classList.add('on'); }
    });
    pop.hidden = false;
    const r = anchor.getBoundingClientRect();
    const pw = Math.min(360, window.innerWidth - 16);
    pop.style.width = pw + 'px';
    pop.style.left = Math.max(8, Math.min(window.innerWidth - pw - 8, r.left + r.width / 2 - pw / 2)) + 'px';
    pop.style.bottom = (window.innerHeight - r.top - 2) + 'px'; // overlap slightly so the mouse can move onto it
  }
  pop.addEventListener('click', e => {
    const b = e.target.closest('.nds-star'); if (!b || !hoverCtx) return;
    const head = b.dataset.head;
    const at = S.saved.findIndex(s => s.head === head);
    if (at >= 0) { S.saved.splice(at, 1); b.textContent = '☆'; b.classList.remove('on'); }
    else {
      const ent = [hoverCtx.phrase, hoverCtx.word].find(x => x && x.head === head);
      S.saved.unshift({ head, mean: ent ? ent.mean : '', context: hoverCtx.cue.en.replace(/\n/g, ' '),
        ja: (hoverCtx.cue.ja || '').replace(/\n/g, ' '), movieId: S.movieId, time: hoverCtx.cue.start, at: Date.now() });
      b.textContent = '★'; b.classList.add('on');
    }
    saveSaved();
  });

  function endHover(e) {
    const to = e.relatedTarget;
    if (to && (subEn.contains(to) || pop.contains(to))) return;
    pop.hidden = true; hoverCtx = null;
    subEn.querySelectorAll('.nds-hl').forEach(x => x.classList.remove('nds-hl'));
    const v = video();
    if (S.hoverPaused && v && v.paused) v.play();
    S.hoverPaused = false;
  }
  subEn.addEventListener('mouseleave', endHover);
  pop.addEventListener('mouseleave', endHover);

  // ---------- saved words ----------
  function renderSaved() {
    if (!S.saved.length) { savedBox.innerHTML = '<div class="nds-empty">単語にカーソルを合わせて ☆ を押すと保存できます</div>'; return; }
    savedBox.innerHTML = `<div class="nds-sbar">${S.saved.length}件 <button class="nds-csv">Anki用CSVを保存</button></div>` +
      S.saved.map((s, k) => `<div class="nds-srow"><div><b>${esc(s.head)}</b> <span class="nds-sm">${esc(s.mean.split(' / ')[0])}</span></div>` +
        `<div class="nds-sc">${esc(s.context)}</div><button class="nds-del" data-k="${k}" title="削除">✕</button></div>`).join('');
  }
  savedBox.addEventListener('click', e => {
    if (e.target.closest('.nds-del')) { S.saved.splice(+e.target.dataset.k, 1); saveSaved(); renderSaved(); return; }
    if (e.target.closest('.nds-csv')) {
      const q = s => '"' + String(s).replace(/"/g, '""') + '"';
      const csv = S.saved.map(s => [q(s.head), q(s.mean.replace(/ \/ /g, '<br>') + '<br><br>' + s.context + (s.ja ? '<br>' + s.ja : ''))].join(',')).join('\n');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' }));
      a.download = 'netflix-words.csv'; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }
  });

  // ---------- keyboard shortcuts ----------
  window.addEventListener('keydown', e => {
    if (!watchId() || e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = (e.target && e.target.tagName) || '';
    if (/INPUT|TEXTAREA|SELECT/.test(tag) || (e.target && e.target.isContentEditable)) return;
    const key = e.key.toLowerCase();
    if (!['a', 's', 'd', 'q', 'p'].includes(key)) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (key === 'p') return togglePanel();
    if (key === 'q') { S.settings.autoPause = !S.settings.autoPause; saveSettings(); applySettings(); flash(S.settings.autoPause ? '自動一時停止 ON' : '自動一時停止 OFF'); return; }
    if (!S.cues.length) return;
    const t = nowMs(), cur = Math.max(0, currentIndex(t));
    let target = cur;
    if (key === 'a') target = (S.cues[cur] && t - S.cues[cur].start > 1500) ? cur : Math.max(0, cur - 1);
    if (key === 'd') target = Math.min(S.cues.length - 1, currentIndex(t) + 1);
    S.pausedAt = -1;
    seek(S.cues[target].start);
    const v = video(); if (v && v.paused) v.play();
  }, true);

  function flash(msg) {
    const f = document.createElement('div'); f.className = 'nds-flash'; f.textContent = msg;
    root.appendChild(f); setTimeout(() => f.remove(), 1200);
  }

  chrome.storage.local.get(['nds_settings', 'nds_saved'], r => {
    Object.assign(S.settings, r.nds_settings || {});
    S.saved = r.nds_saved || [];
    applySettings();
  });
  applySettings();
})();
