// Main UI: dual subtitles, subtitle list panel, hover dictionary, shortcuts.
(() => {
  'use strict';
  const N = self.NDS;

  const S = {
    tracksByMovie: {},
    lastTracksMovie: null,
    movieId: null,
    cues: [],          // {start, end, en, ja (shown), jaNf (Netflix's), jaMt (machine)}
    jaSource: 'none',  // 'netflix' | 'machine' | 'none'
    hasOfficialJa: false,
    googleFailedAt: 0,
    source: 'none',    // 'track' | 'dom'
    idx: -1,
    pausedAt: -1,
    hoverPaused: false,
    dict: null,
    translator: null,
    translating: false,
    status: '',
    saved: [],
    settings: { showJa: true, jaBlur: true, jaBottom: false, jaOfficial: false, hideNetflix: true, autoPause: false, hoverPause: true, panel: true },
    userScrollAt: 0,
  };

  // ---------- storage ----------
  // After the extension is reloaded, a content script left in an open tab loses chrome.*
  // until the page is reloaded; say so instead of throwing.
  const alive = () => { try { return !!chrome.runtime.id; } catch (e) { return false; } };
  const orphaned = () => { setStatus('拡張機能が更新されました。ページを再読み込みしてください'); return false; };
  const saveSettings = () => alive() ? chrome.storage.local.set({ nds_settings: S.settings }) : orphaned();
  const saveSaved = () => alive() ? chrome.storage.local.set({ nds_saved: S.saved }) : orphaned();

  fetch(chrome.runtime.getURL('dict.json')).then(r => r.json()).then(d => { S.dict = d; });

  // ---------- helpers ----------
  const $ = (sel, el = document) => el.querySelector(sel);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const video = () => $('video');
  const nowMs = () => { const v = video(); return v ? v.currentTime * 1000 : 0; };
  const watchId = () => { const m = location.pathname.match(/\/watch\/(\d+)/); return m ? m[1] : null; };
  const fmt = ms => { const s = Math.floor(ms / 1000); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  const seek = ms => window.postMessage({ __nds: 'seek', ms }, '*');
  const fetchText = url => !alive() ? (orphaned(), Promise.reject(new Error('extension reloaded'))) : new Promise((res, rej) =>
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
        <label><input type="checkbox" data-k="jaBlur"> 右の日本語をぼかす（カーソルを合わせると表示）</label>
        <label><input type="checkbox" data-k="jaBottom"> 動画の下の字幕にも日本語を出す</label>
        <label><input type="checkbox" data-k="jaOfficial"> Netflix公式の日本語字幕を使う（意訳・省略あり）</label>
        <label><input type="checkbox" data-k="hideNetflix"> Netflixの字幕を隠す</label>
        <label><input type="checkbox" data-k="autoPause"> 1文ごとに自動一時停止 (Q)</label>
        <label><input type="checkbox" data-k="hoverPause"> 単語にカーソルで一時停止</label>
        <div class="nds-gk">単語の解説：<span class="nds-gstate"></span> <button class="nds-gset">APIキーを設定</button></div>
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
    root.classList.toggle('nds-ja-bottom', !!S.settings.jaBottom);
    root.classList.toggle('nds-ja-blur', !!S.settings.jaBlur);
    root.classList.toggle('nds-panel-on', !!S.settings.panel);
    settingsBox.querySelectorAll('input[data-k]').forEach(i => { i.checked = !!S.settings[i.dataset.k]; });
  }
  settingsBox.addEventListener('change', e => {
    const k = e.target.dataset.k; if (!k) return;
    S.settings[k] = e.target.checked; saveSettings(); applySettings();
    if (k === 'jaOfficial') applyJaMode();
  });
  // The AI keys are entered on the extension's options page and never come into this
  // page: background.js holds them (keystore.js). Here we only get the flag nds_ai saying
  // which AI is set up: Claude, else Gemini, else Chrome's built-in model.
  const setAi = ai => {
    S.ai = ai || '';
    $('.nds-gstate', root).textContent = { claude: 'Claude Haiku', gemini: 'Gemini（無料枠）', '': 'Chrome 内蔵AI' }[S.ai];
    ctxCache.clear();
  };
  $('.nds-gset', root).onclick = () => (alive() ? chrome.runtime.sendMessage({ type: 'openOptions' }) : orphaned());
  chrome.storage.onChanged.addListener(ch => { if (ch.nds_ai) setAi(ch.nds_ai.newValue); });
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
      `<div class="nds-rt"><div class="nds-ren">${wordsHtml([c.en.replace(/\n/g, ' ')])[0]}</div>` +
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
    subEn.innerHTML = wordsHtml(c.en.split('\n')).map(h => '<div>' + h + '</div>').join('');
    subJa.textContent = c.ja || '';
  }
  // Lines of English as hoverable word spans; data-i numbers the words across all lines.
  function wordsHtml(lines) {
    let wi = 0;
    return lines.map(line => N.tokenize(line).map(tok => tok.w
      ? `<span class="nds-w" data-i="${wi++}">${esc(tok.t)}</span>`
      : esc(tok.t)).join(''));
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
    if (S.movieId !== movieId || S.loadingId === movieId) return;
    if (S.source !== 'track') loadTracks(movieId);
    // the Japanese track can get its URL after the English one: pick it up late
    else if (!S.hasOfficialJa) loadJa(movieId).then(ok => { if (ok && S.settings.jaOfficial) applyJaMode(); });
  });

  let domTimer = null;
  function startMovie(id) {
    S.movieId = id; S.cues = []; S.idx = -1; S.source = 'none'; S.jaSource = 'none'; S.hasOfficialJa = false; S.pausedAt = -1;
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
    S.loadingId = id;
    try {
      const en = await loadSub(pickTrack(S.tracksByMovie[id], 'en'));
      if (S.movieId !== id) return;
      if (!en) { setStatus('この作品は英語字幕が見つかりませんでした'); return; }
      S.cues = en.map(c => ({ start: c.start, end: c.end, en: c.text, ja: '' }));
      S.source = 'track';
      const ja = await loadJa(id);
      if (S.movieId !== id) return;
      setStatus(!ja && S.settings.jaOfficial ? 'Netflixの日本語字幕がないため、機械翻訳を使います' : '');
      applyJaMode(); applySettings();
    } catch (e) {
      if (!alive()) return orphaned(); // extension reloaded: already told the user to reload the page
      console.warn('[NDS] subtitle load failed', e);
      setStatus('字幕の取得に失敗しました。ページを再読み込みしてください');
    } finally {
      if (S.loadingId === id) S.loadingId = null;
    }
  }

  // Loads Netflix's Japanese subtitles into cue.jaNf; false when there are none (yet).
  async function loadJa(id) {
    let ja = null;
    try { ja = await loadSub(pickTrack(S.tracksByMovie[id], 'ja')); } catch (e) { /* machine translation still works */ }
    if (!ja || S.movieId !== id || S.source !== 'track') return false;
    N.alignCues(S.cues, ja).forEach((t, k) => { S.cues[k].jaNf = t; });
    S.hasOfficialJa = true;
    return true;
  }

  // Which Japanese to show: Netflix's official subtitles (natural but condensed) or
  // machine translation (stiffer but follows the English line by line).
  function applyJaMode() {
    if (S.source !== 'track') return;
    const official = S.settings.jaOfficial && S.hasOfficialJa;
    S.jaSource = official ? 'netflix' : 'machine';
    S.cues.forEach(c => { c.ja = (official ? c.jaNf : c.jaMt) || ''; });
    S.idx = -1; renderList(); renderSub();
    if (!official) startMachineTranslation();
  }

  // Fallback: read the lines Netflix itself renders (works without the track list,
  // but the list only grows as you watch).
  function startDomMode() {
    S.source = 'dom'; S.jaSource = 'machine';
    setStatus('簡易モード：Netflixの字幕を英語にしてください（一覧は再生に合わせて増えます）');
    startMachineTranslation();
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

  // Chrome's built-in Translator API (on-device), used when Google translate fails.
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

  // ---------- machine translation (Google Translate, Chrome's translator as fallback) ----------
  // Google's free endpoint picks up casual wording better than Chrome's on-device model.
  // When it fails (rate limit etc.), use Chrome's translator for 10 minutes, then retry.
  const googleOk = () => Date.now() - S.googleFailedAt > 10 * 60 * 1000;
  const startMachineTranslation = () => (googleOk() ? pumpTranslations() : initTranslator(false));
  const googleTranslate = texts => !alive() ? (orphaned(), Promise.reject(new Error('extension reloaded'))) : new Promise((res, rej) =>
    chrome.runtime.sendMessage({ type: 'gtranslate', texts }, r => (r && r.ok ? res(r.texts) : rej(new Error(r ? r.error : 'no response')))));

  // Dialogue cues ("-Hi.\n-Hey.") are translated one speaker at a time; other
  // multi-line cues are a single sentence wrapped, so translate them joined.
  const unitsOf = en => {
    const lines = en.split('\n');
    return lines.length > 1 && lines.every(l => /^\s*-/.test(l)) ? lines : [lines.join(' ')];
  };

  // Returns one Japanese string per English cue, or null while Chrome's translator
  // is still being set up (initTranslator restarts the pump when it is ready).
  async function translateBatch(ens) {
    const units = ens.map(unitsOf), flat = units.flat();
    let out = null;
    if (googleOk()) {
      try { out = await googleTranslate(flat); } catch (e) {
        console.warn('[NDS] Google translate failed, using Chrome\'s translator', e);
        S.googleFailedAt = Date.now();
      }
    }
    if (!out) {
      if (!S.translator) { initTranslator(false); return null; }
      out = [];
      for (const u of flat) out.push(await S.translator.translate(u));
    }
    let i = 0;
    return units.map(us => us.map(() => out[i++] || '').join('\n'));
  }

  async function pumpTranslations() {
    if (S.translating || S.jaSource !== 'machine' || (!googleOk() && !S.translator)) return;
    S.translating = true;
    const cues = S.cues;
    let stale = false;
    try {
      for (;;) {
        const from = Math.max(0, S.idx);
        let k = cues.findIndex((c, j) => j >= from && !c.jaMt);
        if (k < 0) k = cues.findIndex(c => !c.jaMt);
        if (k < 0) break;
        // this cue and the untranslated ones after it, up to ~1500 characters per request
        const batch = [];
        for (let j = k, len = 0; j < cues.length && !cues[j].jaMt && batch.length < 40; j++) {
          len += cues[j].en.length;
          if (batch.length && len > 1500) break;
          batch.push(cues[j]);
        }
        const out = await translateBatch(batch.map(c => c.en));
        // the movie changed while translating: drop the result and start over on the new cues
        if (S.cues !== cues) { stale = true; break; }
        if (!out) break;
        batch.forEach((c, i) => { c.jaMt = out[i] || ' '; });
        if (S.jaSource !== 'machine') break; // switched to Netflix's Japanese meanwhile
        for (const c of batch) {
          c.ja = c.jaMt;
          const i = cues.indexOf(c); // DOM mode may have re-sorted the list in the meantime
          updateRowJa(i);
          if (i === S.idx) subJa.textContent = c.ja;
        }
      }
    } catch (e) { console.warn('[NDS] translate', e); }
    S.translating = false;
    if (stale) pumpTranslations();
  }

  // ---------- hover dictionary ----------
  let hoverCtx = null;
  // Words can be looked up both in the subtitle under the video and in the side list.
  subEn.addEventListener('mouseover', e => onWordOver(e, subEn, S.cues[S.idx]));
  list.addEventListener('mouseover', e => {
    const row = e.target.closest('.nds-row'); if (!row) return;
    S.userScrollAt = Date.now(); // don't auto-scroll the list away while reading it
    onWordOver(e, row, S.cues[+row.dataset.k]);
  });
  list.addEventListener('mouseout', e => { if (e.target.closest('.nds-w')) endHover(e); });

  function onWordOver(e, box, c) {
    const w = e.target.closest('.nds-w');
    if (!w || !S.dict || !c) return;
    clearTimeout(hideTimer);
    const words = N.tokenize(c.en.replace(/\n/g, ' ')).filter(t => t.w).map(t => t.w);
    const i = +w.dataset.i;
    const word = N.lookupWord(S.dict, words[i]);
    const phrase = N.lookupPhrase(S.dict, words, i);
    root.querySelectorAll('.nds-hl').forEach(x => x.classList.remove('nds-hl'));
    if (phrase) for (let j = phrase.start; j < phrase.end; j++) {
      const s = box.querySelector(`.nds-w[data-i="${j}"]`); if (s) s.classList.add('nds-hl');
    }
    w.classList.add('nds-hl');
    const target = phrase ? words.slice(phrase.start, phrase.end).join(' ') : words[i];
    const ctx = hoverCtx = { word, phrase, surface: words[i], target, cue: c };
    showPop(w, ctx);
    setTimeout(() => { if (hoverCtx === ctx) askContext(ctx); }, 350); // only for words you stop on
    const v = video();
    if (S.settings.hoverPause && v && !v.paused) { v.pause(); S.hoverPaused = true; }
  }

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
    pop.innerHTML = (S.ai || lmState !== 'unavailable' ? '<div class="nds-ctx"></div>' : '') + html;
    pop.querySelectorAll('.nds-star').forEach(b => {
      if (S.saved.some(s => s.head === b.dataset.head)) { b.textContent = '★'; b.classList.add('on'); }
    });
    pop.hidden = false;
    const r = anchor.getBoundingClientRect();
    const pw = Math.min(360, window.innerWidth - 16);
    pop.style.width = pw + 'px';
    if (panel.contains(anchor)) {
      // side list: beside the panel, so the popup doesn't cover the lines around the word
      const top = r.top + r.height / 2 - pop.offsetHeight / 2;
      pop.style.left = Math.max(8, panel.getBoundingClientRect().left - pop.offsetWidth - 6) + 'px'; // offsetWidth includes padding
      pop.style.top = Math.max(8, Math.min(window.innerHeight - pop.offsetHeight - 8, top)) + 'px';
      pop.style.bottom = '';
      return;
    }
    // subtitle: above the word, overlapping slightly so the mouse can move onto it
    pop.style.left = Math.max(8, Math.min(window.innerWidth - pw - 8, r.left + r.width / 2 - pw / 2)) + 'px';
    pop.style.bottom = (window.innerHeight - r.top - 2) + 'px';
    pop.style.top = '';
  }
  pop.addEventListener('click', e => {
    if (e.target.closest('.nds-lm')) { const ctx = hoverCtx; lmInit(true).then(() => { if (ctx && hoverCtx === ctx) askContext(ctx); }); return; }
    const b = e.target.closest('.nds-star'); if (!b || !hoverCtx) return;
    const head = b.dataset.head;
    const at = S.saved.findIndex(s => s.head === head);
    if (at >= 0) { S.saved.splice(at, 1); b.textContent = '☆'; b.classList.remove('on'); }
    else {
      const ent = [hoverCtx.phrase, hoverCtx.word].find(x => x && x.head === head);
      S.saved.unshift({ head, mean: ent ? ent.mean : '', ctx: hoverCtx.ctxMean || '', info: hoverCtx.ctxInfo || null, context: hoverCtx.cue.en.replace(/\n/g, ' '),
        ja: (hoverCtx.cue.ja || '').replace(/\n/g, ' '), movieId: S.movieId, time: hoverCtx.cue.start, at: Date.now() });
      b.textContent = '★'; b.classList.add('on');
    }
    saveSaved();
  });

  function endHover(e) {
    const to = e.relatedTarget;
    // still on the subtitle, the popup, or another word in the list (its mouseover takes over)
    if (to && (subEn.contains(to) || pop.contains(to) || (list.contains(to) && to.closest('.nds-w')))) return;
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hidePop, 300); // time to move the mouse across to the popup
  }
  let hideTimer = null;
  function hidePop() {
    pop.hidden = true; hoverCtx = null;
    root.querySelectorAll('.nds-hl').forEach(x => x.classList.remove('nds-hl'));
    const v = video();
    if (S.hoverPaused && v && v.paused) v.play();
    S.hoverPaused = false;
  }
  subEn.addEventListener('mouseleave', endHover);
  pop.addEventListener('mouseleave', endHover);
  pop.addEventListener('mouseenter', () => clearTimeout(hideTimer));

  // ---------- meaning in context (Chrome's built-in AI, Gemini Nano: free, on-device) ----------
  const LM_OPTS = { expectedInputs: [{ type: 'text', languages: ['en'] }], expectedOutputs: [{ type: 'text', languages: ['ja', 'en'] }] };
  const LM_SYSTEM = 'あなたは日本人の英語学習者を助ける先生です。英語の字幕の1文（前後の文つき）と、その中の単語または熟語が与えられます。' +
    'その語を学ぶのに役立つ情報を、この場面での使われ方を中心に答えてください。' +
    'meaning: この文での意味（日本語、20文字以内）。usage: この場面での使われ方・ニュアンス・話し手の気持ち（日本語、60文字以内）。' +
    'pattern: よく使う形やコロケーション（英語、～で可変部分）。' +
    'example: patternを使った短く自然な英語の例文。exampleJa: その日本語訳。';
  const LM_SCHEMA = {
    type: 'object',
    properties: {
      meaning: { type: 'string' },
      usage: { type: 'string' },
      pattern: { type: 'string' },
      example: { type: 'string' },
      exampleJa: { type: 'string' },
    },
    required: ['meaning', 'usage', 'pattern', 'example', 'exampleJa'],
    additionalProperties: false,
  };
  const ctxCache = new Map(); // "cueStart|target" -> Promise<info object (LM_SCHEMA)>
  let lmBase = null, lmState = 'unknown'; // unknown | unavailable | downloadable | loading | ready

  async function lmInit(fromGesture) {
    if (lmBase || lmState === 'loading') return;
    let av = 'unavailable';
    try { if ('LanguageModel' in self) av = await LanguageModel.availability(LM_OPTS); } catch (e) { /* unavailable */ }
    if (av === 'unavailable') { lmState = 'unavailable'; return; }
    if (av !== 'available' && !fromGesture) { lmState = 'downloadable'; return; } // downloading needs a click
    lmState = 'loading';
    try {
      lmBase = await LanguageModel.create({
        ...LM_OPTS,
        initialPrompts: [{ role: 'system', content: LM_SYSTEM }],
        monitor(m) {
          m.addEventListener('downloadprogress', e => {
            const box = $('.nds-ctx', pop); if (box) box.textContent = `AIモデルをダウンロード中… ${Math.round(e.loaded * 100)}%`;
          });
        },
      });
      lmState = 'ready';
    } catch (e) {
      console.warn('[NDS] LanguageModel', e);
      lmState = 'downloadable';
    }
  }

  async function askContext(ctx) {
    const box = $('.nds-ctx', pop); if (!box) return;
    if (!S.ai) { // Chrome's built-in model: may still need setting up
      if (lmState === 'unknown') await lmInit(false);
      if (hoverCtx !== ctx) return;
      if (lmState === 'unavailable') { box.remove(); return; }
      if (lmState === 'downloadable') {
        box.innerHTML = '文脈での意味を出すには <button class="nds-lm">AIモデルをダウンロード（数GB・無料）</button>';
        return;
      }
      if (lmState === 'loading') { box.textContent = 'AIモデルを準備中…'; return; }
    }
    const key = ctx.cue.start + '|' + ctx.target.toLowerCase();
    const ask = { claude: askClaude, gemini: askGemini }[S.ai] || askNano;
    if (!ctxCache.has(key)) ctxCache.set(key, ask(contextPrompt(ctx.cue, ctx.target)));
    box.textContent = 'この文での使われ方：考え中…';
    try {
      const info = ctx.ctxInfo = await ctxCache.get(key);
      ctx.ctxMean = info.meaning;
      if (hoverCtx === ctx) box.innerHTML = infoHtml(info);
    } catch (e) {
      console.warn('[NDS] context meaning', e);
      ctxCache.delete(key);
      if (hoverCtx === ctx) {
        const ai = S.ai === 'claude' ? 'Claude' : 'Gemini';
        box.textContent = /credit balance/i.test(e) ? '（Claudeのクレジット残高がありません）'
          : /HTTP 429/.test(e) ? `（${ai}の回数制限です。少し待ってからもう一度）`
          : /HTTP 40[013]/.test(e) ? `（${ai}のAPIキーを確認してください）`
          : /HTTP 5\d\d/.test(e) ? `（${ai}が混雑しています。少し待ってからもう一度）` : '（文脈での意味を取得できませんでした）';
      }
    }
  }

  function contextPrompt(cue, target) {
    const k = S.cues.indexOf(cue), line = c => c.en.replace(/\n/g, ' ');
    return (S.cues[k - 1] ? `前の文: ${line(S.cues[k - 1])}\n` : '') + `文: ${line(cue)}\n` +
      (S.cues[k + 1] ? `次の文: ${line(S.cues[k + 1])}\n` : '') + `対象: ${target}`;
  }

  async function askNano(prompt) {
    const s = await lmBase.clone(); // fresh conversation each time so lookups don't pile up
    try { return JSON.parse(await s.prompt(prompt, { responseConstraint: LM_SCHEMA })); } finally { s.destroy(); }
  }

  // Claude / Gemini APIs through background.js (it holds the keys).
  const GEMINI_SCHEMA = { // Gemini's schema dialect
    type: 'OBJECT',
    properties: Object.fromEntries(LM_SCHEMA.required.map(k => [k, { type: 'STRING' }])),
    required: LM_SCHEMA.required,
    propertyOrdering: LM_SCHEMA.required,
  };
  const viaBackground = (type, schema) => prompt => {
    if (!alive()) { orphaned(); return Promise.reject(new Error('extension reloaded')); }
    return new Promise((res, rej) => chrome.runtime.sendMessage(
      { type, system: LM_SYSTEM, prompt, schema },
      r => (r && r.ok ? res(JSON.parse(r.text)) : rej(new Error(r ? r.error : 'no response')))));
  };
  const askClaude = viaBackground('claude', LM_SCHEMA); // plain JSON Schema
  const askGemini = viaBackground('gemini', GEMINI_SCHEMA);

  function infoHtml(info) {
    const row = (label, v) => (v ? `<div class="nds-ci"><span class="nds-cl">${label}</span>${v}</div>` : '');
    return `<div class="nds-cm"><span class="nds-kind">この文で</span> <b>${esc(info.meaning)}</b></div>` +
      row('使われ方', esc(info.usage)) +
      row('よく使う形', esc(info.pattern)) +
      row('例', info.example ? `${esc(info.example)}<div class="nds-cx">${esc(info.exampleJa || '')}</div>` : '');
  }

  // ---------- saved words ----------
  function renderSaved() {
    if (!S.saved.length) { savedBox.innerHTML = '<div class="nds-empty">単語にカーソルを合わせて ☆ を押すと保存できます</div>'; return; }
    savedBox.innerHTML = `<div class="nds-sbar">${S.saved.length}件 <button class="nds-csv">Anki用CSVを保存</button></div>` +
      S.saved.map((s, k) => `<div class="nds-srow"><div><b>${esc(s.head)}</b> <span class="nds-sm">${esc(s.ctx || s.mean.split(' / ')[0])}</span></div>` +
        `<div class="nds-sc">${esc(s.context)}</div><button class="nds-del" data-k="${k}" title="削除">✕</button></div>`).join('');
  }
  savedBox.addEventListener('click', e => {
    if (e.target.closest('.nds-del')) { S.saved.splice(+e.target.dataset.k, 1); saveSaved(); renderSaved(); return; }
    if (e.target.closest('.nds-csv')) {
      const q = s => '"' + String(s).replace(/"/g, '""') + '"';
      const study = s => !s.info ? (s.ctx ? 'この文で: ' + s.ctx + '<br><br>' : '') :
        `この文で: ${s.info.meaning}<br>使われ方: ${s.info.usage}<br>` +
        `よく使う形: ${s.info.pattern}<br>例: ${s.info.example} — ${s.info.exampleJa}<br><br>`;
      const csv = S.saved.map(s => [q(s.head), q(study(s) +
        s.mean.replace(/ \/ /g, '<br>') + '<br><br>' + s.context + (s.ja ? '<br>' + s.ja : ''))].join(',')).join('\n');
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

  chrome.storage.local.get(['nds_settings', 'nds_saved', 'nds_ai'], r => {
    Object.assign(S.settings, r.nds_settings || {});
    S.saved = r.nds_saved || [];
    setAi(r.nds_ai);
    applySettings(); applyJaMode();
  });
  applySettings();
})();
