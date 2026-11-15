// Pure helpers: subtitle parsing, lemmatizing, dictionary/idiom lookup.
// Shared by content.js (browser) and test.js (node).
(function (root) {
  'use strict';

  // ---------- subtitle parsing ----------
  function decodeEntities(s) {
    return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
      .replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
      .replace(/&amp;/g, '&');
  }
  function cleanText(s) {
    return decodeEntities(s.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ''))
      .split('\n').map(l => l.trim()).filter(Boolean).join('\n');
  }

  // Closed captions also carry sound descriptions ("[sighs]", "(laughs)"), speaker
  // labels ("[Maya] What?", "SAM: Hi") and song lyrics ("♪ La la ♪").
  // Keeps only the spoken words; '' when nothing is left.
  function stripSdh(text) {
    const lines = text.split('\n').map(line => {
      const dash = /^\s*-/.test(line) ? '-' : '';
      let l = line.replace(/^\s*-\s*/, '');
      if (/[♪♫]/.test(l)) return '';
      l = l.replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')
        .replace(/^\s*[A-Z][A-Z0-9 .'-]{1,24}:\s*/, '')
        .replace(/\s{2,}/g, ' ').trim();
      return /[A-Za-z0-9]/.test(l) ? dash + l : '';
    }).filter(Boolean);
    if (lines.length === 1) lines[0] = lines[0].replace(/^-\s*/, ''); // the other speaker was only a sound
    return lines.join('\n');
  }

  function parseClock(t, tickRate) {
    t = String(t).trim();
    let m;
    if ((m = t.match(/^([\d.]+)t$/))) return (+m[1] / tickRate) * 1000;
    if ((m = t.match(/^([\d.]+)(ms|s|m|h)$/))) {
      const mult = { ms: 1, s: 1000, m: 60000, h: 3600000 }[m[2]];
      return +m[1] * mult;
    }
    const p = t.replace(',', '.').split(':').map(Number);
    if (p.length === 3) return ((p[0] * 60 + p[1]) * 60 + p[2]) * 1000;
    if (p.length === 2) return (p[0] * 60 + p[1]) * 1000;
    return +t * 1000;
  }

  function parseVTT(text) {
    const cues = [];
    const blocks = text.replace(/\r/g, '').split(/\n\n+/);
    for (const b of blocks) {
      const lines = b.split('\n');
      const i = lines.findIndex(l => l.includes('-->'));
      if (i < 0) continue;
      const [a, z] = lines[i].split('-->');
      const txt = cleanText(lines.slice(i + 1).join('\n'));
      if (!txt) continue;
      cues.push({ start: parseClock(a, 1), end: parseClock(z.trim().split(/\s+/)[0], 1), text: txt });
    }
    return cues;
  }

  function parseTTML(xml) {
    const tr = xml.match(/ttp:tickRate\s*=\s*"(\d+)"/);
    const tickRate = tr ? +tr[1] : 10000000;
    const cues = [];
    const re = /<p\b([^>]*)>([\s\S]*?)<\/p>/g;
    let m;
    while ((m = re.exec(xml))) {
      const b = m[1].match(/\bbegin\s*=\s*"([^"]+)"/);
      const e = m[1].match(/\bend\s*=\s*"([^"]+)"/);
      if (!b || !e) continue;
      const txt = cleanText(m[2]);
      if (!txt) continue;
      cues.push({ start: parseClock(b[1], tickRate), end: parseClock(e[1], tickRate), text: txt });
    }
    return cues.sort((x, y) => x.start - y.start);
  }

  function parseSubtitles(text) {
    const head = text.slice(0, 200);
    if (/^﻿?WEBVTT/.test(head)) return parseVTT(text);
    if (head.includes('<')) return parseTTML(text);
    return parseVTT(text);
  }

  // Pick, for each target cue, the source cues that overlap it most in time.
  function alignCues(target, source) {
    let j = 0;
    return target.map(c => {
      while (j < source.length && source[j].end <= c.start) j++;
      const hits = [];
      for (let k = Math.max(0, j - 1); k < source.length && source[k].start < c.end; k++) {
        const ov = Math.min(c.end, source[k].end) - Math.max(c.start, source[k].start);
        if (ov > Math.min(300, (c.end - c.start) / 3)) hits.push(source[k].text);
      }
      return hits.join('\n');
    });
  }

  // ---------- tokenizing & lemmatizing ----------
  function tokenize(text) {
    // returns [{t: surface, w: lowercase word or null}]
    const out = [];
    const re = /([A-Za-z]+(?:['’][A-Za-z]+)*)|([^A-Za-z]+)/g;
    let m;
    while ((m = re.exec(text))) {
      if (m[1]) out.push({ t: m[1], w: m[1].toLowerCase().replace(/’/g, "'") });
      else out.push({ t: m[2], w: null });
    }
    return out;
  }

  const IRREG = {
    was: 'be', were: 'be', is: 'be', are: 'be', am: 'be', been: 'be', being: 'be',
    has: 'have', had: 'have', does: 'do', did: 'do', done: 'do',
    went: 'go', gone: 'go', got: 'get', gotten: 'get', made: 'make', said: 'say',
    took: 'take', taken: 'take', came: 'come', saw: 'see', seen: 'see',
    knew: 'know', known: 'know', thought: 'think', found: 'find', gave: 'give',
    given: 'give', told: 'tell', felt: 'feel', left: 'leave', kept: 'keep',
    brought: 'bring', bought: 'buy', began: 'begin', begun: 'begin',
    ran: 'run', held: 'hold', stood: 'stand', heard: 'hear', meant: 'mean',
    met: 'meet', paid: 'pay', sat: 'sit', spoke: 'speak', spoken: 'speak',
    lost: 'lose', sent: 'send', built: 'build', fell: 'fall', fallen: 'fall',
    caught: 'catch', taught: 'teach', fought: 'fight', wrote: 'write',
    written: 'write', broke: 'break', broken: 'break', chose: 'choose',
    chosen: 'choose', drove: 'drive', driven: 'drive', ate: 'eat', eaten: 'eat',
    drank: 'drink', drunk: 'drink', forgot: 'forget', forgotten: 'forget',
    grew: 'grow', grown: 'grow', threw: 'throw', thrown: 'throw', wore: 'wear',
    worn: 'wear', won: 'win', hung: 'hang', shook: 'shake', blew: 'blow',
    blown: 'blow', woke: 'wake', hid: 'hide', hidden: 'hide', led: 'lead',
    slept: 'sleep', spent: 'spend', stuck: 'stick', swore: 'swear',
    understood: 'understand', freaked: 'freak', children: 'child', men: 'man',
    women: 'woman', people: 'person', feet: 'foot', teeth: 'tooth', mice: 'mouse',
    better: 'good', best: 'good', worse: 'bad', worst: 'bad',
    gonna: 'going to', wanna: 'want to', gotta: 'have got to', "ain't": 'be not',
  };
  const CONTR = { "n't": '', "'s": '', "'re": '', "'ve": '', "'ll": '', "'d": '', "'m": '' };

  // candidate base forms, most likely first
  function lemmas(w) {
    const c = [w];
    const add = x => { if (x && x.length > 1 && !c.includes(x)) c.push(x); };
    for (const k in CONTR) if (w.endsWith(k) && w.length > k.length + 1) add(w.slice(0, -k.length));
    if (w === "can't") add('can'); if (w === "won't") add('will');
    let base = c[c.length - 1];
    if (base.endsWith('in') && base.length > 4 && !base.endsWith('ain')) { base = base + 'g'; add(base); } // talkin' → talking
    if (IRREG[base]) add(IRREG[base]);
    const s = base;
    if (s.endsWith('ies')) add(s.slice(0, -3) + 'y');
    if (s.endsWith('es')) add(s.slice(0, -2));
    if (s.endsWith('s') && !s.endsWith('ss')) add(s.slice(0, -1));
    if (s.endsWith('ied')) add(s.slice(0, -3) + 'y');
    if (s.endsWith('ed')) { add(s.slice(0, -2)); add(s.slice(0, -1)); undouble(s.slice(0, -2), add); }
    if (s.endsWith('ing')) { add(s.slice(0, -3)); add(s.slice(0, -3) + 'e'); undouble(s.slice(0, -3), add); }
    if (s.endsWith('ier')) add(s.slice(0, -3) + 'y');
    if (s.endsWith('iest')) add(s.slice(0, -4) + 'y');
    if (s.endsWith('er')) { add(s.slice(0, -2)); add(s.slice(0, -1)); }
    if (s.endsWith('est')) { add(s.slice(0, -3)); add(s.slice(0, -2)); }
    if (s.endsWith('ly')) add(s.slice(0, -2));
    return c;
  }
  function undouble(s, add) {
    if (s.length > 2 && s[s.length - 1] === s[s.length - 2]) add(s.slice(0, -1));
  }

  // ---------- dictionary lookup ----------
  const OBJ = new Set(['it', 'them', 'him', 'her', 'me', 'you', 'us', 'this', 'that', 'something', 'someone', 'everything', 'things', 'stuff']);

  function lookupWord(dict, w) {
    for (const l of lemmas(w)) {
      let mean = dict.w[l] || (l.includes(' ') && dict.p[l]);
      if (!mean) continue;
      // "gave → giveの過去形": also show the base word's meaning
      const ref = mean.match(/^([a-z]+)の(?:過去|過去分詞|現在分詞|複数|三人称|比較|最上)/);
      if (ref && ref[1] !== l && dict.w[ref[1]]) return { head: ref[1], mean: `(${l}: ${mean.split(' / ')[0]}) / ` + dict.w[ref[1]] };
      return { head: l, mean };
    }
    return null;
  }

  // words: array of lowercase words (only word tokens) for one subtitle line.
  // i: index of hovered word. Returns longest idiom covering i, if any.
  function lookupPhrase(dict, words, i) {
    let best = null;
    const firstForms = idx => lemmas(words[idx]);
    for (let start = Math.max(0, i - 4); start <= i; start++) {
      for (let len = 6; len >= 2; len--) {
        const end = start + len; // exclusive
        if (end > words.length || end <= i) continue;
        const rest = words.slice(start + 1, end);
        const variants = [rest];
        // separable phrasal verbs: "figure it out" → "figure out"
        const noObj = rest.filter((w, k) => !(OBJ.has(w) && k < rest.length - 1));
        if (noObj.length !== rest.length && noObj.length >= 1) variants.push(noObj);
        for (const f of firstForms(start)) {
          for (const v of variants) {
            const key = [f, ...v].join(' ');
            if (dict.p[key] && (!best || len > best.len)) {
              best = { head: key, mean: dict.p[key], len, start, end, surface: words.slice(start, end).join(' ') };
            }
          }
        }
      }
    }
    return best;
  }

  // ---------- the learner's language ----------
  // Subtitles are translated into it and the AI explains in it. The UI is Japanese for
  // Japanese and English for everyone else. [native name, English name]
  const LANGS = {
    ja: ['日本語', 'Japanese'], ko: ['한국어', 'Korean'], 'zh-CN': ['简体中文', 'Simplified Chinese'],
    'zh-TW': ['繁體中文', 'Traditional Chinese'], es: ['Español', 'Spanish'], pt: ['Português', 'Portuguese'],
    fr: ['Français', 'French'], de: ['Deutsch', 'German'], it: ['Italiano', 'Italian'], ru: ['Русский', 'Russian'],
    uk: ['Українська', 'Ukrainian'], pl: ['Polski', 'Polish'], tr: ['Türkçe', 'Turkish'], ar: ['العربية', 'Arabic'],
    hi: ['हिन्दी', 'Hindi'], id: ['Bahasa Indonesia', 'Indonesian'], vi: ['Tiếng Việt', 'Vietnamese'], th: ['ไทย', 'Thai'],
  };
  const langCode = l => (LANGS[l] ? l : 'ja');
  const chromeLang = l => ({ 'zh-CN': 'zh', 'zh-TW': 'zh-Hant' }[l] || l); // Chrome's Translator / Prompt API
  const netflixLang = l => ({ 'zh-CN': 'zh-hans', 'zh-TW': 'zh-hant' }[l] || l); // start of Netflix's track codes
  // From the browser's language, for a first start (English speakers get Japanese, the original)
  function guessLang(nav) {
    const n = String(nav || '');
    if (/^zh/i.test(n)) return /TW|HK|MO|Hant/i.test(n) ? 'zh-TW' : 'zh-CN';
    const base = n.split('-')[0].toLowerCase();
    return LANGS[base] ? base : 'ja';
  }

  // ---------- word explanations: one schema for Claude, Gemini and Chrome's model ----------
  // The model fills the fields in this order, so who-can-you-say-it-to and the example's
  // audience are decided before the example is written. The ratings are about the phrase
  // itself (if you said it), not about this scene, which is usually casual.
  const AUDIENCE = ['◎', '○', '△', '×'];
  const EXAMPLE_TO_JA = ['友人に', '同僚に', '上司に', '誰でも'];
  const EXAMPLE_TO_EN = ['friend', 'colleague', 'boss', 'anyone'];
  function lmSchema(l) {
    const enumOf = { toFriend: AUDIENCE, toColleague: AUDIENCE, toSuperior: AUDIENCE,
      exampleTo: langCode(l) === 'ja' ? EXAMPLE_TO_JA : EXAMPLE_TO_EN };
    const fields = ['meaning', 'usage', 'toFriend', 'toColleague', 'toSuperior', 'pattern', 'exampleTo', 'example', 'exampleJa'];
    return {
      type: 'object',
      properties: Object.fromEntries(fields.map(k => [k, enumOf[k] ? { type: 'string', enum: enumOf[k] } : { type: 'string' }])),
      required: fields,
      additionalProperties: false,
    };
  }
  const geminiSchema = s => ({ // Gemini's schema dialect
    type: 'OBJECT',
    properties: Object.fromEntries(s.required.map(k => [k, s.properties[k].enum ? { type: 'STRING', enum: s.properties[k].enum } : { type: 'STRING' }])),
    required: s.required,
    propertyOrdering: s.required,
  });
  function lmSystem(l) {
    if (langCode(l) === 'ja') {
      return 'あなたは日本人の英語学習者を助ける先生です。英語の字幕の1文（前後の文つき）と、その中の単語または熟語が与えられます。' +
        'その語を学ぶのに役立つ情報を答えてください。' +
        'meaning: この文での意味（日本語、20文字以内）。usage: この場面での使われ方・ニュアンス・話し手の気持ち（日本語、60文字以内）。' +
        'toFriend / toColleague / toSuperior: この場面に関係なく、この意味でのこの言い方を学習者自身が友人／同僚／上司など目上に言ってよいか' +
        '（◎自然 ○使える △避けた方が無難 ×失礼・不適切）。' +
        'pattern: よく使う形やコロケーション（英語、～で可変部分）。' +
        'exampleTo: 例文を言う相手。toFriend / toColleague / toSuperior で◎か○の相手から選ぶ（どの相手にも自然なら 誰でも）。' +
        'example: patternを使い、exampleTo の相手に言う短く自然な英語の例文。exampleJa: その日本語訳。';
    }
    const name = LANGS[l][1];
    return `You are a teacher helping a ${name} speaker learn English. You get one line of English subtitles (with the lines around it) and a word or phrase in it. ` +
      'Answer with what helps them learn it. ' +
      `meaning: what it means in this line (in ${name}, a few words). usage: how it is used here: the nuance and the speaker's feeling (in ${name}, one short sentence). ` +
      'toFriend / toColleague / toSuperior: regardless of this scene, could the learner themself say this, in this sense, to a friend / a colleague / a boss or someone senior ' +
      '(◎ natural, ○ fine, △ better avoided, × rude or inappropriate). ' +
      'pattern: a common form or collocation (in English, ~ for the part that changes). ' +
      'exampleTo: who the example is said to, chosen from those rated ◎ or ○ (anyone, if it is natural with everyone). ' +
      `example: a short, natural English example using the pattern, said to exampleTo. exampleJa: its ${name} translation.`;
  }
  function contextPrompt(l, prev, line, next, target) {
    const [p, c, n, t] = langCode(l) === 'ja' ? ['前の文', '文', '次の文', '対象'] : ['Previous line', 'Line', 'Next line', 'Target'];
    return (prev ? `${p}: ${prev}\n` : '') + `${c}: ${line}\n` + (next ? `${n}: ${next}\n` : '') + `${t}: ${target}`;
  }

  const api = { parseVTT, parseTTML, parseSubtitles, alignCues, tokenize, lemmas, lookupWord, lookupPhrase, cleanText, stripSdh,
    LANGS, langCode, chromeLang, netflixLang, guessLang, lmSchema, geminiSchema, lmSystem, contextPrompt, EXAMPLE_TO_EN };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NDS = api;
})(typeof self !== 'undefined' ? self : this);
