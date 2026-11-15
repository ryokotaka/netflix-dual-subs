// Settings page: the AI API keys are entered here (typing into a field on Netflix's
// page doesn't work reliably, the player swallows the keys) and kept in keystore.js.
// The page is Japanese for Japanese learners and English for everyone else, like the panel.
const N = self.NDS;
const $ = id => document.getElementById(id);
const show = id => (text, ok) => { $(id).textContent = text; $(id).className = 'st ' + (ok === undefined ? '' : ok ? 'ok' : 'ng'); };
const status = show('status'), cstatus = show('cstatus'), bstatus = show('bstatus');
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let LANG = 'ja';
const isJa = () => LANG === 'ja';
const L = (ja, en) => (isJa() ? ja : en);
const ready = chrome.storage.local.get('nds_settings').then(({ nds_settings: s }) => {
  LANG = N.langCode((s && s.lang) || N.guessLang(navigator.language));
  if (isJa()) return;
  document.documentElement.lang = 'en';
  document.querySelectorAll('[data-en]').forEach(e => { e.innerHTML = e.dataset.en; });
  document.querySelectorAll('[data-en-placeholder]').forEach(e => { e.placeholder = e.dataset.enPlaceholder; });
  document.title = 'Netflix Dual Subs settings';
});

(async () => {
  const old = await chrome.storage.local.get(['nds_gemini_key', 'nds_claude_key']); // if background.js hasn't moved them yet
  $('key').value = (await keystore.get('gemini')) || old.nds_gemini_key || '';
  $('ckey').value = (await keystore.get('claude')) || old.nds_claude_key || '';
})();

// A real-sized lookup with the same instruction and schema as the panel (lib.js), so the
// timing and the answer look like the real thing.
const sample = () => {
  const schema = N.lmSchema(LANG);
  return {
    system: N.lmSystem(LANG),
    prompt: N.contextPrompt(LANG, 'Okay, we need to figure it out before the demo tomorrow.', 'Trust me, I can pull it off.',
      "That's not a plan. That's a prayer.", 'pull it off'),
    schema, gemini: N.geminiSchema(schema),
  };
};
const sampleText = j => L(`\n例「pull it off」→ ${j.meaning}／${j.usage}`, `\nExample "pull it off" → ${j.meaning} / ${j.usage}`);

// ---------- Claude ----------
async function saveClaude() {
  const key = $('ckey').value.trim();
  await keystore.set('claude', key);
  await keystore.updateFlag();
  return key;
}
$('csave').onclick = async () => { cstatus((await saveClaude()) ? L('保存しました', 'Saved') : L('キーが空です', 'The key is empty'), true); };
$('cclear').onclick = async () => { $('ckey').value = ''; await saveClaude(); cstatus(L('削除しました', 'Deleted'), true); };
$('ctest').onclick = async () => {
  if (!(await saveClaude())) return cstatus(L('キーを入力してください', 'Enter a key'), false);
  cstatus(L('テスト中…', 'Testing…'));
  const t0 = performance.now();
  const s = sample();
  const r = await chrome.runtime.sendMessage({ type: 'claude', system: s.system, prompt: s.prompt, schema: s.schema });
  const sec = ((performance.now() - t0) / 1000).toFixed(1);
  if (!r || !r.ok) {
    const e = r ? r.error : 'no response';
    let detail = e;
    try { detail = JSON.parse(e.slice(e.indexOf('{'))).error.message; } catch (_) { /* not JSON */ }
    return cstatus((/HTTP 401/.test(e) ? L('キーが使えません。', "This key doesn't work. ")
      : /credit balance/i.test(e) ? L('クレジット残高がありません（Billing で購入）。', 'No credit left (buy some under Billing). ') : L('エラー：', 'Error: ')) +
      `(${e.match(/HTTP \d+/) || ''} ${detail.slice(0, 300)})`, false);
  }
  let extra = '';
  try {
    const j = JSON.parse(r.text);
    const [f, c, b] = L(['友人', '同僚', '目上'], ['friend ', 'colleague ', 'boss ']);
    extra = sampleText(j) + L('\n使える相手：', '\nSay it to: ') + `${f}${j.toFriend} ${c}${j.toColleague} ${b}${j.toSuperior}` +
      L('\n例文 ', '\nExample ') + `<${j.exampleTo}> ${j.example}`;
  } catch (_) { /* ignore */ }
  cstatus(L(`OK：使えます（claude-haiku-5-5、${sec}秒）`, `OK: it works (claude-haiku-5-5, ${sec} s)`) + extra, true);
};

