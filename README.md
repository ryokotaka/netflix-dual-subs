# Netflix Dual Subs

**For Japanese speakers learning English: watch Netflix with English and Japanese subtitles,
click any word to see what it means in that line, and review the words you looked up.**

Netflixで英語を学ぶ日本語話者のための Chrome 拡張。英日の二重字幕で観ながら、単語をクリックするとその場面での意味が分かり、調べた単語はあとで復習できます。

![Clicking "pull" in the subtitle shows the idiom "pull off", what it means in this line, who you could say it to, and an example. English and Japanese subtitles at the bottom, the transcript on the right.](docs/screenshot-lookup.png)

## What it does

- **English + Japanese subtitles**, and the whole episode as a clickable transcript
- **Click a word** → its meaning *in this line*, who you can say it to (friend / colleague / boss), and an example. Idioms like *figure it out* are recognized
- **Review** the words you looked up: four kinds of questions, spaced 1 to 21 days apart
- Keyboard: <kbd>,</kbd> previous line · <kbd>.</kbd> again · <kbd>/</kbd> next line · <kbd>R</kbd> repeat

**No API key needed.** Translation uses Google Translate's free web endpoint (falling back to
Chrome's on-device translator), the dictionary is built in, and word explanations run on
Chrome's on-device AI (Gemini Nano) where your Chrome supports it. Add a Claude API key and the
explanations come from **Claude Haiku 5.5** instead: faster and better, about $0.0002 a lookup.

![Review tab: a multiple-choice question on a saved phrase, answered.](docs/screenshot-review.png)

## Try it

1. Download **[netflix-dual-subs.zip](https://github.com/ryokotaka/netflix-dual-subs/releases/latest/download/netflix-dual-subs.zip)** and unzip it
2. Open `chrome://extensions`, turn on **Developer mode** (top right)
3. **Load unpacked** → choose the unzipped folder
4. Play anything on Netflix

<sub>Personal, non-commercial project, not affiliated with Netflix. It reads only the subtitle
tracks the player already loads; it does not download video or touch DRM. Screenshots use a
stand-in player and made-up dialogue.</sub>

---

<details>
<summary><b>How it works</b> (architecture and design notes)</summary>

```
Netflix page ─────────────────────────────────────────────────────────────────────
  inject.js  (MAIN world)     reads subtitle track URLs from the player's state,
                              seeks through the player's own API
      │ window.postMessage
  content.js (isolated world) all UI: subtitles, panel, popups, quiz, shortcuts
  lib.js                      pure functions: VTT/TTML parsing, cue alignment,
                              tokenizing, lemmas, phrase lookup (tested with node)
      │ chrome.runtime.sendMessage
background.js (service worker) fetches subtitle files (CORS), translation,
                              AI requests, daily backup
keystore.js                   API keys in the extension's own IndexedDB
options.html / options.js     settings page: keys, usage log, backup / restore
```

- **Reading tracks, not hooking requests.** An earlier version patched `JSON.parse` /
  `JSON.stringify` to catch the manifest; the player stopped passing through them and the
  hook was a suspect in first-load hangs. The extension now finds the player segment whose
  `movieId` matches the URL and reads its parsed track list, re-posting for a minute because
  some tracks get their URLs late.
- **Seeking.** Setting `video.currentTime` makes Netflix error out, so seeks go through the
  player API. That API lands slightly early, so the target line is held as "current" for up
  to 1.5 s to stop the transcript from jumping back a line.
- **Idioms.** Every 2–6 word window around the cursor is tried, longest match wins; the first
  word is lemmatized and object pronouns dropped, so *figuring **it** out* finds *figure out*.
- **API keys never enter the Netflix tab.** Keys live in IndexedDB that only the service
  worker and the settings page open. The content script sees only a flag saying which AI to
  use. Keys go in request headers only and are never logged or backed up.
- **Cost control.** AI runs only on click, never on hover. Each answer is cached per
  `movie | line | word`, so looking again costs nothing. A Claude lookup costs about
  $0.0002 (Haiku, JSON-schema output, thinking off; measured over 32 real lookups), and the
  settings page shows a usage log computed from the token counts the API returns.
- **Structured output in writing order.** The JSON schema puts "who can you say this to"
  before the example sentence, so the model picks the audience first and then writes an
  example that fits it.
- **Backups.** Saved words, history and AI answers are written to
  `Downloads/NetflixDualSubs/backup.json` once a day (plus a monthly copy), and merged back
  on restore. After a reinstall, the automatic backup writes to a separate file until you
  restore, so an empty profile can't overwrite the last good backup.
- **Pinned extension ID.** The `key` in `manifest.json` fixes the ID, so saved data stays with
  the extension even if its folder moves.

</details>

<details>
<summary><b>All features</b></summary>

- Japanese is machine-translated by default (official Japanese subtitles are often loose or
  shortened); official subtitles are one switch away. In the panel it can be blurred until you
  hover, or shown under the English too.
- Hovering a word shows the dictionary; hovering the subtitle or the panel pauses the video.
- Save words (☆): underlined in the subtitles, listed with ▶ to jump back to the scene,
  exportable to Anki CSV. A history tab keeps every word you clicked.
- Review questions: meaning (4 choices), fill in the blank, Japanese → English, and listening
  (plays the scene with subtitles hidden).
- Keys: <kbd>J</kbd> show Japanese · <kbd>Q</kbd> pause after each line · <kbd>P</kbd> panel.
  Matched by physical key, so they work with a Japanese IME on.
- Sound effects, speaker names and lyrics (`[sighs]`, `NORAH:`, `♪…♪`) are hidden.
- AI: Claude Haiku with a Claude API key, else Gemini with a Gemini key, else Chrome's
  on-device Gemini Nano. Keys go in the extension's options page.

</details>

<details>
<summary><b>Development</b></summary>

```bash
node tests/test.js          # phrase lookup, lemmas, parsers, SDH stripping
node tools/screenshots.mjs  # UI check: runs the real UI on a stand-in player page in
                            # headless Chrome and writes docs/screenshot-*.png
python3 tools/build_dict.py # rebuild ext/dict.json (pip install wn)
tools/install.sh            # copy ext/ to the internal disk (for a repo on an external drive:
                            # Chrome drops unpacked extensions whose folder is missing at startup)
```

Debug logs in DevTools are prefixed with `[NDS]`.

</details>

Translation uses Google Translate's free, unofficial endpoint, falling back to Chrome's built-in
`Translator` API. Dictionary data: EJDict (CC0) and Open Multilingual Wordnet; see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Code: [MIT](LICENSE).
