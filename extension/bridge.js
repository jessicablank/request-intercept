// Runs only on the control panel page. Lets the page read/save rules in chrome.storage
// via window.postMessage. Every rule is validated before it is stored.
(() => {
  const CHANNEL = 'request-intercept';
  const METHODS = ['ANY', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
  const MATCH_TYPES = ['contains', 'exact', 'wildcard', 'regex'];
  const MODES = ['modify', 'error', 'network'];
  const MAX_RULES = 200;
  const MAX_BODY = 1024 * 1024;

  const str = (value, max) => String(value == null ? '' : value).slice(0, max);
  const pick = (value, allowed) => (allowed.includes(value) ? value : allowed[0]);
  const int = (value, min, max, fallback) => {
    const n = Number.parseInt(value, 10);
    return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
  };

  function sanitizeRule(rule) {
    if (!rule || typeof rule !== 'object') return null;
    const urlPattern = str(rule.urlPattern, 2048).trim();
    if (!urlPattern) return null;
    return {
      id: str(rule.id, 64) || Math.random().toString(36).slice(2),
      name: str(rule.name, 200),
      enabled: rule.enabled !== false,
      method: pick(rule.method, METHODS),
      matchType: pick(rule.matchType, MATCH_TYPES),
      urlPattern,
      mode: pick(rule.mode, MODES),
      status: int(rule.status, 200, 599, 200),
      contentType: str(rule.contentType, 200) || 'application/json',
      body: str(rule.body, MAX_BODY),
      delayMs: int(rule.delayMs, 0, 60000, 0),
    };
  }

  function sanitizeState(state) {
    const rules = Array.isArray(state && state.rules) ? state.rules : [];
    return {
      enabled: !(state && state.enabled === false),
      rules: rules.slice(0, MAX_RULES).map(sanitizeRule).filter(Boolean),
    };
  }

  function reply(id, type, payload) {
    window.postMessage(
      { channel: CHANNEL, direction: 'from-extension', id, type, version: chrome.runtime.getManifest().version, ...payload },
      window.location.origin,
    );
  }

  function readState(callback) {
    chrome.storage.local.get(['enabled', 'rules'], (data) => callback(sanitizeState(data)));
  }

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (event.source !== window || event.origin !== window.location.origin) return;
    if (!msg || msg.channel !== CHANNEL || msg.direction !== 'to-extension') return;

    if (msg.type === 'GET_STATE') {
      readState((state) => reply(msg.id, 'STATE', { state }));
    } else if (msg.type === 'SET_STATE') {
      const state = sanitizeState(msg.state);
      chrome.storage.local.set(state, () => {
        if (chrome.runtime.lastError) {
          reply(msg.id, 'ERROR', { error: chrome.runtime.lastError.message });
        } else {
          reply(msg.id, 'STATE', { state });
        }
      });
    }
  });
})();
