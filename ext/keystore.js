// API keys live in the extension's own IndexedDB (origin chrome-extension://<id>), used
// by background.js and the options page only. Content scripts run inside the Netflix
// page, can't open it and get no change events for it, unlike chrome.storage.
// What content.js needs is just which AI is set up: the non-secret flag nds_ai.
const keystore = (() => {
  const db = new Promise((resolve, reject) => {
    const req = indexedDB.open('nds-keys', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('keys');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const run = async (mode, op) => {
    const tx = (await db).transaction('keys', mode);
    const req = op(tx.objectStore('keys'));
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
    });
  };
  return {
    get: async name => (await run('readonly', s => s.get(name))) || '', // 'claude' | 'gemini'
    set: (name, value) => run('readwrite', s => (value ? s.put(value, name) : s.delete(name))),
    async updateFlag() {
      const ai = (await this.get('claude')) ? 'claude' : (await this.get('gemini')) ? 'gemini' : '';
      await chrome.storage.local.set({ nds_ai: ai });
    },
  };
})();
