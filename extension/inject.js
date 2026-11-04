// Runs in the page's own JavaScript world (MAIN) at document_start on every site.
// Patches window.fetch and XMLHttpRequest so that requests matching an enabled rule
// get the mocked response / error code instead of hitting the network.
(() => {
  'use strict';
  if (window.__requestInterceptInstalled) return;
  Object.defineProperty(window, '__requestInterceptInstalled', { value: true });

  const RULES_EVENT = 'request-intercept:rules';
  const REQUEST_EVENT = 'request-intercept:request-rules';
  const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);
  const STATUS_TEXT = {
    200: 'OK', 201: 'Created', 202: 'Accepted', 204: 'No Content',
    301: 'Moved Permanently', 302: 'Found', 304: 'Not Modified',
    400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found',
    405: 'Method Not Allowed', 408: 'Request Timeout', 409: 'Conflict', 410: 'Gone',
    413: 'Payload Too Large', 415: 'Unsupported Media Type', 422: 'Unprocessable Entity',
    429: 'Too Many Requests', 500: 'Internal Server Error', 501: 'Not Implemented',
    502: 'Bad Gateway', 503: 'Service Unavailable', 504: 'Gateway Timeout',
  };

  let state = { enabled: false, rules: [] };
  let isReady = false;
  let resolveReady;
  const ready = new Promise((resolve) => { resolveReady = resolve; });
  const markReady = () => {
    if (!isReady) {
      isReady = true;
      resolveReady();
    }
  };
  // Never block the page for long if the extension's rules are unavailable.
  setTimeout(markReady, 1000);

  document.addEventListener(RULES_EVENT, (event) => {
    try {
      const data = JSON.parse(event.detail);
      state = { enabled: data.enabled !== false, rules: Array.isArray(data.rules) ? data.rules : [] };
    } catch (_) { /* ignore malformed payloads */ }
    markReady();
  });
  document.dispatchEvent(new CustomEvent(REQUEST_EVENT));

  const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  function resolveUrl(url) {
    try { return new URL(String(url), location.href).href; } catch (_) { return String(url); }
  }

  function ruleMatches(rule, url, method) {
    if (!rule || !rule.enabled || !rule.urlPattern) return false;
    if (rule.method && rule.method !== 'ANY' && rule.method !== method) return false;
    const pattern = String(rule.urlPattern);
    switch (rule.matchType) {
      case 'exact':
        return url === pattern || url === resolveUrl(pattern);
      case 'wildcard':
        return new RegExp('^' + pattern.split('*').map(escapeRegex).join('.*') + '$').test(url);
      case 'regex':
        try { return new RegExp(pattern).test(url); } catch (_) { return false; }
      default:
        return url.includes(pattern);
    }
  }

  function findRule(url, method) {
    if (!state.enabled) return null;
    return state.rules.find((rule) => ruleMatches(rule, url, method)) || null;
  }

  function responseParts(rule) {
    const status = rule.mode === 'error' ? Number(rule.status) || 500 : 200;
    const headers = { 'X-Request-Intercept': String(rule.id || 'mocked') };
    if (rule.contentType) headers['Content-Type'] = rule.contentType;
    return {
      status,
      statusText: STATUS_TEXT[status] || '',
      headers,
      body: NULL_BODY_STATUSES.has(status) ? null : String(rule.body == null ? '' : rule.body),
    };
  }

  function log(rule, method, url) {
    const result = rule.mode === 'network' ? 'network failure' : responseParts(rule).status;
    console.info(`[request-intercept] ${method} ${url} → ${result}` + (rule.name ? ` (rule: ${rule.name})` : ''));
  }

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // ---------- fetch ----------
  const nativeFetch = window.fetch;
  if (typeof nativeFetch === 'function') {
    window.fetch = async function fetch(input, init) {
      if (!isReady) await ready;
      const request = typeof Request !== 'undefined' && input instanceof Request ? input : null;
      const url = resolveUrl(request ? request.url : input);
      const method = String((init && init.method) || (request && request.method) || 'GET').toUpperCase();
      const rule = findRule(url, method);
      if (!rule) return nativeFetch.call(this, input, init);

      log(rule, method, url);
      if (rule.delayMs > 0) await wait(rule.delayMs);
      const signal = (init && init.signal) || (request && request.signal);
      if (signal && signal.aborted) throw new DOMException('The user aborted a request.', 'AbortError');
      if (rule.mode === 'network') throw new TypeError('Failed to fetch');

      const { status, statusText, headers, body } = responseParts(rule);
      const response = new Response(body, { status, statusText, headers });
      Object.defineProperty(response, 'url', { value: url });
      return response;
    };
  }

  // ---------- XMLHttpRequest ----------
  const XHR = window.XMLHttpRequest && window.XMLHttpRequest.prototype;
  if (XHR) {
    const nativeOpen = XHR.open;
    const nativeSend = XHR.send;
    const requests = new WeakMap();
    const OVERRIDDEN = ['readyState', 'status', 'statusText', 'response', 'responseText', 'responseXML',
      'responseURL', 'getResponseHeader', 'getAllResponseHeaders'];

    XHR.open = function open(method, url, async) {
      OVERRIDDEN.forEach((key) => { delete this[key]; });
      requests.set(this, {
        method: String(method).toUpperCase(),
        url: resolveUrl(url),
        async: arguments.length < 3 || !!async,
      });
      return nativeOpen.apply(this, arguments);
    };

    const fire = (xhr, type, progress) => {
      xhr.dispatchEvent(progress ? new ProgressEvent(type, progress) : new Event(type));
    };

    function convertBody(body, responseType, contentType) {
      const text = body == null ? '' : body;
      switch (responseType) {
        case 'json':
          try { return JSON.parse(text); } catch (_) { return null; }
        case 'arraybuffer':
          return new TextEncoder().encode(text).buffer;
        case 'blob':
          return new Blob([text], { type: contentType || '' });
        case 'document':
          return new DOMParser().parseFromString(text, /xml/i.test(contentType || '') ? 'application/xml' : 'text/html');
        default:
          return text;
      }
    }

    function define(xhr, props) {
      Object.keys(props).forEach((key) => {
        Object.defineProperty(xhr, key, { value: props[key], configurable: true, writable: true });
      });
    }

    function respond(xhr, rule, info) {
      if (rule.mode === 'network') {
        define(xhr, { readyState: 4, status: 0, statusText: '', response: '', responseURL: '' });
        fire(xhr, 'readystatechange');
        fire(xhr, 'error', { loaded: 0, total: 0 });
        fire(xhr, 'loadend', { loaded: 0, total: 0 });
        return;
      }
      const { status, statusText, headers, body } = responseParts(rule);
      const responseType = xhr.responseType || '';
      const response = convertBody(body, responseType, headers['Content-Type']);
      const headerLines = Object.keys(headers).map((k) => `${k.toLowerCase()}: ${headers[k]}`).join('\r\n');
      const props = {
        readyState: 4,
        status,
        statusText,
        response,
        responseURL: info.url,
        getResponseHeader(name) {
          const key = Object.keys(headers).find((k) => k.toLowerCase() === String(name).toLowerCase());
          return key ? headers[key] : null;
        },
        getAllResponseHeaders() { return headerLines ? headerLines + '\r\n' : ''; },
      };
      if (responseType === '' || responseType === 'text') props.responseText = response;
      if (responseType === 'document') props.responseXML = response;
      define(xhr, props);
      const size = (body || '').length;
      fire(xhr, 'readystatechange');
      fire(xhr, 'load', { lengthComputable: true, loaded: size, total: size });
      fire(xhr, 'loadend', { lengthComputable: true, loaded: size, total: size });
    }

    XHR.send = function send() {
      const xhr = this;
      const args = arguments;
      const info = requests.get(xhr);
      if (!info) return nativeSend.apply(xhr, args);

      const proceed = () => {
        const rule = findRule(info.url, info.method);
        if (!rule) return nativeSend.apply(xhr, args);
        log(rule, info.method, info.url);
        if (!info.async) return respond(xhr, rule, info);
        setTimeout(() => respond(xhr, rule, info), Math.max(0, Number(rule.delayMs) || 0));
        return undefined;
      };

      if (isReady || !info.async) return proceed();
      ready.then(proceed);
      return undefined;
    };
  }
})();
