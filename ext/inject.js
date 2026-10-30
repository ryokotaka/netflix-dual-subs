// Runs in the page's own JavaScript world (MAIN) at document_start.
// 1) Passes the subtitle track list (read from Netflix's player state) to the
//    extension.  2) Seeks the Netflix player on request (setting video.currentTime
//    directly makes Netflix's player error out).
// It no longer hooks JSON.stringify / JSON.parse: Netflix's player doesn't pass the
// manifest through them any more, and rewriting its requests (adding subtitle profiles)
// was a suspect for the player sometimes hanging on the first load.
(function () {
  'use strict';

  // Read the parsed manifest from the player's own state: find the segment whose
  // movieId is the current /watch/ id and take its parsedManifest.timedTextTrackList.
  function findSegment(root, movieId) {
    const seen = new Set(), queue = [[root, 0]];
    while (queue.length && seen.size < 20000) {
      const [o, d] = queue.shift();
      if (!o || typeof o !== 'object' || seen.has(o) || o instanceof Node || o === window) continue;
      seen.add(o);
      if (String(o.movieId) === movieId && o.parsedManifest && Array.isArray(o.parsedManifest.timedTextTrackList)) return o;
      if (d >= 12) continue;
      let keys; try { keys = Object.keys(o); } catch (e) { continue; }
      for (const k of keys.slice(0, 400)) { try { queue.push([o[k], d + 1]); } catch (e) { /* getter threw */ } }
    }
    return null;
  }

  // Some tracks (often Japanese) get their URLs a few seconds after the others,
  // so keep looking for a minute and resend whenever more tracks have URLs.
  let sent = { id: '', n: 0, tries: 0 };
  setInterval(() => {
    const m = location.pathname.match(/\/watch\/(\d+)/);
    if (!m) return;
    if (!document.querySelector('video')) return; // leave the player alone until it has started
    if (sent.id !== m[1]) sent = { id: m[1], n: 0, tries: 0 };
    if (++sent.tries > 60) return;
    try {
      const seg = findSegment(window.netflix.appContext.state.playerApp.getState().videoPlayer, m[1]);
      if (!seg) return;
      const tracks = seg.parsedManifest.timedTextTrackList
        .filter(t => !t.none && !t.isImageBased && t.profile && t.urls && t.urls.length)
        .map(t => ({
          lang: t.bcp47 || '',
          label: t.displayName || '',
          type: String(t.rawTrackType || '').toLowerCase(),
          forced: !!t.forced,
          urls: { [t.profile]: t.urls[0].url },
        }));
      if (tracks.length <= sent.n) return;
      sent.n = tracks.length;
      console.log('[NDS] tracks', m[1], tracks.filter(t => /^(en|ja)/i.test(t.lang)).map(t => `${t.lang}/${t.type}${t.forced ? '/forced' : ''}`).join(' '));
      window.postMessage({ __nds: 'tracks', movieId: m[1], tracks }, '*');
    } catch (e) { /* player not ready yet */ }
  }, 1000);

  function player() {
    try {
      const vp = window.netflix.appContext.state.playerApp.getAPI().videoPlayer;
      const ids = vp.getAllPlayerSessionIds();
      return vp.getVideoPlayerBySessionId(ids[ids.length - 1]);
    } catch (e) { return null; }
  }

  window.addEventListener('message', ev => {
    if (ev.source !== window || !ev.data || ev.data.__nds !== 'seek') return;
    const p = player();
    if (p) p.seek(Math.max(0, Math.round(ev.data.ms)));
  });
})();
