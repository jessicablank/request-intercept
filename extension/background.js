// Shows the number of active rules on the toolbar icon and opens the control panel when clicked.
const CONTROL_PANEL_URL = 'https://jessicablank.github.io/request-intercept/';

async function updateBadge() {
  const { enabled = true, rules = [] } = await chrome.storage.local.get(['enabled', 'rules']);
  const active = enabled ? rules.filter((rule) => rule && rule.enabled).length : 0;
  await chrome.action.setBadgeBackgroundColor({ color: '#d93025' });
  await chrome.action.setBadgeText({ text: active ? String(active) : '' });
}

chrome.runtime.onInstalled.addListener(updateBadge);
chrome.runtime.onStartup.addListener(updateBadge);
chrome.storage.onChanged.addListener((_changes, area) => {
  if (area === 'local') updateBadge();
});

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: CONTROL_PANEL_URL });
});
