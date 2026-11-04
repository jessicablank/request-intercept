(() => {
  'use strict';

  const CHANNEL = 'request-intercept';
  const STORAGE_KEY = 'request-intercept-state';
  const $ = (id) => document.getElementById(id);

  let state = { enabled: true, rules: [] };
  let extensionAvailable = false;

  // ---------- communication with the extension (via bridge.js) ----------
  function callExtension(type, payload = {}, timeoutMs = 1500) {
    return new Promise((resolve, reject) => {
      const id = Math.random().toString(36).slice(2);
      const timer = setTimeout(() => {
        window.removeEventListener('message', onMessage);
        reject(new Error('Extension did not respond'));
      }, timeoutMs);
      function onMessage(event) {
        const msg = event.data;
        if (event.source !== window || !msg || msg.channel !== CHANNEL) return;
        if (msg.direction !== 'from-extension' || msg.id !== id) return;
        clearTimeout(timer);
        window.removeEventListener('message', onMessage);
        if (msg.type === 'ERROR') reject(new Error(msg.error));
        else resolve(msg);
      }
      window.addEventListener('message', onMessage);
      window.postMessage({ channel: CHANNEL, direction: 'to-extension', type, id, ...payload }, window.location.origin);
    });
  }

  function loadLocal() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (saved && Array.isArray(saved.rules)) return { enabled: saved.enabled !== false, rules: saved.rules };
    } catch (_) { /* ignore */ }
    return { enabled: true, rules: [] };
  }

  async function persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    if (!extensionAvailable) return;
    try {
      const reply = await callExtension('SET_STATE', { state });
      state = reply.state;
    } catch (err) {
      showStatus(false, `Could not save rules to the extension: ${err.message}`);
    }
  }

  function showStatus(ok, text) {
    const banner = $('extension-status');
    banner.className = `banner ${ok ? 'banner-ok' : 'banner-warn'}`;
    banner.textContent = text;
  }

  // ---------- rendering ----------
  function describe(rule) {
    if (rule.mode === 'network') return 'Network failure';
    if (rule.mode === 'error') return `Error ${rule.status}`;
    return '200 OK (modified)';
  }

  function cell(text, className) {
    const td = document.createElement('td');
    td.textContent = text;
    if (className) td.className = className;
    return td;
  }

  function button(text, className, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = text;
    b.className = `small ${className}`;
    b.addEventListener('click', onClick);
    return b;
  }

  function render() {
    $('global-enabled').checked = state.enabled;
    const tbody = $('rules-body');
    tbody.replaceChildren();
    state.rules.forEach((rule) => {
      const tr = document.createElement('tr');
      const toggleCell = document.createElement('td');
      const toggle = document.createElement('input');
      toggle.type = 'checkbox';
      toggle.checked = rule.enabled;
      toggle.setAttribute('aria-label', 'Rule enabled');
      toggle.addEventListener('change', () => {
        state.rules = state.rules.map((current) =>
          current.id === rule.id ? { ...current, enabled: toggle.checked } : current);
        persist();
      });
      toggleCell.append(toggle);

      const actions = document.createElement('td');
      actions.className = 'buttons';
      actions.append(
        button('Edit', 'secondary', () => editRule(rule.id)),
        ' ',
        button('Delete', 'danger', () => deleteRule(rule.id)),
      );

      tr.append(
        toggleCell,
        cell(rule.name || '—'),
        cell(rule.method),
        cell(`${rule.matchType === 'contains' ? '' : `[${rule.matchType}] `}${rule.urlPattern}`, 'url'),
        cell(describe(rule)),
        actions,
      );
      tbody.append(tr);
    });
    $('no-rules').hidden = state.rules.length > 0;
    $('rules-table').hidden = state.rules.length === 0;
  }

  function updateModeFields() {
    const mode = $('rule-mode').value;
    $('status-field').hidden = mode !== 'error';
    $('body-fields').hidden = mode === 'network';
  }

  // ---------- form ----------
  function resetForm() {
    $('rule-form').reset();
    $('rule-id').value = '';
    $('form-title').textContent = 'Add a rule';
    $('save-rule').textContent = 'Add rule';
    $('cancel-edit').hidden = true;
    $('body-message').textContent = '';
    updateModeFields();
  }

  function editRule(id) {
    const rule = state.rules.find((r) => r.id === id);
    if (!rule) return;
    $('rule-id').value = rule.id;
    $('rule-name').value = rule.name || '';
    $('rule-method').value = rule.method;
    $('rule-url').value = rule.urlPattern;
    $('rule-match').value = rule.matchType;
    $('rule-mode').value = rule.mode;
    $('rule-status').value = rule.mode === 'error' ? rule.status : 404;
    $('rule-delay').value = rule.delayMs || 0;
    $('rule-content-type').value = rule.contentType || '';
    $('rule-body').value = rule.body || '';
    $('form-title').textContent = 'Edit rule';
    $('save-rule').textContent = 'Save changes';
    $('cancel-edit').hidden = false;
    updateModeFields();
    $('rule-form').scrollIntoView({ behavior: 'smooth' });
  }

  function deleteRule(id) {
    state.rules = state.rules.filter((r) => r.id !== id);
    if ($('rule-id').value === id) resetForm();
    render();
    persist();
  }

  function validPattern(pattern, matchType) {
    if (matchType !== 'regex') return true;
    try { new RegExp(pattern); return true; } catch (_) { return false; }
  }

  $('rule-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const mode = $('rule-mode').value;
    const matchType = $('rule-match').value;
    const urlPattern = $('rule-url').value.trim();
    const status = Number.parseInt($('rule-status').value, 10);
    if (!validPattern(urlPattern, matchType)) {
      $('body-message').textContent = 'The URL is not a valid regular expression.';
      return;
    }
    if (mode === 'error' && !(status >= 200 && status <= 599)) {
      $('body-message').textContent = 'Status code must be between 200 and 599.';
      return;
    }
    const id = $('rule-id').value || (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));
    const existing = state.rules.find((r) => r.id === id);
    const rule = {
      id,
      name: $('rule-name').value.trim(),
      enabled: existing ? existing.enabled : true,
      method: $('rule-method').value,
      matchType,
      urlPattern,
      mode,
      status: mode === 'error' ? status : 200,
      contentType: $('rule-content-type').value.trim(),
      body: $('rule-body').value,
      delayMs: Math.max(0, Number.parseInt($('rule-delay').value, 10) || 0),
    };
    if (existing) state.rules[state.rules.indexOf(existing)] = rule;
    else state.rules.push(rule);
    resetForm();
    render();
    persist();
  });

  $('cancel-edit').addEventListener('click', resetForm);
  $('rule-mode').addEventListener('change', updateModeFields);
  $('global-enabled').addEventListener('change', () => {
    state.enabled = $('global-enabled').checked;
    persist();
  });

  $('format-json').addEventListener('click', () => {
    try {
      $('rule-body').value = JSON.stringify(JSON.parse($('rule-body').value), null, 2);
      $('body-message').textContent = '';
    } catch (err) {
      $('body-message').textContent = `Not valid JSON: ${err.message}`;
    }
  });

  $('load-real').addEventListener('click', async () => {
    const url = $('rule-url').value.trim();
    const method = $('rule-method').value;
    if (!url || $('rule-match').value === 'regex') {
      $('body-message').textContent = 'Enter a full API URL first.';
      return;
    }
    $('body-message').textContent = 'Loading…';
    try {
      const response = await fetch(url, { method: method === 'ANY' ? 'GET' : method });
      const text = await response.text();
      $('rule-content-type').value = response.headers.get('Content-Type') || $('rule-content-type').value;
      try { $('rule-body').value = JSON.stringify(JSON.parse(text), null, 2); } catch (_) { $('rule-body').value = text; }
      $('body-message').textContent = `Loaded real response (${response.status}). Edit it, then save the rule.`;
    } catch (err) {
      $('body-message').textContent = `Could not load (the API may block cross-origin requests): ${err.message}`;
    }
  });

  // ---------- tester ----------
  $('test-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const output = $('test-output');
    output.hidden = false;
    output.textContent = 'Sending…';
    const started = performance.now();
    try {
      const response = await fetch($('test-url').value.trim(), { method: $('test-method').value });
      const text = await response.text();
      const ruleId = response.headers.get('X-Request-Intercept');
      const rule = ruleId && state.rules.find((r) => r.id === ruleId);
      const label = rule ? rule.name || `${rule.urlPattern} → ${describe(rule)}` : ruleId;
      const source = ruleId ? `INTERCEPTED by rule "${label}"` : 'Real network response (no rule matched)';
      output.textContent = `${source}\nStatus: ${response.status} ${response.statusText}\n` +
        `Time: ${Math.round(performance.now() - started)} ms\n\n${text}`;
    } catch (err) {
      output.textContent = `Request failed: ${err.message}`;
    }
  });

  // ---------- startup ----------
  async function init() {
    state = loadLocal();
    resetForm();
    render();
    try {
      const reply = await callExtension('GET_STATE');
      extensionAvailable = true;
      if (reply.state.rules.length === 0 && state.rules.length > 0) {
        await persist();
      } else {
        state = reply.state;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      }
      render();
      showStatus(true, `Extension connected (v${reply.version}). Rules are active in every tab of this browser.`);
    } catch (_) {
      showStatus(false, 'Extension not detected. Rules are saved on this page but will not intercept anything until you install the companion extension (see setup below).');
      $('setup').open = true;
    }
  }

  init();
})();
