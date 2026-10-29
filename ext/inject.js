// Runs in the page's own JavaScript world (MAIN) at document_start.
// 1) Asks Netflix for text-based subtitle formats and passes the subtitle track
//    list to the extension.  2) Seeks the Netflix player on request
//    (setting video.currentTime directly makes Netflix's player error out).
(function () {
  'use strict';
  const TEXT_PROFILES = ['webvtt-lssdh-ios8', 'dfxp-ls-sdh', 'simplesdh', 'imsc1.1'];

  const origStringify = JSON.stringify;
  JSON.stringify = function (value) {
    try {
      const targets = [value, value && value.params];
      for (const t of targets) {
        if (t && Array.isArray(t.profiles) && t.profiles.some(p => typeof p === 'string')) {
          for (const p of TEXT_PROFILES) if (!t.profiles.includes(p)) t.profiles.push(p);
        }
      }
    } catch (e) { /* never break Netflix */ }
    return origStringify.apply(this, arguments);
  };

  function urlsOf(dl) {
    if (!dl) return [];
    if (dl.downloadUrls) return Object.values(dl.downloadUrls);
    if (Array.isArray(dl.urls)) return dl.urls.map(u => (typeof u === 'string' ? u : u.url)).filter(Boolean);
    return [];
  }

  function findTracks(obj, depth) {
    if (!obj || typeof obj !== 'object' || depth > 4) return null;
    if (Array.isArray(obj.timedtexttracks)) return obj;
    for (const k of ['result', 'results', 'data']) {
      const r = obj[k] && findTracks(obj[k], depth + 1);
      if (r) return r;
    }
    return null;
  }

  const origParse = JSON.parse;
  JSON.parse = function () {
    const value = origParse.apply(this, arguments);
    try {
      const m = findTracks(value, 0);
      if (m) {
        const tracks = m.timedtexttracks
          .filter(t => !t.isNoneTrack && t.ttDownloadables)
          .map(t => {
            const urls = {};
            for (const p of Object.keys(t.ttDownloadables)) {
              const u = urlsOf(t.ttDownloadables[p]);
              if (u.length) urls[p] = u[0];
            }
            return {
              lang: t.language || t.bcp47 || '',
              label: t.languageDescription || '',
              type: t.rawTrackType || t.trackType || '',
              forced: !!t.isForcedNarrative,
              urls,
            };
          })
          .filter(t => Object.keys(t.urls).length);
        window.postMessage({ __nds: 'tracks', movieId: String(m.movieId || ''), tracks }, '*');
      }
    } catch (e) { /* ignore */ }
    return value;
  };

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
