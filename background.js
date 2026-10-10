/* Service worker: fetches images for SVG export, checks tag queue timeouts,
 * and automatically processes queues when the hourly limit expires. */
importScripts('scripts/constants.js');

const { ACTIONS, STORAGE_KEYS: KEYS } = E621_CONSTANTS;
const ALLOWED_HOST = /^(?:[a-z0-9-]+\.)*e(?:621|926)\.net$/i;
const BASE64_CHUNK = 0x8000;

function toBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += BASE64_CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + BASE64_CHUNK));
  }
  return btoa(binary);
}

async function fetchImageAsDataUrl(rawUrl) {
  const url = new URL(rawUrl);
  if (url.protocol !== 'https:' || !ALLOWED_HOST.test(url.hostname)) {
    throw new Error('Host not allowed');
  }
  const res = await fetch(url.href);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const type = res.headers.get('content-type') || '';
  if (!type.startsWith('image/')) throw new Error('Not an image');
  const bytes = new Uint8Array(await res.arrayBuffer());
  return `data:${type};base64,${toBase64(bytes)}`;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  if (msg?.action === ACTIONS.FETCH_IMAGE) {
    fetchImageAsDataUrl(msg.url)
      .then(dataUrl => sendResponse({ ok: true, dataUrl }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }
  return false;
});

// Periodic alarm: resets expired timeouts and triggers auto-queue processing on open tabs
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'tagQueueCheck') {
    const data = await chrome.storage.local.get([
      KEYS.QUEUE_TAG_SCRIPTS_ENABLED,
      KEYS.QUEUE_TIMEOUT_UNTIL,
      KEYS.TAG_SCRIPT_QUEUE
    ]);

    if (!data[KEYS.QUEUE_TAG_SCRIPTS_ENABLED]) return;

    const until = Number(data[KEYS.QUEUE_TIMEOUT_UNTIL]) || 0;
    const isExpired = until > 0 && Date.now() >= until;

    if (isExpired) {
      await chrome.storage.local.set({ [KEYS.QUEUE_TIMEOUT_UNTIL]: 0 });
    }

    const queue = data[KEYS.TAG_SCRIPT_QUEUE] || {};
    const hasItems = Object.keys(queue).length > 0;
    const isReady = until === 0 || Date.now() >= until;

    if (hasItems && isReady) {
      const tabs = await chrome.tabs.query({ url: ['https://e621.net/*', 'https://e926.net/*'] });
      for (const tab of tabs) {
        try {
          const res = await chrome.tabs.sendMessage(tab.id, { action: ACTIONS.PROCESS_TAG_QUEUE });
          if (res?.ok) break;
        } catch (_) {
          // Tab may not have finished loading or was closed
        }
      }
    }
  }
});

function ensureAlarm() {
  chrome.alarms.get('tagQueueCheck', (alarm) => {
    if (!alarm) {
      chrome.alarms.create('tagQueueCheck', { periodInMinutes: 1 });
    }
  });
}

chrome.runtime.onInstalled.addListener(ensureAlarm);
chrome.runtime.onStartup.addListener(ensureAlarm);
ensureAlarm();