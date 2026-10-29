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

  const api = { parseVTT, parseTTML, parseSubtitles, alignCues, tokenize, lemmas, lookupWord, lookupPhrase, cleanText };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NDS = api;
})(typeof self !== 'undefined' ? self : this);
