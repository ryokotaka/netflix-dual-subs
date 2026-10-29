// Fetches subtitle files for the content script (avoids CORS problems on the CDN).
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === 'fetchText') {
    fetch(msg.url, { credentials: 'omit' })
      .then(r => (r.ok ? r.text() : Promise.reject(new Error('HTTP ' + r.status))))
      .then(text => sendResponse({ ok: true, text }))
      .catch(e => sendResponse({ ok: false, error: String(e) }));
    return true; // async response
  }
});
