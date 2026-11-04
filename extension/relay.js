// Runs in the extension's isolated world on every page. Reads the saved rules from
// chrome.storage and hands them to inject.js (which runs in the page's own world).
(() => {
  const RULES_EVENT = 'request-intercept:rules';
  const REQUEST_EVENT = 'request-intercept:request-rules';
  let current = null;

  function send() {
    if (!current) return;
    document.dispatchEvent(new CustomEvent(RULES_EVENT, { detail: JSON.stringify(current) }));
  }

  function load() {
    chrome.storage.local.get(['enabled', 'rules'], (data) => {
      current = {
        enabled: data.enabled !== false,
        rules: Array.isArray(data.rules) ? data.rules : [],
      };
      send();
    });
  }

  document.addEventListener(REQUEST_EVENT, send);
  chrome.storage.onChanged.addListener((_changes, area) => {
    if (area === 'local') load();
  });
  load();
})();
