# request-intercept

A single-page control panel (hosted on GitHub Pages) for mocking API responses while you test
another website in the same browser. For any HTTPS API request you can:

- **Modify the response** – return `200 OK` with a body you write (or load the real response and edit it).
- **Return an error code** – e.g. `404`, `401`, `500`, `503` with an optional body.
- **Simulate a network failure** – the request fails as if the server were unreachable.

Control panel: <https://jessicablank.github.io/request-intercept/>

## How it works

Browsers do not allow one website to change the network traffic of another website, so the
GitHub Pages panel works with a small companion browser extension (Chrome/Edge 111+):

| Piece | What it does |
| --- | --- |
| `docs/` | The control panel served by GitHub Pages. You create, edit, enable/disable and test rules here. |
| `extension/bridge.js` | Runs only on the control panel and saves your rules into the extension's storage. |
| `extension/relay.js` + `extension/inject.js` | Run on every site. They patch `fetch` and `XMLHttpRequest`, and any request matching an enabled rule gets your mocked response instead of going to the network. |
| `extension/background.js` | Shows the number of active rules on the toolbar icon; clicking the icon opens the panel. |

## Setup

1. **Enable GitHub Pages:** in the repository go to *Settings → Pages* and set *Source* to
   **GitHub Actions**. The `Deploy to GitHub Pages` workflow publishes `docs/` plus a zipped copy
   of the extension on every push to `main`.
2. **Install the extension:** download `request-intercept-extension.zip` from the panel (or use the
   `extension/` folder from this repo), unzip it, open `chrome://extensions`, turn on
   **Developer mode**, click **Load unpacked** and select the folder.
3. Open the panel. The banner turns green when the extension is connected.

## Usage

1. Enter the API URL (e.g. `https://api.example.com/v1/users`) and choose how to match it:
   *URL contains*, *Exact URL*, *Wildcard* (`*`) or *Regular expression*. Optionally limit it to one HTTP method.
2. Choose **200 OK – modified response body**, **Error status code** or **Network failure**,
   fill in the body/status and click **Add rule**.
3. Open (or reload) the site you are testing in the same browser. Matching requests receive your
   response. Each intercepted request is logged in that site's DevTools console as
   `[request-intercept] GET https://… → 404`, and mocked responses carry an `X-Request-Intercept` header.
4. Use **Test a request** on the panel to check what a URL currently returns, and the
   **Interception enabled** switch to turn everything off without deleting rules.
   A rule applies only when both **Interception enabled** and its **On** checkbox are checked.
   The first enabled rule matching the request wins.

## Limitations

- Only requests made by page scripts with `fetch` or `XMLHttpRequest` are intercepted – not page
  navigations, `<img>`/`<script>` loads, WebSockets or requests made from service workers.
- Rules are applied when a page loads; reload the site under test after changing rules.
- The rules are visible to the JavaScript of the sites you visit while the extension is enabled.
  Disable or remove the extension when you are not testing.
- If you fork this repository, update the control panel URL in `extension/manifest.json`
  (`bridge.js` match) and `extension/background.js`.

## Local development

```sh
cd docs && python3 -m http.server 8000
```

Then open <http://localhost:8000/> (the extension's bridge also runs on `localhost` / `127.0.0.1`).

Run the regression tests with Node.js:

```sh
node --test
```
