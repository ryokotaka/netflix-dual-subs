// Settings page: the AI API keys live here (typing into a field on Netflix's
// page doesn't work reliably, the player swallows the keys).
const $ = id => document.getElementById(id);
const show = id => (text, ok) => { $(id).textContent = text; $(id).className = 'st ' + (ok === undefined ? '' : ok ? 'ok' : 'ng'); };
const status = show('status'), cstatus = show('cstatus');

chrome.storage.local.get(['nds_gemini_key', 'nds_claude_key'], r => {
  $('key').value = r.nds_gemini_key || '';
  $('ckey').value = r.nds_claude_key || '';
});

// ---------- Claude ----------
async function saveClaude() {
  const key = $('ckey').value.trim();
  await chrome.storage.local.set({ nds_claude_key: key });
  return key;
}
$('csave').onclick = async () => { cstatus((await saveClaude()) ? '保存しました' : 'キーが空です', true); };
$('cclear').onclick = async () => { $('ckey').value = ''; await saveClaude(); cstatus('削除しました', true); };
$('ctest').onclick = async () => {
  if (!(await saveClaude())) return cstatus('キーを入力してください', false);
  cstatus('テスト中…');
  const t0 = performance.now();
  const r = await chrome.runtime.sendMessage({ type: 'claude', system: SAMPLE.system, prompt: SAMPLE.prompt, schema: CLAUDE_SCHEMA });
  const sec = ((performance.now() - t0) / 1000).toFixed(1);
  if (!r || !r.ok) {
    const e = r ? r.error : 'no response';
    let detail = e;
    try { detail = JSON.parse(e.slice(e.indexOf('{'))).error.message; } catch (_) { /* not JSON */ }
    return cstatus((/HTTP 401/.test(e) ? 'キーが使えません。' : /credit balance/i.test(e) ? 'クレジット残高がありません（Billing で購入）。' : 'エラー：') +
      `（${e.match(/HTTP \d+/) || ''} ${detail.slice(0, 300)}）`, false);
  }
  let sample = '';
  try { const j = JSON.parse(r.text); sample = `\n例「blend」→ ${j.meaning}／${j.usage}`; } catch (_) { /* ignore */ }
  cstatus(`OK：使えます（claude-haiku-5-5、${sec}秒）${sample}`, true);
};

// ---------- Gemini ----------

async function save() {
  const key = $('key').value.trim();
  await chrome.storage.local.set({ nds_gemini_key: key });
  await chrome.storage.local.remove(['nds_gemini_model', 'nds_gemini_thinking']); // a new key may see other models
  return key;
}

$('save').onclick = async () => { status((await save()) ? '保存しました' : 'キーが空です（Chrome内蔵AIを使います）', true); };

$('clear').onclick = async () => { $('key').value = ''; await save(); status('削除しました（Chrome内蔵AIを使います）', true); };

// A real-sized lookup (same instruction as content.js LM_SYSTEM) so the timing is realistic.
const SAMPLE = {
  system: 'あなたは日本人の英語学習者を助ける先生です。英語の字幕の1文（前後の文つき）と、その中の単語または熟語が与えられます。' +
    'その語を学ぶのに役立つ情報を、この場面での使われ方を中心に答えてください。' +
    'meaning: この文での意味（日本語、20文字以内）。usage: この場面での使われ方・ニュアンス・話し手の気持ち（日本語、60文字以内）。' +
    'pattern: よく使う形やコロケーション（英語、～で可変部分）。' +
    'example: patternを使った短く自然な英語の例文。exampleJa: その日本語訳。',
  prompt: "前の文: I'm too white for the black kids and not white enough for the white kids.\n文: Girl, you gotta blend!\n" +
    '次の文: OK, my dude, you are putting so many toxic chemicals on your face.\n対象: blend',
  schema: {
    type: 'OBJECT',
    properties: Object.fromEntries(['meaning', 'usage', 'pattern', 'example', 'exampleJa'].map(k => [k, { type: 'STRING' }])),
    required: ['meaning', 'usage', 'pattern', 'example', 'exampleJa'],
  },
};

const CLAUDE_SCHEMA = { // JSON Schema form of SAMPLE.schema (same as content.js LM_SCHEMA)
  type: 'object',
  properties: Object.fromEntries(SAMPLE.schema.required.map(k => [k, { type: 'string' }])),
  required: SAMPLE.schema.required,
  additionalProperties: false,
};

// Google's own message (it never contains the key) says what is actually wrong.
function explain(e) {
  let detail = e;
  try { const j = JSON.parse(e.slice(e.indexOf('{'))); detail = `${j.error.status}: ${j.error.message}`; } catch (_) { /* not JSON */ }
  return (/HTTP 40[013]/.test(e) ? 'キーが使えません。' : /HTTP 429/.test(e) ? '無料枠の回数制限です。' : 'エラー：') +
    `（${e.match(/HTTP \d+/) || ''} ${detail.slice(0, 300)}）`;
}

$('test').onclick = async () => {
  if (!(await save())) return status('キーを入力してください', false);
  status('使えるモデルを順に試しています…（遅いモデルがあると1分ほどかかります）');
  const r = await chrome.runtime.sendMessage({ type: 'geminiBench', ...SAMPLE });
  if (!r || !r.ok) return status(explain(r ? r.error : 'no response'), false);
  const { nds_gemini_model: chosen } = await chrome.storage.local.get('nds_gemini_model');
  const lines = r.results.map(x => `${x.model === chosen && x.ok ? '★ ' : '・'}${x.model.replace('models/', '')}：` +
    (x.ok ? `${(x.ms / 1000).toFixed(1)}秒` : explain(x.error)));
  const best = r.results.find(x => x.model === chosen && x.ok);
  if (!best) return status('どのモデルも使えませんでした\n' + lines.join('\n'), false);
  let sample = '';
  try { const j = JSON.parse(best.text); sample = `\n例「blend」→ ${j.meaning}／${j.usage}`; } catch (_) { /* ignore */ }
  status(`OK：一番速い ★ を使います\n${lines.join('\n')}${sample}`, true);
};

// ---------- Claude usage log (written by background.js recordUsage) ----------
const YEN_PER_USD = 150; // rough, for a feel of the amount
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const usd = x => '$' + x.toFixed(5);
function showUsage(s) {
  if (!s || !s.count) { $('usage').textContent = 'まだ記録がありません'; $('recent').innerHTML = ''; return; }
  const since = new Date(s.since).toLocaleDateString('ja-JP');
  $('usage').innerHTML = `${since} から <b>${s.count}回</b>・入力 ${s.input.toLocaleString()} / 出力 ${s.output.toLocaleString()} トークン・` +
    `<b>${usd(s.cost)}</b>（約${(s.cost * YEN_PER_USD).toFixed(2)}円）・1回平均 ${usd(s.cost / s.count)}`;
  $('recent').innerHTML = '<tr><th>日時</th><th>単語</th><th class="n">入力</th><th class="n">出力</th><th class="n">金額</th></tr>' +
    s.recent.map(r => `<tr><td>${new Date(r.at).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>` +
      `<td>${esc(r.target || '（テスト）')}</td><td class="n">${r.input}</td><td class="n">${r.output}</td><td class="n">${usd(r.cost)}</td></tr>`).join('');
}
chrome.storage.local.get('nds_usage', r => showUsage(r.nds_usage));
chrome.storage.onChanged.addListener(ch => { if (ch.nds_usage) showUsage(ch.nds_usage.newValue); });
$('ureset').onclick = () => chrome.storage.local.remove('nds_usage');
