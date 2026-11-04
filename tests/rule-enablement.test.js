const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

class Element extends EventTarget {
  constructor() {
    super();
    this.children = [];
    this.value = '';
    this.checked = false;
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute() {}
  reset() {}
}

class CustomEvent extends Event {
  constructor(type, options = {}) {
    super(type);
    this.detail = options.detail;
  }
}

const rule = (id) => ({
  id, enabled: true, method: 'ANY', matchType: 'contains',
  urlPattern: '/api', mode: 'modify', body: id,
});
const settle = () => new Promise((resolve) => setImmediate(resolve));

async function setup({ enabled = true, rules = [rule('first')] } = {}) {
  const elements = new Map();
  const document = new EventTarget();
  document.getElementById = (id) => {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id);
  };
  document.createElement = () => new Element();
  const window = new EventTarget();
  window.location = { origin: 'http://localhost', href: 'http://localhost/' };
  window.postMessage = (data) => {
    const message = new Event('message');
    Object.assign(message, {
      data: structuredClone(data), source: window, origin: window.location.origin,
    });
    queueMicrotask(() => window.dispatchEvent(message));
  };
  window.fetch = async () => new Response('real');
  window.XMLHttpRequest = class extends EventTarget {
    open() {}
    send() {
      this.status = 200;
      this.responseText = 'real';
      this.dispatchEvent(new Event('loadend'));
    }
  };
  let stored = structuredClone({ enabled, rules });
  const storageListeners = [];
  const chrome = {
    runtime: { getManifest: () => ({ version: 'test' }) },
    storage: {
      local: {
        get(_keys, callback) {
          queueMicrotask(() => callback(structuredClone(stored)));
        },
        set(state, callback) {
          stored = structuredClone(state);
          queueMicrotask(() => {
            storageListeners.forEach((listener) => listener({}, 'local'));
            callback();
          });
        },
      },
      onChanged: { addListener: (listener) => storageListeners.push(listener) },
    },
  };
  const local = new Map();
  const context = vm.createContext({
    window, document, chrome, location: window.location,
    localStorage: {
      getItem: (key) => local.get(key) || null,
      setItem: (key, value) => local.set(key, value),
    },
    Event, CustomEvent, ProgressEvent: Event, Response, Request, URL,
    setTimeout, clearTimeout, console: { info() {} },
  });
  for (const file of ['extension/bridge.js', 'extension/inject.js', 'extension/relay.js', 'docs/app.js']) {
    vm.runInContext(readFileSync(join(__dirname, '..', file), 'utf8'), context);
  }
  await settle();
  assert.match(document.getElementById('extension-status').textContent, /Extension connected/);

  return {
    stored: () => stored,
    checkbox: (index) => document.getElementById('rules-body').children[index].children[0].children[0],
    global: document.getElementById('global-enabled'),
    async toggle(element, checked) {
      element.checked = checked;
      element.dispatchEvent(new Event('change'));
      await settle();
    },
    async responses() {
      const fetchBody = await (await window.fetch('http://localhost/api')).text();
      const xhr = new window.XMLHttpRequest();
      const xhrBody = await new Promise((resolve) => {
        xhr.addEventListener('loadend', () => resolve(xhr.responseText));
        xhr.open('GET', 'http://localhost/api');
        xhr.send();
      });
      return [fetchBody, xhrBody];
    },
  };
}

test('both switches are required for fetch and XMLHttpRequest interception', async () => {
  for (const enabled of [false, true]) {
    for (const ruleEnabled of [false, true]) {
      const panel = await setup({
        enabled, rules: [{ ...rule('first'), enabled: ruleEnabled }],
      });
      const expected = enabled && ruleEnabled ? 'first' : 'real';
      assert.deepEqual(await panel.responses(), [expected, expected]);
    }
  }
});

test('repeated On toggles update saved rules after extension replies replace state', async () => {
  const panel = await setup();
  const checkbox = panel.checkbox(0);
  for (const enabled of [false, true, false, true]) {
    await panel.toggle(checkbox, enabled);
    assert.equal(panel.stored().rules[0].enabled, enabled);
    assert.deepEqual(await panel.responses(), enabled ? ['first', 'first'] : ['real', 'real']);
  }
});

test('On toggles still work after changing the global switch', async () => {
  const panel = await setup();
  await panel.toggle(panel.global, false);
  await panel.toggle(panel.global, true);
  await panel.toggle(panel.checkbox(0), false);
  assert.equal(panel.stored().enabled, true);
  assert.equal(panel.stored().rules[0].enabled, false);
  assert.deepEqual(await panel.responses(), ['real', 'real']);
});

test('the first enabled matching rule wins after toggling different rows', async () => {
  const panel = await setup({ rules: [rule('first'), rule('second')] });
  assert.deepEqual(await panel.responses(), ['first', 'first']);
  await panel.toggle(panel.checkbox(0), false);
  assert.deepEqual(await panel.responses(), ['second', 'second']);
  await panel.toggle(panel.checkbox(1), false);
  assert.deepEqual(await panel.responses(), ['real', 'real']);
  await panel.toggle(panel.checkbox(0), true);
  assert.deepEqual(await panel.responses(), ['first', 'first']);
});