// ---------- Gemini ----------
async function save() {
  const key = $('key').value.trim();
  await keystore.set('gemini', key);
  await keystore.updateFlag();
  await chrome.storage.local.remove(['nds_gemini_model', 'nds_gemini_thinking']); // a new key may see other models
  return key;
}
$('save').onclick = async () => { status((await save()) ? L('保存しました', 'Saved') : L('キーが空です（Chrome内蔵AIを使います）', "The key is empty (Chrome's built-in AI is used)"), true); };
$('clear').onclick = async () => { $('key').value = ''; await save(); status(L('削除しました（Chrome内蔵AIを使います）', "Deleted (Chrome's built-in AI is used)"), true); };

// Google's own message (it never contains the key) says what is actually wrong.
function explain(e) {
  let detail = e;
  try { const j = JSON.parse(e.slice(e.indexOf('{'))); detail = `${j.error.status}: ${j.error.message}`; } catch (_) { /* not JSON */ }
  return (/HTTP 40[013]/.test(e) ? L('キーが使えません。', "This key doesn't work. ") : /HTTP 429/.test(e) ? L('無料枠の回数制限です。', 'Free-tier rate limit. ') : L('エラー：', 'Error: ')) +
    `(${e.match(/HTTP \d+/) || ''} ${detail.slice(0, 300)})`;
}
$('test').onclick = async () => {
  if (!(await save())) return status(L('キーを入力してください', 'Enter a key'), false);
  status(L('使えるモデルを順に試しています…（遅いモデルがあると1分ほどかかります）', 'Trying each available model… (up to a minute if one is slow)'));
  const s = sample();
  const r = await chrome.runtime.sendMessage({ type: 'geminiBench', system: s.system, prompt: s.prompt, schema: s.gemini });
  if (!r || !r.ok) return status(explain(r ? r.error : 'no response'), false);
  const { nds_gemini_model: chosen } = await chrome.storage.local.get('nds_gemini_model');
  const lines = r.results.map(x => `${x.model === chosen && x.ok ? '★ ' : '・'}${x.model.replace('models/', '')}: ` +
    (x.ok ? `${(x.ms / 1000).toFixed(1)} s` : explain(x.error)));
  const best = r.results.find(x => x.model === chosen && x.ok);
  if (!best) return status(L('どのモデルも使えませんでした\n', 'No model worked\n') + lines.join('\n'), false);
  let extra = '';
  try { extra = sampleText(JSON.parse(best.text)); } catch (_) { /* ignore */ }
  status(L('OK：一番速い ★ を使います\n', 'OK: the fastest one (★) is used\n') + lines.join('\n') + extra, true);
};

// ---------- Claude usage log (written by background.js recordUsage) ----------
const YEN_PER_USD = 150; // rough, for a feel of the amount
const usd = x => '$' + x.toFixed(5);
function showUsage(s) {
  const loc = isJa() ? 'ja-JP' : undefined;
  if (!s || !s.count) { $('usage').textContent = L('まだ記録がありません', 'Nothing recorded yet'); $('recent').innerHTML = ''; return; }
  const since = new Date(s.since).toLocaleDateString(loc);
  $('usage').innerHTML = isJa()
    ? `${since} から <b>${s.count}回</b>・入力 ${s.input.toLocaleString()} / 出力 ${s.output.toLocaleString()} トークン・` +
      `<b>${usd(s.cost)}</b>（約${(s.cost * YEN_PER_USD).toFixed(2)}円）・1回平均 ${usd(s.cost / s.count)}`
    : `Since ${since}: <b>${s.count} lookups</b>, ${s.input.toLocaleString()} input / ${s.output.toLocaleString()} output tokens, ` +
      `<b>${usd(s.cost)}</b>, ${usd(s.cost / s.count)} each on average`;
  $('recent').innerHTML = `<tr><th>${L('日時', 'When')}</th><th>${L('単語', 'Word')}</th><th class="n">${L('入力', 'In')}</th><th class="n">${L('出力', 'Out')}</th><th class="n">${L('金額', 'Cost')}</th></tr>` +
    s.recent.map(r => `<tr><td>${new Date(r.at).toLocaleString(loc, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>` +
      `<td>${esc(r.target || L('（テスト）', '(test)'))}</td><td class="n">${r.input}</td><td class="n">${r.output}</td><td class="n">${usd(r.cost)}</td></tr>`).join('');
}
ready.then(() => chrome.storage.local.get('nds_usage', r => showUsage(r.nds_usage)));
chrome.storage.onChanged.addListener(ch => { if (ch.nds_usage) showUsage(ch.nds_usage.newValue); });
$('ureset').onclick = () => chrome.storage.local.remove('nds_usage');

