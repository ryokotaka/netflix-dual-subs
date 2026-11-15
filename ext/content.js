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
    repeat: -1, repeatAt: 0, hold: null, // R loop / line held after a jump
    hist: [], playUntil: 0, // looked-up words / end of a listening-quiz clip
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
    settings: { quizPool: 'saved', shrinkVideo: false, subSize: '1', subPos: '9', hideSdh: true, showJa: true, jaBlur: true, jaBottom: false, jaOfficial: false, hideNetflix: true, autoPause: false, hoverPause: true, panel: true },
  };

  // ---------- storage ----------
  // After the extension is reloaded, a content script left in an open tab loses chrome.*
  // until the page is reloaded; say so instead of throwing.
  const alive = () => { try { return !!chrome.runtime.id; } catch (e) { return false; } };
  const orphaned = () => { setStatus('拡張機能が更新されました。ページを再読み込みしてください'); return false; };
  const saveSettings = () => alive() ? chrome.storage.local.set({ nds_settings: S.settings }) : orphaned();
  const saveSaved = () => { refreshSavedWords(); return alive() ? chrome.storage.local.set({ nds_saved: S.saved }) : orphaned(); };

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
        <button data-tab="quiz">復習<span class="nds-due"></span></button>
        <button data-tab="hist">履歴</button>
        <span class="nds-sp"></span>
        <button class="nds-gear" title="設定">⚙</button>
        <button class="nds-close" title="パネルを閉じる">✕</button>
      </div>
      <div class="nds-settings" hidden>
        <label><input type="checkbox" data-k="hideSdh"> 効果音・話者名・歌詞を隠す（[laughs] など）</label>
        <label><input type="checkbox" data-k="showJa"> 日本語訳を表示</label>
        <label><input type="checkbox" data-k="jaBlur"> 右の日本語をぼかす（カーソルを合わせると表示）</label>
        <label><input type="checkbox" data-k="jaBottom"> 動画の下の字幕にも日本語を出す</label>
        <label><input type="checkbox" data-k="jaOfficial"> Netflix公式の日本語字幕を使う（意訳・省略あり）</label>
        <label><input type="checkbox" data-k="hideNetflix"> Netflixの字幕を隠す</label>
        <label><input type="checkbox" data-k="autoPause"> 1文ごとに自動一時停止 (Q)</label>
        <label><input type="checkbox" data-k="hoverPause"> カーソルで一時停止（字幕の単語・右のパネル）</label>
        <label><input type="checkbox" data-k="shrinkVideo"> パネルを開いている間は動画を左に縮める</label>
        <label>字幕の大きさ <select data-k="subSize"><option value="0.8">小</option><option value="1">中</option><option value="1.25">大</option><option value="1.5">特大</option></select></label>
        <label>字幕の位置 <select data-k="subPos"><option value="4">一番下</option><option value="9">下</option><option value="18">少し上</option><option value="28">上</option></select></label>
        <div class="nds-gk">単語の解説：<span class="nds-gstate"></span> <button class="nds-gset">APIキーを設定</button></div>
        <div class="nds-keys">、前の文 ／ 。もう一度 ／ ・次の文 ／ R この文をリピート ／ J 日本語を見る ／ Q 1文ごとに止める ／ P パネル</div>
      </div>
      <div class="nds-status"></div>
      <div class="nds-list"></div>
      <div class="nds-saved" hidden></div>
      <div class="nds-quiz" hidden></div>
      <div class="nds-hist" hidden></div>
    </div>
    <button id="nds-open" title="字幕パネル (P)">字</button>
    <div id="nds-pop" hidden></div>`;

  const subEn = $('.nds-en', root), subJa = $('.nds-ja', root), panel = $('#nds-panel', root);
  const list = $('.nds-list', root), savedBox = $('.nds-saved', root), quizBox = $('.nds-quiz', root), histBox = $('.nds-hist', root), pop = $('#nds-pop', root);
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
    // opt-in: shrink the video into the space beside the panel (off: the panel overlaps it)
    document.documentElement.classList.toggle('nds-panel-open', !!(S.settings.panel && S.settings.shrinkVideo));
    root.style.setProperty('--nds-sub-scale', S.settings.subSize);
    root.style.setProperty('--nds-sub-bottom', S.settings.subPos + 'vh');
    settingsBox.querySelectorAll('[data-k]').forEach(i => {
      if (i.type === 'checkbox') i.checked = !!S.settings[i.dataset.k]; else i.value = S.settings[i.dataset.k];
    });
  }
  settingsBox.addEventListener('change', e => {
    const k = e.target.dataset.k; if (!k) return;
    S.settings[k] = e.target.type === 'checkbox' ? e.target.checked : e.target.value; saveSettings(); applySettings();
    if (k === 'jaOfficial') applyJaMode();
    if (k === 'hideSdh') S.movieId = null; // rebuild the lines: the 100 ms tick restarts this movie
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
    quizBox.hidden = b.dataset.tab !== 'quiz';
    histBox.hidden = b.dataset.tab !== 'hist';
    if (quizBox.hidden) { S.playUntil = 0; root.classList.remove('nds-listening'); } // left a listening question
    if (!savedBox.hidden) renderSaved();
    if (!quizBox.hidden) nextQuiz();
    if (!histBox.hidden) renderHistory();
  });
  // stop Netflix from treating clicks/keys inside our UI as player input
  for (const ev of ['click', 'mousedown', 'mouseup', 'dblclick', 'wheel']) {
    panel.addEventListener(ev, e => e.stopPropagation());
    pop.addEventListener(ev, e => e.stopPropagation());
    $('#nds-sub', root).addEventListener(ev, e => e.stopPropagation());
  }

  function setStatus(s) { S.status = s; statusEl.textContent = s; statusEl.hidden = !s; }

  // ---------- subtitle list ----------
  function renderList() {
    list.innerHTML = S.cues.map((c, k) =>
      `<div class="nds-row" data-k="${k}"><span class="nds-t">${fmt(c.start)}</span>` +
      `<div class="nds-rt"><div class="nds-ren">${wordsHtml([c.en.replace(/\n/g, ' ')])[0]}</div>` +
      `<div class="nds-rja">${esc(c.ja || '').replace(/\n/g, ' ')}</div></div></div>`).join('');
  }
  list.addEventListener('click', e => {
    if (e.target.closest('.nds-w')) { if (hoverCtx) askContext(hoverCtx, true); return; } // word: ask the AI
    const row = e.target.closest('.nds-row'); if (!row) return;
    seekToCue(+row.dataset.k);
  });
  function updateRowJa(k) {
    const r = list.querySelector(`.nds-row[data-k="${k}"] .nds-rja`);
    if (r) r.textContent = (S.cues[k].ja || '').replace(/\n/g, ' ');
  }
  // The current (highlighted) row is always kept in the middle of the list.
  function scrollToActive(force) {
    const r = S.settings.panel && list.querySelector('.nds-row.on');
    if (!r) return;
    const top = list.scrollTop + r.getBoundingClientRect().top - list.getBoundingClientRect().top - (list.clientHeight - r.offsetHeight) / 2;
    list.scrollTo({ top, behavior: force ? 'auto' : 'smooth' });
  }

  // ---------- current line ----------
  function renderSub() {
    const c = S.cues[S.idx];
    if (!c) { subEn.innerHTML = ''; subJa.textContent = ''; return; }
    subEn.innerHTML = wordsHtml(c.en.split('\n')).map(h => '<div>' + h + '</div>').join('');
    subJa.textContent = c.ja || '';
  }
  // Lines of English as hoverable word spans; data-i numbers the words across all lines.
  // the line as shown: without sound descriptions etc. unless the setting is off
  const spoken = text => (S.settings.hideSdh ? N.stripSdh(text) : text);

  // Saved single words are underlined wherever they come up again (any inflection).
  const isSaved = w => S.savedWords && S.savedWords.size && N.lemmas(w).some(l => S.savedWords.has(l));
  function refreshSavedWords() {
    S.savedWords = new Set(S.saved.map(x => x.head.toLowerCase()).filter(h => !h.includes(' ')));
    updateDueBadge();
    if (!S.cues.length) return;
    renderSub(); renderList(); S.idx = -1; // the 100 ms tick re-marks the current row
  }

  function wordsHtml(lines) {
    let wi = 0;
    return lines.map(line => N.tokenize(line).map(tok => tok.w
      ? `<span class="nds-w${isSaved(tok.w) ? ' nds-sv' : ''}" data-i="${wi++}">${esc(tok.t)}</span>`
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
    if (!id) document.documentElement.classList.remove('nds-panel-open'); // startMovie → applySettings puts it back
    document.documentElement.classList.toggle('nds-active', !!id);
    if (!id) return;
    mount();
    const titleEl = document.querySelector('[data-uia="video-title"]');
    if (titleEl) S.title = titleEl.innerText.replace(/\s*\n\s*/g, ' ').trim();
    if (id !== S.movieId) startMovie(id);
    if (!S.cues.length) return;
    const v = video(); if (!v) return;
    const t = nowMs();
    if (S.playUntil && t >= S.playUntil) { v.pause(); S.playUntil = 0; } // end of a listening-quiz clip
    // R: loop one line (going far from it, e.g. with Netflix's own seek bar, ends the loop)
    if (S.repeat >= 0 && !v.paused) {
      const c = S.cues[S.repeat];
      if (!c || t < c.start - 2000 || t > c.end + 2000) setRepeat(-1);
      else if (t >= c.end + 150 && Date.now() - S.repeatAt > 800) { S.repeatAt = Date.now(); seekToCue(S.repeat); return; }
    }
    // auto-pause at the end of the line that was playing
    if (S.settings.autoPause && S.repeat < 0 && S.idx >= 0 && !v.paused && S.pausedAt !== S.idx) {
      const c = S.cues[S.idx];
      if (t >= c.end - 60 && t < c.end + 400) { v.pause(); S.pausedAt = S.idx; }
    }
    let k = currentIndex(t);
    if (S.hold) { // right after a jump: keep the target line even if Netflix landed a bit early
      if (Date.now() > S.hold.until || k >= S.hold.idx) S.hold = null; else k = S.hold.idx;
    }
    if (k !== S.idx) {
      S.idx = k;
      root.classList.remove('nds-reveal'); // J shows the Japanese of one line only
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
    S.movieId = id; S.cues = []; S.idx = -1; S.source = 'none'; S.jaSource = 'none'; S.hasOfficialJa = false; S.pausedAt = -1; S.hold = null; if (S.repeat >= 0) setRepeat(-1);
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
      S.cues = en.map(c => ({ start: c.start, end: c.end, en: spoken(c.text), ja: '' })).filter(c => c.en);
      S.source = 'track';
      const ja = await loadJa(id);
      if (S.movieId !== id) return;
      setStatus(!ja && S.settings.jaOfficial ? 'Netflixの日本語字幕がないため、機械翻訳を使います' : '');
      applyJaMode(); applySettings();
      checkPendingSeek(id);
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
    checkPendingSeek(S.movieId);
    let last = '';
    const obs = new MutationObserver(() => {
      if (S.source !== 'dom') { obs.disconnect(); return; }
      const box = $('.player-timedtext');
      const text = box ? spoken(N.cleanText(box.innerHTML)) : '';
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
  subEn.addEventListener('click', e => { if (e.target.closest('.nds-w') && hoverCtx) askContext(hoverCtx, true); }); // click = ask the AI
  list.addEventListener('mouseover', e => {
    const row = e.target.closest('.nds-row'); if (!row) return;
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
    askContext(ctx, false); // a saved answer, or the button that asks (AI calls only on click)
    const v = video();
    // pause while looking a word up, in the subtitle and in the side list alike
    if (S.settings.hoverPause && v && !v.paused) { v.pause(); S.hoverPaused = true; }
  }

  // The first sense stays visible; the rest is hidden while the AI explanation is shown
  // (the dictionary is folded) and comes back with the 辞書をもっと見る button.
  function entryHtml(head, mean, kind, maxSenses = 5) {
    const [first, ...rest] = mean.split(' / ').slice(0, maxSenses).map(esc);
    return `<div class="nds-e"><div class="nds-eh"><b>${esc(head)}</b>` +
      (kind ? `<span class="nds-kind">${kind}</span>` : '') +
      `<button class="nds-star" data-head="${esc(head)}" title="保存">☆</button></div>` +
      `<div class="nds-em">${first}${rest.length ? `<span class="nds-more"><br>${rest.join('<br>')}</span>` : ''}</div></div>`;
  }
  function showPop(anchor, ctx) {
    let html = '';
    if (ctx.phrase) html += entryHtml(ctx.phrase.head, ctx.phrase.mean, '熟語');
    if (ctx.word) html += entryHtml(ctx.word.head, ctx.word.mean, ctx.phrase ? '単語' : '', ctx.phrase ? 2 : 5);
    if (!html) html = `<div class="nds-e"><b>${esc(ctx.surface)}</b><div class="nds-em">辞書に見つかりませんでした</div></div>`;
    const withAi = !!(S.ai || lmState !== 'unavailable');
    const fold = withAi && /nds-more/.test(html);
    pop.innerHTML = (withAi ? '<div class="nds-ctx"></div>' : '') +
      `<div class="nds-dict${fold ? ' nds-folded' : ''}">${html}` +
      (fold ? '<button class="nds-dmore">辞書をもっと見る</button>' : '') + '</div>';
    pop.querySelectorAll('.nds-star').forEach(b => {
      if (S.saved.some(s => s.head === b.dataset.head)) { b.textContent = '★'; b.classList.add('on'); }
    });
    pop.hidden = false;
    placePop(anchor);
  }
  let popAnchor = null;
  function placePop(anchor) {
    popAnchor = anchor;
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
    if (e.target.closest('.nds-dmore')) { $('.nds-dict', pop).classList.remove('nds-folded'); e.target.remove(); return; }
    if (e.target.closest('.nds-lm')) { const ctx = hoverCtx; lmInit(true).then(() => { if (ctx && hoverCtx === ctx) askContext(ctx, true); }); return; }
    const b = e.target.closest('.nds-star'); if (!b || !hoverCtx) return;
    const head = b.dataset.head;
    const at = S.saved.findIndex(s => s.head === head);
    if (at >= 0) { S.saved.splice(at, 1); b.textContent = '☆'; b.classList.remove('on'); }
    else {
      const ent = [hoverCtx.phrase, hoverCtx.word].find(x => x && x.head === head);
      S.saved.unshift({ head, mean: ent ? ent.mean : '', ctx: hoverCtx.ctxMean || '', info: hoverCtx.ctxInfo || null, context: hoverCtx.cue.en.replace(/\n/g, ' '),
        ja: (hoverCtx.cue.ja || '').replace(/\n/g, ' '), ...around(hoverCtx.cue), movieId: S.movieId, title: S.title || '', time: hoverCtx.cue.start, at: Date.now() });
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
    // a word lookup ended; if the cursor is now in the panel, it keeps the video paused
    if (S.hoverPaused && v && v.paused) { if (S.inPanel) S.panelPaused = true; else v.play(); }
    S.hoverPaused = false;
  }
  subEn.addEventListener('mouseleave', endHover);
  pop.addEventListener('mouseleave', endHover);
  pop.addEventListener('mouseenter', () => clearTimeout(hideTimer));

  // Cursor inside the right panel = reading the list: the video stays paused until it
  // leaves (moving onto a word popup beside the panel still counts as inside).
  panel.addEventListener('mouseenter', () => {
    S.inPanel = true;
    const v = video();
    if (S.settings.hoverPause && v && !v.paused) { v.pause(); S.panelPaused = true; }
  });
  function leavePanel(e) {
    const to = e.relatedTarget;
    if (to && (panel.contains(to) || pop.contains(to))) return;
    S.inPanel = false;
    const v = video();
    if (S.panelPaused && !S.hoverPaused && v && v.paused) v.play();
    S.panelPaused = false;
  }
  panel.addEventListener('mouseleave', leavePanel);
  pop.addEventListener('mouseleave', e => { if (S.inPanel) leavePanel(e); });

  // ---------- meaning in context (Chrome's built-in AI, Gemini Nano: free, on-device) ----------
  const LM_OPTS = { expectedInputs: [{ type: 'text', languages: ['en'] }], expectedOutputs: [{ type: 'text', languages: ['ja', 'en'] }] };
  // The model fills the fields in this order, so who-can-you-say-it-to and the example's
  // audience are decided before the example is written. The ratings are about the phrase
  // itself (if you said it), not about this scene, which is usually casual.
  const LM_SYSTEM = 'あなたは日本人の英語学習者を助ける先生です。英語の字幕の1文（前後の文つき）と、その中の単語または熟語が与えられます。' +
    'その語を学ぶのに役立つ情報を答えてください。' +
    'meaning: この文での意味（日本語、20文字以内）。usage: この場面での使われ方・ニュアンス・話し手の気持ち（日本語、60文字以内）。' +
    'toFriend / toColleague / toSuperior: この場面に関係なく、この意味でのこの言い方を学習者自身が友人／同僚／上司など目上に言ってよいか' +
    '（◎自然 ○使える △避けた方が無難 ×失礼・不適切）。' +
    'pattern: よく使う形やコロケーション（英語、～で可変部分）。' +
    'exampleTo: 例文を言う相手。toFriend / toColleague / toSuperior で◎か○の相手から選ぶ（どの相手にも自然なら 誰でも）。' +
    'example: patternを使い、exampleTo の相手に言う短く自然な英語の例文。exampleJa: その日本語訳。';
  const AUDIENCE = ['◎', '○', '△', '×'];
  const LM_SCHEMA = {
    type: 'object',
    properties: {
      meaning: { type: 'string' },
      usage: { type: 'string' },
      // who you could say it to: one symbol each, so it costs only a few tokens
      toFriend: { type: 'string', enum: AUDIENCE },
      toColleague: { type: 'string', enum: AUDIENCE },
      toSuperior: { type: 'string', enum: AUDIENCE },
      pattern: { type: 'string' },
      exampleTo: { type: 'string', enum: ['友人に', '同僚に', '上司に', '誰でも'] },
      example: { type: 'string' },
      exampleJa: { type: 'string' },
    },
    required: ['meaning', 'usage', 'toFriend', 'toColleague', 'toSuperior', 'pattern', 'exampleTo', 'example', 'exampleJa'],
    additionalProperties: false,
  };
  const ctxCache = new Map(); // ctxKey -> Promise<info object (LM_SCHEMA)>, requests in flight / this page

  // Answers are kept per episode + line + word: the same word in another line is a different
  // context and is asked again; looking it up again in the same line (rewatching, reloading)
  // costs nothing. Newest 3000 kept in chrome.storage.local (no secrets in them).
  const ctxKey = ctx => `${S.movieId}|${ctx.cue.start}|${ctx.target.toLowerCase()}`;
  let ctxStore = {}, ctxSaveTimer = null;
  if (alive()) chrome.storage.local.get('nds_ctx', r => { ctxStore = r.nds_ctx || {}; });
  function rememberCtx(key, info) {
    ctxStore[key] = { info, at: Date.now() };
    clearTimeout(ctxSaveTimer);
    ctxSaveTimer = setTimeout(() => {
      const keys = Object.keys(ctxStore);
      if (keys.length > 3000) keys.sort((a, b) => ctxStore[a].at - ctxStore[b].at).slice(0, keys.length - 3000).forEach(k => delete ctxStore[k]);
      if (alive()) chrome.storage.local.set({ nds_ctx: ctxStore });
    }, 1000);
  }
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

  // request=false (hover): show a saved answer if there is one, otherwise nothing.
  // request=true (click on the word): ask the AI.
  async function askContext(ctx, request) {
    const box = $('.nds-ctx', pop); if (!box) return;
    const key = ctxKey(ctx);
    const show = info => {
      ctx.ctxInfo = info; ctx.ctxMean = info.meaning;
      if (hoverCtx === ctx) { box.innerHTML = infoHtml(info); if (popAnchor) placePop(popAnchor); } // it got taller
    };
    if (ctxStore[key]) return show(ctxStore[key].info);
    if (!request && !ctxCache.has(key)) { box.innerHTML = ''; return; } // nothing until the word is clicked
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
    const ask = { claude: askClaude, gemini: askGemini }[S.ai] || askNano;
    if (!ctxCache.has(key)) ctxCache.set(key, ask(contextPrompt(ctx.cue, ctx.target)).then(info => { rememberCtx(key, info); return info; }));
    box.textContent = 'この文での使われ方：考え中…';
    try {
      show(await ctxCache.get(key));
      if (request) recordHistory(ctx, ctx.ctxInfo);
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
    properties: Object.fromEntries(LM_SCHEMA.required.map(k => [k, LM_SCHEMA.properties[k].enum
      ? { type: 'STRING', enum: LM_SCHEMA.properties[k].enum } : { type: 'STRING' }])),
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
      row('使える相手', audienceHtml(info)) +
      row('よく使う形', esc(info.pattern)) +
      row('例', info.example ? `${info.exampleTo ? `<span class="nds-to">&lt;${esc(info.exampleTo)}&gt;</span> ` : ''}` +
        `${esc(info.example)}<div class="nds-cx">${esc(info.exampleJa || '')}</div>` : '');
  }
  // "友人◎ 同僚○ 目上△"; answers saved before this had none
  function audienceHtml(info) {
    if (!info.toSuperior) return '';
    const mark = m => `<span class="nds-aud${m === '△' || m === '×' ? ' ng' : ''}">${esc(m)}</span>`;
    return `友人${mark(info.toFriend)} 同僚${mark(info.toColleague)} 目上${mark(info.toSuperior)}`;
  }
  const audienceText = info => (info && info.toSuperior ? `友人${info.toFriend} 同僚${info.toColleague} 目上${info.toSuperior}` : '');

  // ---------- saved words ----------
  function renderSaved() {
    if (!S.saved.length) { savedBox.innerHTML = '<div class="nds-empty">単語にカーソルを合わせて ☆ を押すと保存できます</div>'; return; }
    savedBox.innerHTML = `<div class="nds-sbar">${S.saved.length}件 <button class="nds-csv">Anki用CSVを保存</button></div>` +
      S.saved.map((s, k) => `<div class="nds-srow"><div><b>${esc(s.head)}</b> <span class="nds-sm">${esc(s.ctx || s.mean.split(' / ')[0])}</span></div>` +
        `<div class="nds-sc">${esc(s.context)}</div>` +
        (s.time != null ? `<button class="nds-go" data-k="${k}">▶ ${esc(s.title ? s.title + ' ' : '')}${fmt(s.time)}</button>` : '') +
        `<button class="nds-del" data-k="${k}" title="削除">✕</button></div>`).join('');
  }
  savedBox.addEventListener('click', e => {
    if (e.target.closest('.nds-del')) { S.saved.splice(+e.target.dataset.k, 1); saveSaved(); renderSaved(); return; }
    const go = e.target.closest('.nds-go');
    if (go) return goToSaved(S.saved[+go.dataset.k]);
    if (e.target.closest('.nds-csv')) {
      const q = s => '"' + String(s).replace(/"/g, '""') + '"';
      const study = s => !s.info ? (s.ctx ? 'この文で: ' + s.ctx + '<br><br>' : '') :
        `この文で: ${s.info.meaning}<br>使われ方: ${s.info.usage}<br>` +
        (audienceText(s.info) ? `使える相手: ${audienceText(s.info)}<br>` : '') +
        `よく使う形: ${s.info.pattern}<br>例: ${s.info.exampleTo ? `<${s.info.exampleTo}> ` : ''}${s.info.example} — ${s.info.exampleJa}<br><br>`;
      const csv = S.saved.map(s => [q(s.head), q(study(s) +
        s.mean.replace(/ \/ /g, '<br>') + '<br><br>' + s.context + (s.ja ? '<br>' + s.ja : ''))].join(',')).join('\n');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' }));
      a.download = 'netflix-words.csv'; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }
  });

  // Back to the scene a word was saved from: seek if it's this episode, otherwise open
  // that episode and seek once its subtitles are loaded (checkPendingSeek).
  function goToSaved(s) {
    if (!s || s.time == null) return;
    if (String(s.movieId) === S.movieId) {
      const k = S.cues.findIndex(c => c.start === s.time);
      if (k >= 0) seekToCue(k); else { S.pausedAt = -1; seek(Math.max(0, s.time - 300)); }
      const v = video(); if (v && v.paused) v.play();
      return;
    }
    if (!alive()) return orphaned();
    chrome.storage.local.set({ nds_pending_seek: { movieId: String(s.movieId), time: s.time, at: Date.now() } })
      .then(() => { location.href = '/watch/' + s.movieId; });
  }
  function checkPendingSeek(id) {
    if (!alive()) return;
    chrome.storage.local.get('nds_pending_seek', ({ nds_pending_seek: p }) => {
      if (!p || p.movieId !== id || Date.now() - p.at > 5 * 60 * 1000) return;
      chrome.storage.local.remove('nds_pending_seek');
      setTimeout(() => { // let the player settle first
        const k = S.cues.findIndex(c => c.start === p.time);
        if (k >= 0) seekToCue(k); else seek(Math.max(0, p.time - 300));
      }, 1500);
    });
  }

  // ---------- history: every word you clicked for an AI explanation ----------
  // A click means "I didn't know this here", so these are kept (newest first, 20000 max)
  // apart from ☆, to look back on, jump to, or star later.
  const sceneKey = x => `${x.head}|${x.movieId}|${x.time}`;
  function recordHistory(ctx, info) {
    if (!alive() || !info) return;
    const e = { head: (ctx.phrase || ctx.word || {}).head || ctx.target, ctx: info.meaning, info,
      context: ctx.cue.en.replace(/\n/g, ' '), ja: (ctx.cue.ja || '').replace(/\n/g, ' '), ...around(ctx.cue),
      movieId: S.movieId, title: S.title || '', time: ctx.cue.start, at: Date.now() };
    chrome.storage.local.get('nds_history', ({ nds_history: h = [] }) => {
      S.hist = [e, ...h.filter(x => sceneKey(x) !== sceneKey(e))].slice(0, 20000);
      chrome.storage.local.set({ nds_history: S.hist });
      updateDueBadge();
    });
  }
  // the lines before and after, kept with saved / looked-up words for the listening quiz
  function around(cue) {
    const k = S.cues.indexOf(cue), p = S.cues[k - 1], n = S.cues[k + 1];
    const line = (c, f) => (c ? (c[f] || '').replace(/\n/g, ' ') : '');
    return { prevEn: line(p, 'en'), prevJa: line(p, 'ja'), nextEn: line(n, 'en'), nextJa: line(n, 'ja') };
  }
  let history = [];
  function renderHistory() {
    if (!alive()) return;
    chrome.storage.local.get('nds_history', ({ nds_history: h = [] }) => {
      history = h;
      if (!h.length) { histBox.innerHTML = '<div class="nds-empty">単語をクリックしてAIの解説を出すと、ここに残ります</div>'; return; }
      const starred = new Set(S.saved.map(sceneKey));
      histBox.innerHTML = `<div class="nds-sbar">${h.length}件（クリックして調べた単語）</div>` +
        h.slice(0, 300).map((x, k) => `<div class="nds-srow"><div><b>${esc(x.head)}</b> <span class="nds-sm">${esc(x.ctx || '')}</span></div>` +
          `<div class="nds-sc">${esc(x.context)}</div>` +
          `<button class="nds-go" data-k="${k}">▶ ${esc(x.title ? x.title + ' ' : '')}${fmt(x.time)}</button>` +
          `<button class="nds-hstar${starred.has(sceneKey(x)) ? ' on' : ''}" data-k="${k}" title="☆ 保存して復習に入れる">${starred.has(sceneKey(x)) ? '★' : '☆'}</button></div>`).join('');
    });
  }
  histBox.addEventListener('click', e => {
    const go = e.target.closest('.nds-go');
    if (go) return goToSaved(history[+go.dataset.k]);
    const st = e.target.closest('.nds-hstar');
    if (!st || st.classList.contains('on')) return;
    const x = history[+st.dataset.k];
    const w = S.dict && N.lookupWord(S.dict, x.head.split(' ')[0]);
    S.saved.unshift({ head: x.head, mean: (x.head.includes(' ') ? '' : w && w.mean) || x.ctx || '', ctx: x.ctx, info: x.info,
      context: x.context, ja: x.ja, prevEn: x.prevEn, prevJa: x.prevJa, nextEn: x.nextEn, nextJa: x.nextJa,
      movieId: x.movieId, title: x.title, time: x.time, at: Date.now() });
    saveSaved();
    st.textContent = '★'; st.classList.add('on');
  });

  // ---------- review quiz (saved words, optionally everything looked up; no AI calls) ----------
  // Spaced repetition: a right answer moves the word up a box and pushes its next
  // review out (now / 1 / 3 / 7 / 21 days); a wrong one sends it back to box 0.
  // Saved words keep box/due on themselves; looked-up-only words in nds_quiz_srs.
  // Question kinds: meaning / fill-in-the-blank (4 choices), Japanese → English and
  // listening (say or recall it yourself, then grade yourself - recall beats recognition).
  const QUIZ_DAYS = [0, 1, 3, 7, 21];
  const wordRe = (head, flags) => new RegExp(`\\b(${head.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})\\b`, flags);
  const meaningOf = s => s.ctx || (s.info && s.info.meaning) || (s.mean || '').split(' / ')[0];
  const shuffle = a => a.map(x => [Math.random(), x]).sort((p, q) => p[0] - q[0]).map(x => x[1]);
  const plain = t => (t || '').replace(/^-\s*/, '').replace(/ -/g, ' / '); // dialogue dashes read badly here
  let srs = {}; // sceneKey -> { box, due } for words that are only in the history
  const srsOf = x => (x.fromHist ? srs[sceneKey(x)] || {} : x);
  function quizPool() {
    const saved = S.saved.map(x => x);
    if (S.settings.quizPool !== 'all') return saved;
    const have = new Set(saved.map(sceneKey));
    return saved.concat((S.hist || []).filter(x => !have.has(sceneKey(x))).map(x => ({ ...x, fromHist: true })));
  }
  const isDue = x => (srsOf(x).due || 0) <= Date.now();
  function updateDueBadge() {
    const n = quizPool().filter(isDue).length;
    $('.nds-due', panel).textContent = n ? ` ${n}` : '';
  }
  function grade(x, ok) {
    const r = srsOf(x);
    const box = ok ? Math.min((r.box || 0) + 1, QUIZ_DAYS.length - 1) : 0;
    const due = Date.now() + QUIZ_DAYS[box] * 86400000;
    if (x.fromHist) { srs[sceneKey(x)] = { box, due }; if (alive()) chrome.storage.local.set({ nds_quiz_srs: srs }); updateDueBadge(); }
    else { x.box = box; x.due = due; saveSaved(); }
  }
  const cueIndexOf = x => (String(x.movieId) === S.movieId ? S.cues.findIndex(c => c.start === x.time) : -1);
  if (alive()) chrome.storage.local.get(['nds_quiz_srs', 'nds_history'], r => { srs = r.nds_quiz_srs || {}; S.hist = r.nds_history || []; updateDueBadge(); });

  let quiz = null; // { s, kind, choices, answered, all }
  function nextQuiz(all) {
    S.playUntil = 0; root.classList.remove('nds-listening');
    const everything = quizPool();
    const head = `<div class="nds-qtop">出題 <select class="nds-qpool"><option value="saved">☆ 保存した単語</option>` +
      `<option value="all">調べた単語すべて</option></select></div>`;
    const pool = all ? everything : everything.filter(isDue);
    if (!everything.length) { quizBox.innerHTML = head + '<div class="nds-empty">単語を ☆ で保存するか、クリックして調べると、ここで復習できます</div>'; return setPoolSelect(); }
    if (!pool.length) {
      quizBox.innerHTML = head + '<div class="nds-empty">今日の復習は終わりです 🎉<br><button class="nds-qall">全部から出題する</button></div>';
      return setPoolSelect();
    }
    const s = pool.slice().sort((a, b) => (srsOf(a).due || 0) - (srsOf(b).due || 0))[Math.floor(Math.random() * Math.min(3, pool.length))];
    const others = shuffle(everything.filter(x => x !== s && x.head !== s.head));
    // which kinds fit this word: listening needs its scene in this episode, Japanese → English its line's translation
    const kinds = [];
    if (cueIndexOf(s) >= 0) kinds.push('listen', 'listen');
    if (s.ja) kinds.push('ja2en', 'ja2en');
    if (others.length >= 3) kinds.push('meaning');
    if (others.length >= 3 && s.context && !s.head.includes(' ') && wordRe(s.head, 'i').test(s.context)) kinds.push('blank');
    const kind = kinds.length ? kinds[Math.floor(Math.random() * kinds.length)] : 'card';
    const choices = kind === 'meaning' || kind === 'blank' ? shuffle([s, ...others.slice(0, 3)]) : null;
    quiz = { s, kind, choices, answered: false, all };
    const line = esc(plain(s.context));
    const q = {
      blank: `<div class="nds-qq">空欄に入る語は？</div><div class="nds-ql">${line.replace(wordRe(s.head, 'i'), '<b>＿＿＿</b>')}</div>`,
      meaning: `<div class="nds-qq">この文での <b>${esc(s.head)}</b> の意味は？</div><div class="nds-ql">${line.replace(wordRe(s.head, 'i'), '<b>$1</b>')}</div>`,
      ja2en: `<div class="nds-qq">英語で言ってみよう（頭の中か声に出して）</div><div class="nds-ql">${esc(s.ja)}</div>` +
        `<div class="nds-cx">ヒント：「${esc(meaningOf(s))}」にあたる語句を使う</div>`,
      listen: `<div class="nds-qq">🎧 聞き取り：前後の文も流します。何と言ったか思い出してから答えを見よう（字幕は隠れます）</div>` +
        '<div class="nds-qbtns"><button class="nds-qplay">▶ 再生</button></div>',
      card: `<div class="nds-qq"><b>${esc(s.head)}</b> の意味は？</div><div class="nds-ql">${line}</div>`,
    }[kind];
    quizBox.innerHTML = head + `<div class="nds-qcard">${q}` +
      (choices
        ? `<div class="nds-qch">${choices.map((c, i) => `<button class="nds-qc" data-i="${i}">${esc(kind === 'blank' ? c.head : meaningOf(c))}</button>`).join('')}</div>`
        : '<button class="nds-qshow">答えを見る</button>') +
      '<div class="nds-qa" hidden></div></div>';
    setPoolSelect();
    if (kind === 'listen') playScene(s);
  }
  function setPoolSelect() { const sel = $('.nds-qpool', quizBox); if (sel) sel.value = S.settings.quizPool === 'all' ? 'all' : 'saved'; }

  // listening: the line before, the word's line and the line after, subtitles hidden
  function playScene(x) {
    const k = cueIndexOf(x); if (k < 0) return;
    const from = Math.max(0, k - 1), to = Math.min(S.cues.length - 1, k + 1);
    root.classList.add('nds-listening');
    seekToCue(from);
    S.playUntil = S.cues[to].end + 300;
    const v = video(); if (v && v.paused) v.play();
  }

  function answerQuiz(correct) {
    const { s, kind } = quiz;
    quiz.answered = true;
    S.playUntil = 0; root.classList.remove('nds-listening');
    if (correct !== null) grade(s, correct);
    const info = s.info;
    const hl = t => esc(plain(t)).replace(wordRe(s.head, 'i'), '<b>$1</b>');
    if (!s.prevEn && !s.nextEn) { // saved before the surrounding lines were kept: take them from this episode
      const k = cueIndexOf(s), line = (c, f) => (c ? (c[f] || '').replace(/\n/g, ' ') : '');
      if (k >= 0) Object.assign(s, { prevEn: line(S.cues[k - 1], 'en'), prevJa: line(S.cues[k - 1], 'ja'), nextEn: line(S.cues[k + 1], 'en'), nextJa: line(S.cues[k + 1], 'ja') });
    }
    const scene = kind === 'listen' || kind === 'ja2en'
      ? `<div class="nds-qscene">${s.prevEn && kind === 'listen' ? `<div class="nds-qs">${esc(plain(s.prevEn))}<div class="nds-cx">${esc(s.prevJa || '')}</div></div>` : ''}` +
        `<div class="nds-qs main">${hl(s.context)}<div class="nds-cx">${esc(s.ja || '')}</div></div>` +
        `${s.nextEn && kind === 'listen' ? `<div class="nds-qs">${esc(plain(s.nextEn))}<div class="nds-cx">${esc(s.nextJa || '')}</div></div>` : ''}</div>`
      : '';
    const a = $('.nds-qa', quizBox);
    a.hidden = false;
    a.innerHTML = (correct === null ? '' : `<div class="${correct ? 'nds-ok' : 'nds-ng'}">${correct ? '正解！' : '残念…'}</div>`) + scene +
      `<div><b>${esc(s.head)}</b>：${esc(meaningOf(s))}</div>` +
      (info ? `<div class="nds-ci"><span class="nds-cl">使われ方</span>${esc(info.usage)}</div>` +
        (info.toSuperior ? `<div class="nds-ci"><span class="nds-cl">使える相手</span>${audienceHtml(info)}</div>` : '') +
        `<div class="nds-ci"><span class="nds-cl">例</span>${info.exampleTo ? `<span class="nds-to">&lt;${esc(info.exampleTo)}&gt;</span> ` : ''}${esc(info.example)}<div class="nds-cx">${esc(info.exampleJa)}</div></div>` : '') +
      (s.ja && !scene ? `<div class="nds-ci"><span class="nds-cl">訳</span>${esc(s.ja)}</div>` : '') +
      `<div class="nds-qbtns">${kind === 'listen' ? '<button class="nds-qplay">▶ もう一度聞く</button>' : s.time != null ? '<button class="nds-qgo">▶ この場面を見る</button>' : ''}` +
      (correct === null ? `<button class="nds-qself" data-ok="1">${kind === 'card' ? '覚えてた' : kind === 'listen' ? '聞き取れた' : '言えた'}</button>` +
        `<button class="nds-qself" data-ok="0">${kind === 'card' ? '忘れてた' : kind === 'listen' ? '聞き取れなかった' : '言えなかった'}</button>` : '') +
      '<button class="nds-qnext">次へ</button></div>';
  }
  quizBox.addEventListener('change', e => {
    if (!e.target.closest('.nds-qpool')) return;
    S.settings.quizPool = e.target.value; saveSettings(); updateDueBadge(); nextQuiz(false);
  });
  quizBox.addEventListener('click', e => {
    const t = e.target;
    if (t.closest('.nds-qpool')) return;
    if (t.closest('.nds-qall')) return nextQuiz(true);
    if (!quiz) return;
    if (t.closest('.nds-qnext')) return nextQuiz(quiz.all);
    if (t.closest('.nds-qplay')) { // replay keeps the answer visible if it's shown
      const shown = quiz.answered; playScene(quiz.s); if (shown) root.classList.remove('nds-listening'); return;
    }
    if (t.closest('.nds-qgo')) return goToSaved(quiz.s);
    if (t.closest('.nds-qshow')) return answerQuiz(null);
    const self = t.closest('.nds-qself');
    if (self) { grade(quiz.s, self.dataset.ok === '1'); return nextQuiz(quiz.all); } // grade yourself
    const c = t.closest('.nds-qc');
    if (c && !quiz.answered) {
      const ok = quiz.choices[+c.dataset.i] === quiz.s;
      quizBox.querySelectorAll('.nds-qc').forEach((b, i) => {
        b.disabled = true;
        if (quiz.choices[i] === quiz.s) b.classList.add('nds-right');
      });
      if (!ok) c.classList.add('nds-wrong');
      answerQuiz(ok);
    }
  });

  // ---------- keyboard shortcuts ----------
  window.addEventListener('keydown', e => {
    if (!watchId() || e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = (e.target && e.target.tagName) || '';
    if (/INPUT|TEXTAREA|SELECT/.test(tag) || (e.target && e.target.isContentEditable)) return;
    // by physical key (e.code), so it works with Japanese input on: line moves are the
    // 、。・ keys (Comma / Period / Slash on a JIS keyboard)
    const key = { Comma: 'prev', Period: 'again', Slash: 'next', KeyQ: 'q', KeyP: 'p', KeyJ: 'j', KeyR: 'r' }[e.code];
    if (!key) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (key === 'p') return togglePanel();
    // check your understanding: show this line's Japanese (also under the video) until the next line
    if (key === 'j') return root.classList.toggle('nds-reveal');
    if (key === 'q') { S.settings.autoPause = !S.settings.autoPause; saveSettings(); applySettings(); flash(S.settings.autoPause ? '自動一時停止 ON' : '自動一時停止 OFF'); return; }
    if (!S.cues.length) return;
    const t = nowMs(), cur = S.idx >= 0 ? S.idx : Math.max(0, currentIndex(t)); // the line shown
    const v = video();
    if (key === 'r') { setRepeat(S.repeat >= 0 ? -1 : cur); if (v && v.paused) v.play(); return; }
    let target = cur;
    if (key === 'prev') target = (S.cues[cur] && t - S.cues[cur].start > 1500) ? cur : Math.max(0, cur - 1);
    if (key === 'next') target = Math.min(S.cues.length - 1, cur + 1);
    seekToCue(target);
    if (v && v.paused) v.play();
  }, true);

  // Jump to a line. Netflix may land a little before its start, which would make the
  // previous line current for a moment (the list jumps up and back), so hold this line
  // as current until playback reaches it (at most 1.5 s).
  function seekToCue(k) {
    const c = S.cues[k]; if (!c) return;
    S.pausedAt = -1;
    S.hold = { idx: k, until: Date.now() + 1500 };
    if (S.repeat >= 0) S.repeat = k; // looping follows the line you go to
    seek(c.start);
  }
  function setRepeat(k) {
    S.repeat = k;
    root.classList.toggle('nds-repeating', k >= 0);
    flash(k >= 0 ? 'この文をリピート（R でやめる）' : 'リピート OFF');
  }

  function flash(msg) {
    const f = document.createElement('div'); f.className = 'nds-flash'; f.textContent = msg;
    root.appendChild(f); setTimeout(() => f.remove(), 1200);
  }

  chrome.storage.local.get(['nds_settings', 'nds_saved', 'nds_ai'], r => {
    Object.assign(S.settings, r.nds_settings || {});
    S.saved = r.nds_saved || [];
    refreshSavedWords();
    setAi(r.nds_ai);
    applySettings(); applyJaMode();
  });
  applySettings();
})();
