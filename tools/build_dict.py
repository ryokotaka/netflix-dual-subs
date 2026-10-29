"""Rebuild ext/dict.json.

Usage:  pip install wn  &&  python3 tools/build_dict.py
Downloads (once, into tools/data/): EJDict (CC0, GitHub) and Open Multilingual
Wordnet English + Japanese. Hand-written colloquial idioms in
tools/extra_phrases.json override everything else.
"""
import json, glob, os, subprocess, pathlib, wn
HERE = pathlib.Path(__file__).resolve().parent
SP = str(HERE / 'data'); OUT = str(HERE.parent / 'ext' / 'dict.json'); EXTRA = str(HERE / 'extra_phrases.json')
os.makedirs(SP, exist_ok=True)
if not os.path.isdir(SP + '/ejdict/EJDict'):
    os.makedirs(SP + '/ejdict', exist_ok=True)
    subprocess.run(['git', 'clone', '--depth', '1', 'https://github.com/kujirahand/EJDict.git', SP + '/ejdict/EJDict'], check=True)
wn.config.data_directory = SP + '/wn_data'
for pkg in ('omw-en:1.4', 'omw-ja:1.4'):
    try: wn.Wordnet(pkg)
    except Exception: wn.download(pkg, progress_handler=None)
en = wn.Wordnet('omw-en:1.4')

words, phrases = {}, {}
def trim(s, n): return s if len(s) <= n else s[:n].rsplit(' / ', 1)[0] + ' …'

for f in sorted(glob.glob(SP + '/ejdict/EJDict/src/*.txt')):
    for line in open(f, encoding='utf-8'):
        if '\t' not in line: continue
        heads, mean = line.rstrip('\n').split('\t', 1)
        mean = trim(mean.strip(), 220)
        for h in heads.split(','):
            h = h.strip().lower()
            if not h: continue
            (phrases if ' ' in h else words).setdefault(h, mean)

common = set(words)
def clean(l): return l.replace('+', '').replace('･', '・')
added = 0
for w in en.words():
    lemma = w.lemma()
    if '_' not in lemma and ' ' not in lemma: continue
    key = lemma.replace('_', ' ').lower()
    toks = key.split()
    if len(toks) > 4 or key in phrases: continue
    if not all(t in common for t in toks): continue
    pos = w.pos
    senses = []
    for s in w.synsets()[:3]:
        ja = []
        for t in s.translate(lexicon='omw-ja:1.4'):
            for l in t.lemmas():
                l = clean(l)
                if l not in ja: ja.append(l)
        senses.append('、'.join(ja[:4]) if ja else '(' + s.definition()[:60] + ')')
    if pos == 'n' and not any(not x.startswith('(') for x in senses): continue
    phrases[key] = ' / '.join(dict.fromkeys(senses))
    added += 1

for k, v in json.load(open(EXTRA, encoding='utf-8')).items():
    phrases[k] = v   # hand-written colloquial phrasal verbs override

for k, v in json.load(open(str(HERE / 'extra_words.json'), encoding='utf-8')).items():
    words[k] = (words[k] + ' / ' + v) if k in words else v   # extra senses appended

json.dump({'w': words, 'p': phrases}, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print('words', len(words), 'phrases', len(phrases), 'from wordnet', added)