// ---------- backup / restore (done by background.js) ----------
const counts = r => L(`保存した単語 ${r.saved}件・履歴 ${r.history}件・AIの解説 ${r.ctx}件`, `${r.saved} saved words, ${r.history} in history, ${r.ctx} AI explanations`);
function showLastBackup() {
  chrome.storage.local.get(['nds_backup', 'nds_fresh_install', 'nds_autorestore'], ({ nds_backup: b, nds_fresh_install: fresh, nds_autorestore: a }) => {
    if ($('bstatus').textContent) return;
    if (a && Date.now() - a.at < 30 * 60e3) { // just reinstalled: background.js restored the bundled backups
      bstatus(L(`入れ直しを検知して、バックアップから自動で復元しました：${counts(a)}（${a.files.join('、')}）`,
        `Reinstall detected: restored from your backups automatically: ${counts(a)} (${a.files.join(', ')})`), true);
      keystore.get('claude').then(k => {
        if (!k) { cstatus(L('APIキーは復元されないので、ここに入れ直して「保存してテスト」を押してください', 'API keys are never in backups: enter yours here and press "Save and test"'), false); $('ckey').focus(); }
      });
      return;
    }
    if (fresh) return bstatus(L('拡張が入れ直されたため、今は前のデータがありません。「バックアップから復元…」で backup.json を選んでください。' +
      '\n（復元するまでは、自動バックアップは backup.json を上書きせず backup-after-reinstall.json に保存します）',
      'The extension was reinstalled, so your earlier data isn\'t here. Choose backup.json with "Restore from a backup…".' +
      '\n(Until then, the automatic backup goes to backup-after-reinstall.json instead of overwriting backup.json.)'), false);
    bstatus(b ? L('前回のバックアップ：', 'Last backup: ') + new Date(b.at).toLocaleString(isJa() ? 'ja-JP' : undefined) : L('まだバックアップはありません', 'No backup yet'));
  });
}
ready.then(showLastBackup);
$('bnow').onclick = async () => {
  const { nds_fresh_install: fresh } = await chrome.storage.local.get('nds_fresh_install');
  if (fresh && !confirm(L('まだ復元していません。このままバックアップすると、前のデータが入った backup.json を今の少ないデータで上書きします。続けますか？',
    "You haven't restored yet. Backing up now overwrites backup.json, which has your earlier data, with what little is here now. Continue?"))) return;
  bstatus(L('バックアップ中…', 'Backing up…'));
  const r = await chrome.runtime.sendMessage({ type: 'backupNow' });
  bstatus(r && r.ok ? L(`保存しました（ダウンロード › NetflixDualSubs › backup.json${r.n > 1 ? ' と今月分' : ''}）`,
    `Saved (Downloads › NetflixDualSubs › backup.json${r.n > 1 ? ' and this month\'s copy' : ''})`)
    : L('エラー：', 'Error: ') + (r ? r.error : 'no response'), !!(r && r.ok));
};
$('bpick').onclick = () => $('bfile').click();
$('bfile').onchange = async () => {
  const f = $('bfile').files[0]; if (!f) return;
  let backup;
  try { backup = JSON.parse(await f.text()); } catch (e) { return bstatus(L('JSON として読めませんでした', "Couldn't read it as JSON"), false); }
  const r = await chrome.runtime.sendMessage({ type: 'restore', backup });
  $('bfile').value = '';
  bstatus(r && r.ok ? L(`復元しました：${counts(r)}（今あるデータと合わせています）`, `Restored: ${counts(r)} (merged with what was here)`)
    : L('エラー：', 'Error: ') + (r ? r.error : 'no response'), !!(r && r.ok));
};
