// Fetches subtitle files for the content script (avoids CORS problems on the CDN),
// and translates text with Google Translate's free web endpoint.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === 'fetchText') {
    fetch(msg.url, { credentials: 'omit' })
      .then(r => (r.ok ? r.text() : Promise.reject(new Error('HTTP ' + r.status))))
      .then(text => sendResponse({ ok: true, text }))
      .catch(e => sendResponse({ ok: false, error: String(e) }));
    return true; // async response
  }
  if (msg && msg.type === 'openOptions') {
    chrome.runtime.openOptionsPage();
    return;
  }
  if (msg && msg.type === 'claude') {
    claude(msg)
      .then(text => sendResponse({ ok: true, text }))
      .catch(e => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  if (msg && msg.type === 'gemini') {
    gemini(msg)
      .then(text => sendResponse({ ok: true, text }))
      .catch(e => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  if (msg && msg.type === 'geminiBench') {
    geminiBench(msg)
      .then(results => sendResponse({ ok: true, results }))
      .catch(e => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  if (msg && msg.type === 'gtranslate') {
    gtranslateLines(msg.texts)
      .then(texts => sendResponse({ ok: true, texts }))
      .catch(e => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
});

// Unofficial endpoint (the one browser translators use): no key, no billing, but it
// can rate-limit (HTTP 429) or go away. The caller falls back to Chrome's translator.
async function gtranslate(text) {
  const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=ja&dt=t&q=' + encodeURIComponent(text);
  const r = await fetch(url, { credentials: 'omit' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const d = await r.json();
  return d[0].map(s => s[0] || '').join('');
}

// Claude API (key from the Claude Console, saved in the settings). Prepaid credits with
// auto-reload off, so it can't cost more than was bought. Raw HTTP because this
// extension has no build step to bundle the SDK.
async function claude({ system, prompt, schema }) {
  const { nds_claude_key: key } = await chrome.storage.local.get('nds_claude_key');
  if (!key) throw new Error('no Claude API key');
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2026-10-21',
      'anthropic-dangerous-direct-browser-access': 'true', // requests from an extension carry an Origin header
    },
    body: JSON.stringify({
      model: 'claude-haiku-5-5',
      max_tokens: 1024,
      thinking: { type: 'disabled' }, // a short lookup: answer right away (allowed at effort high or below)
      output_config: { effort: 'low', format: { type: 'json_schema', schema } },
      system,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + (await r.text()).slice(0, 800));
  const d = await r.json();
  if (d.usage) recordUsage(d.usage, (prompt.match(/対象: (.*)$/m) || [])[1] || '');
  if (d.stop_reason === 'refusal') throw new Error('refusal');
  return d.content.filter(b => b.type === 'text').map(b => b.text).join('');
}

// Usage log for the settings page, from the token counts every response already
// carries (no extra requests). Claude Haiku 5.5 price per million tokens for prompts
// of 100K tokens or fewer (Anthropic price list, 2026-10).
const HAIKU_PRICE = { input: 0.10, output: 0.50 };
let usageQueue = Promise.resolve(); // one read-modify-write at a time
function recordUsage(u, target) {
  usageQueue = usageQueue.then(async () => {
    const input = u.input_tokens || 0, output = u.output_tokens || 0;
    const cost = (input * HAIKU_PRICE.input + output * HAIKU_PRICE.output) / 1e6;
    const { nds_usage: s = { count: 0, input: 0, output: 0, cost: 0, since: Date.now(), recent: [] } } =
      await chrome.storage.local.get('nds_usage');
    s.count++; s.input += input; s.output += output; s.cost += cost;
    s.recent = [{ at: Date.now(), target, input, output, cost }, ...s.recent].slice(0, 20);
    await chrome.storage.local.set({ nds_usage: s });
  }).catch(e => console.warn('[NDS] usage log', e));
}

// the model choice rules may have changed with this version: pick again
chrome.runtime.onInstalled.addListener(() => chrome.storage.local.remove(['nds_gemini_model', 'nds_gemini_thinking']));

// Gemini API (key from Google AI Studio, saved in the settings). On a key whose project
// has no billing set up, only the free tier is used, so it can never be charged.
const GEMINI = 'https://generativelanguage.googleapis.com/v1beta/';

// With thinking on, a lookup took ~20 s. Gemini 3 models take thinkingLevel, 2.x take
// thinkingBudget; try them in order and remember the first one the model accepts.
const THINKING = [{ thinkingLevel: 'minimal' }, { thinkingLevel: 'low' }, { thinkingBudget: 0 }, null];

async function gemini({ system, prompt, schema, model }) {
  const { nds_gemini_key: key, nds_gemini_thinking: thinking = {} } = await chrome.storage.local.get(['nds_gemini_key', 'nds_gemini_thinking']);
  if (!key) throw new Error('no Gemini API key');
  model = model || await geminiModel(key);
  const saved = thinking[model] || 0; // per model: which THINKING entry it accepts
  for (let i = saved; i < THINKING.length; i++) {
    const generationConfig = { responseMimeType: 'application/json', responseSchema: schema, temperature: 0.3 };
    if (THINKING[i]) generationConfig.thinkingConfig = THINKING[i];
    const r = await fetch(GEMINI + model + ':generateContent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        // instructions go in the prompt itself: some models reject systemInstruction
        // ("Developer instruction is not enabled for this model")
        contents: [{ role: 'user', parts: [{ text: system + '\n\n' + prompt }] }],
        generationConfig,
      }),
    });
    if (r.status === 404) await chrome.storage.local.remove('nds_gemini_model'); // model retired: pick again next time
    if (!r.ok) {
      const body = await r.text();
      if (r.status === 400 && /think/i.test(body) && i < THINKING.length - 1) continue; // this setting isn't supported
      throw new Error('HTTP ' + r.status + ' ' + body.slice(0, 800));
    }
    if (i !== saved) await chrome.storage.local.set({ nds_gemini_thinking: { ...thinking, [model]: i } });
    const d = await r.json();
    return d.candidates[0].content.parts.filter(p => !p.thought).map(p => p.text || '').join('');
  }
}

// The model in use: the one the settings-page test found fastest, else the newest
// stable Flash-Lite (cheapest tier, has a free quota). Asked from the API, so model
// renames don't need a code change.
async function geminiModel(key) {
  const { nds_gemini_model: saved } = await chrome.storage.local.get('nds_gemini_model');
  if (saved) return saved;
  const [pick] = await geminiCandidates(key);
  if (!pick) throw new Error('no Flash-Lite model available for this key');
  await chrome.storage.local.set({ nds_gemini_model: pick }); // e.g. "models/gemini-3.1-flash-lite"
  return pick;
}

// Text Flash-Lite models this key can use, best guess first.
async function geminiCandidates(key) {
  const r = await fetch(GEMINI + 'models?pageSize=200', { headers: { 'x-goog-api-key': key } });
  if (!r.ok) throw new Error('models HTTP ' + r.status + ' ' + (await r.text()).slice(0, 800));
  const { models = [] } = await r.json();
  const ver = m => parseFloat((m.name.match(/gemini-(\d+(?:\.\d+)?)/) || [0, 0])[1]);
  const unstable = m => (/preview|exp/.test(m.name) ? 1 : 0);
  const plain = m => (/^models\/gemini-[\d.]+-flash-lite(-\d+)?$/.test(m.name) ? 0 : 1); // "gemini-3.1-flash-lite"
  return models
    .filter(m => /flash-lite/.test(m.name) && !/tts|image|live|audio|native|embed/.test(m.name) &&
      (m.supportedGenerationMethods || []).includes('generateContent'))
    .sort((a, b) => plain(a) - plain(b) || unstable(a) - unstable(b) || ver(b) - ver(a))
    .map(m => m.name);
}

// Settings-page test: time one real-sized lookup on each candidate (stable ones first,
// at most 5) and keep the fastest model that answered.
async function geminiBench(msg) {
  const { nds_gemini_key: key } = await chrome.storage.local.get('nds_gemini_key');
  if (!key) throw new Error('no Gemini API key');
  const results = [];
  for (const model of (await geminiCandidates(key)).slice(0, 5)) {
    const t0 = Date.now();
    try {
      const text = await gemini({ ...msg, model });
      results.push({ model, ms: Date.now() - t0, ok: true, text });
    } catch (e) {
      results.push({ model, ms: Date.now() - t0, ok: false, error: String(e).slice(0, 300) });
    }
  }
  const best = results.filter(r => r.ok).sort((a, b) => a.ms - b.ms)[0];
  if (best) await chrome.storage.local.set({ nds_gemini_model: best.model });
  return results;
}

// Translates several lines in one request (one per line); if Google merges or
// splits lines, falls back to one request per line.
async function gtranslateLines(lines) {
  const out = (await gtranslate(lines.join('\n'))).split('\n').map(s => s.trim());
  if (out.length === lines.length) return out;
  const each = [];
  for (const l of lines) each.push((await gtranslate(l)).trim());
  return each;
}
