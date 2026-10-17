/* Service worker: manages tag script queue, IndexedDB image storage,
 * and background tag script execution without requiring open tabs. */
importScripts('scripts/constants.js');

const { ACTIONS, STORAGE_KEYS: KEYS } = E621_CONSTANTS;
const ALLOWED_HOST = /^(?:[a-z0-9-]+\.)*e(?:621|926)\.net$/i;
const BASE64_CHUNK = 0x8000;
const HOURLY_EDIT_LIMIT = 150;
const ONE_HOUR_MS = 60 * 60 * 1000;
const CLOCK_BUFFER_MS = 3000;

// ---------- IndexedDB image store ----------
const DB_NAME = 'e621_extras_db';
const DB_VERSION = 1;
const STORE_NAME = 'post_images';

function openDatabase() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'postId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbSaveImage(postId, dataUrl) {
  if (!dataUrl) return;
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put({ postId: Number(postId), dataUrl, savedAt: Date.now() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbGetImage(postId) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(Number(postId));
    req.onsuccess = () => resolve(req.result?.dataUrl || null);
    req.onerror = () => reject(req.error);
  });
}

async function idbDeleteImage(postId) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(Number(postId));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbClearImages() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ---------- Image fetch helpers ----------
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

async function fetchHeaderBytes(rawUrl, maxBytes = 524288) {
  const url = new URL(rawUrl);
  if (url.protocol !== 'https:' || !ALLOWED_HOST.test(url.hostname)) {
    throw new Error('Host not allowed');
  }
  // Request only the first 512KB since metadata chunks are located before IDAT / SOS
  let res = await fetch(url.href, {
    headers: { 'Range': `bytes=0-${maxBytes - 1}` }
  });
  if (!res.ok && res.status !== 206) {
    res = await fetch(url.href);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  return toBase64(bytes);
}

// ---------- Queue synchronization mutex ----------
let queueTail = Promise.resolve();
function runQueueOp(task) {
  const next = queueTail.then(task);
  queueTail = next.catch(err => console.warn('[background] queueOp error:', err));
  return next;
}

// ---------- CSRF token management ----------
async function getCsrfToken(forceFresh = false) {
  if (!forceFresh && chrome.storage?.session) {
    try {
      const data = await chrome.storage.session.get('csrfToken');
      if (data?.csrfToken) return data.csrfToken;
    } catch (err) {
      console.warn('[background] Failed to read csrfToken from storage.session:', err);
    }
  }

  try {
    // Lightweight fallback: root page HTML is significantly smaller than /posts
    const res = await fetch('https://e621.net/', { credentials: 'include' });
    if (!res.ok) return null;
    const html = await res.text();
    const match = html.match(/<meta\s+name=["']csrf-token["']\s+content=["']([^"']+)["']/i);
    if (match?.[1]) {
      const token = match[1];
      if (chrome.storage?.session) {
        await chrome.storage.session.set({ csrfToken: token }).catch(() => {});
      }
      return token;
    }
  } catch (err) {
    console.warn('[background] Failed to fetch CSRF token:', err);
  }
  return null;
}

// ---------- Broadcast post status to tabs ----------
async function broadcastPostStatus(postId, status, error = '') {
  try {
    const tabs = await chrome.tabs.query({ url: ['https://e621.net/*', 'https://e926.net/*'] });
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, {
        action: ACTIONS.TAG_SCRIPT_POST_STATUS,
        postId: Number(postId),
        status,
        error
      }).catch(() => {});
    }
  } catch (err) {
    console.warn('[background] broadcastPostStatus error:', err);
  }
}

// ---------- Queue state operations ----------
function mergeDiffs(oldDiff = '', newDiff = '') {
  const tokenMap = new Map();
  const parse = (str) => String(str || '').split(/\s+/).filter(Boolean);

  parse(oldDiff).forEach(token => {
    const key = token.startsWith('-') ? token.slice(1).toLowerCase() : token.toLowerCase();
    tokenMap.set(key, token);
  });

  parse(newDiff).forEach(token => {
    const key = token.startsWith('-') ? token.slice(1).toLowerCase() : token.toLowerCase();
    tokenMap.set(key, token);
  });

  return Array.from(tokenMap.values()).join(' ');
}

async function enqueuePost(postId, editData) {
  const id = Number(postId);
  const data = await chrome.storage.local.get([KEYS.TAG_SCRIPT_QUEUE]);
  const queue = data[KEYS.TAG_SCRIPT_QUEUE] || {};
  const existing = queue[id];

  queue[id] = {
    id,
    changes: existing ? mergeDiffs(existing.changes, editData.changes) : editData.changes,
    reason: editData.reason || existing?.reason || '',
    queuedAt: existing?.queuedAt || Date.now(),
    previewUrl: editData.previewUrl || existing?.previewUrl || '',
    score: editData.score !== undefined ? editData.score : (existing?.score ?? 0),
    favCount: editData.favCount !== undefined ? editData.favCount : (existing?.favCount ?? 0),
    commentCount: editData.commentCount !== undefined ? editData.commentCount : (existing?.commentCount ?? 0),
    rating: editData.rating || existing?.rating || 's',
    fileExt: editData.fileExt || existing?.fileExt || 'jpg',
    tags: editData.tags !== undefined ? editData.tags : (existing?.tags || ''),
    flags: editData.flags !== undefined ? editData.flags : (existing?.flags || ''),
    hasParent: editData.hasParent !== undefined ? editData.hasParent : (existing?.hasParent ?? false),
    hasChildren: editData.hasChildren !== undefined ? editData.hasChildren : (existing?.hasChildren ?? false)
  };

  await chrome.storage.local.set({ [KEYS.TAG_SCRIPT_QUEUE]: queue });
  return queue;
}

async function dequeuePost(postId) {
  const id = Number(postId);
  const data = await chrome.storage.local.get([KEYS.TAG_SCRIPT_QUEUE]);
  const queue = data[KEYS.TAG_SCRIPT_QUEUE] || {};
  if (queue[id]) {
    delete queue[id];
    await chrome.storage.local.set({ [KEYS.TAG_SCRIPT_QUEUE]: queue });
    await idbDeleteImage(id);
    if (Object.keys(queue).length === 0) {
      await chrome.storage.local.set({
        [KEYS.QUEUE_SLOT_TIMESTAMPS]: [],
        [KEYS.QUEUE_TIMEOUT_UNTIL]: 0
      });
    }
  }
  return queue;
}

async function clearTagQueue() {
  await chrome.storage.local.set({
    [KEYS.TAG_SCRIPT_QUEUE]: {},
    [KEYS.QUEUE_SLOT_TIMESTAMPS]: [],
    [KEYS.QUEUE_TIMEOUT_UNTIL]: 0
  });
  await idbClearImages();
}

// ---------- Background Queue Processor ----------
function isHourlyLimitResponse(status, errorText) {
  if (status === 429) return true;
  if (status === 403) {
    const msg = String(errorText || '').toLowerCase();
    return msg.includes('hourly limit') || msg.includes('limit exceeded') || msg.includes('throttl');
  }
  return false;
}

async function verifyHourlyLimitExceeded() {
  try {
    const meRes = await fetch('https://e621.net/users/me.json', { credentials: 'include' });
    if (!meRes.ok) return { isLimit: false, nextAvailableMs: 0, slots: [] };
    const me = await meRes.json();
    if (!me?.id) return { isLimit: false, nextAvailableMs: 0, slots: [] };

    const url = `https://e621.net/post_versions.json?search[updater_id]=${me.id}&limit=${HOURLY_EDIT_LIMIT}`;
    const vRes = await fetch(url, { credentials: 'include' });
    if (!vRes.ok) return { isLimit: false, nextAvailableMs: 0, slots: [] };
    const list = await vRes.json();
    const versions = Array.isArray(list) ? list : (list?.post_versions || []);
    const now = Date.now();

    const recentTimestamps = [];
    for (const item of versions) {
      const dateStr = item?.updated_at || item?.created_at;
      if (!dateStr) continue;
      const t = new Date(dateStr).getTime();
      if (!Number.isNaN(t) && (now - t) < ONE_HOUR_MS) {
        recentTimestamps.push(t);
      }
    }

    if (recentTimestamps.length < HOURLY_EDIT_LIMIT) {
      return { isLimit: false, nextAvailableMs: 0, slots: [] };
    }

    recentTimestamps.sort((a, b) => a - b);
    const slots = recentTimestamps.map(t => t + ONE_HOUR_MS + CLOCK_BUFFER_MS);

    const data = await chrome.storage.local.get([KEYS.TAG_SCRIPT_QUEUE]);
    const queue = data[KEYS.TAG_SCRIPT_QUEUE] || {};
    const queueLen = Math.max(Object.keys(queue).length, slots.length);
    while (slots.length < queueLen) {
      const baseIdx = Math.max(0, slots.length - HOURLY_EDIT_LIMIT);
      slots.push((slots[baseIdx] || now) + ONE_HOUR_MS);
    }

    const nextAvailableMs = Math.max(1000, slots[0] - now);
    await chrome.storage.local.set({ [KEYS.QUEUE_SLOT_TIMESTAMPS]: slots });
    return { isLimit: true, nextAvailableMs, slots };
  } catch (err) {
    console.warn('[background] verifyHourlyLimitExceeded error:', err);
    return { isLimit: false, nextAvailableMs: 0, slots: [] };
  }
}

async function processQueueInBackground() {
  const data = await chrome.storage.local.get([
    KEYS.QUEUE_TAG_SCRIPTS_ENABLED,
    KEYS.TAG_SCRIPT_QUEUE,
    KEYS.QUEUE_TIMEOUT_UNTIL,
    KEYS.QUEUE_SLOT_TIMESTAMPS
  ]);

  if (!data[KEYS.QUEUE_TAG_SCRIPTS_ENABLED]) {
    return { total: 0, updated: 0, errors: 0, disabled: true };
  }

  const queue = data[KEYS.TAG_SCRIPT_QUEUE] || {};
  const items = Object.values(queue);
  if (!items.length) {
    await chrome.storage.local.set({
      [KEYS.QUEUE_SLOT_TIMESTAMPS]: [],
      [KEYS.QUEUE_TIMEOUT_UNTIL]: 0
    });
    return { total: 0, updated: 0, errors: 0 };
  }

  const now = Date.now();
  let slots = data[KEYS.QUEUE_SLOT_TIMESTAMPS] || [];
  const scheduledTime = slots[0] || Number(data[KEYS.QUEUE_TIMEOUT_UNTIL]) || 0;

  if (scheduledTime > now) {
    chrome.alarms.create('tagQueueCheck', { when: scheduledTime + 500 });
    return { total: items.length, updated: 0, errors: 0, hitLimit: true };
  }

  let csrf = await getCsrfToken();
  let updated = 0;
  let errors = 0;
  let hitLimit = false;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const currentSlots = (await chrome.storage.local.get([KEYS.QUEUE_SLOT_TIMESTAMPS]))[KEYS.QUEUE_SLOT_TIMESTAMPS] || [];
    const nextSlot = currentSlots[0] || 0;

    if (nextSlot > Date.now()) {
      hitLimit = true;
      await chrome.storage.local.set({ [KEYS.QUEUE_TIMEOUT_UNTIL]: nextSlot });
      chrome.alarms.create('tagQueueCheck', { when: nextSlot + 500 });
      break;
    }

    try {
      let res = await fetch(`https://e621.net/posts/${item.id}.json`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'X-CSRF-Token': csrf || ''
        },
        body: new URLSearchParams({
          'post[tag_string_diff]': item.changes,
          'post[edit_reason]': item.reason || ''
        }).toString(),
        credentials: 'include'
      });

      if (res.status === 403) {
        csrf = await getCsrfToken(true);
        res = await fetch(`https://e621.net/posts/${item.id}.json`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'X-CSRF-Token': csrf || ''
          },
          body: new URLSearchParams({
            'post[tag_string_diff]': item.changes,
            'post[edit_reason]': item.reason || ''
          }).toString(),
          credentials: 'include'
        });
      }

      if (!res.ok) {
        let errorText = '';
        try {
          const jsonErr = await res.json();
          errorText = jsonErr.reason || jsonErr.message || JSON.stringify(jsonErr);
        } catch (_) {
          errorText = await res.text().catch(() => '');
        }

        if (isHourlyLimitResponse(res.status, errorText)) {
          const check = await verifyHourlyLimitExceeded();
          const delay = check.isLimit ? check.nextAvailableMs : (res.status === 429 ? 60000 : 30000);
          const resumeAt = Date.now() + delay;
          await chrome.storage.local.set({ [KEYS.QUEUE_TIMEOUT_UNTIL]: resumeAt });
          chrome.alarms.create('tagQueueCheck', { when: resumeAt + 500 });
          hitLimit = true;
          break;
        }

        // Post cannot be edited or tag is locked — dequeue to avoid blocking the queue
        await dequeuePost(item.id);
        await broadcastPostStatus(item.id, 'locked', errorText);
        errors++;
        continue;
      }

      // Success: dequeue and notify tabs to turn yellow outline into green
      await dequeuePost(item.id);
      await broadcastPostStatus(item.id, 'updated');
      const remainingSlots = (await chrome.storage.local.get([KEYS.QUEUE_SLOT_TIMESTAMPS]))[KEYS.QUEUE_SLOT_TIMESTAMPS] || [];
      if (remainingSlots.length > 0) {
        remainingSlots.shift();
        await chrome.storage.local.set({ [KEYS.QUEUE_SLOT_TIMESTAMPS]: remainingSlots });
      }
      updated++;
    } catch (err) {
      console.warn(`[background] Error processing queued post #${item.id}:`, err);
      errors++;
    }
  }

  if (!hitLimit) {
    const rem = (await chrome.storage.local.get([KEYS.TAG_SCRIPT_QUEUE]))[KEYS.TAG_SCRIPT_QUEUE] || {};
    if (Object.keys(rem).length === 0) {
      await chrome.storage.local.set({
        [KEYS.QUEUE_SLOT_TIMESTAMPS]: [],
        [KEYS.QUEUE_TIMEOUT_UNTIL]: 0
      });
    }
  }

  return { total: items.length, updated, errors, hitLimit };
}

// ---------- Message Router ----------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;

  switch (msg?.action) {
    case ACTIONS.FETCH_IMAGE:
      fetchImageAsDataUrl(msg.url)
        .then(dataUrl => sendResponse({ ok: true, dataUrl }))
        .catch(err => sendResponse({ ok: false, error: err.message }));
      return true;

    case ACTIONS.CHECK_AI_HEURISTICS:
      fetchHeaderBytes(msg.url)
        .then(base64Data => sendResponse({ ok: true, base64Data }))
        .catch(err => sendResponse({ ok: false, error: err.message }));
      return true;

    case ACTIONS.SAVE_IMAGE:
      idbSaveImage(msg.postId, msg.dataUrl)
        .then(() => sendResponse({ ok: true }))
        .catch(err => sendResponse({ ok: false, error: err.message }));
      return true;

    case ACTIONS.GET_IMAGE:
      idbGetImage(msg.postId)
        .then(dataUrl => sendResponse({ ok: true, dataUrl }))
        .catch(err => sendResponse({ ok: false, error: err.message }));
      return true;

    case ACTIONS.DELETE_IMAGE:
      idbDeleteImage(msg.postId)
        .then(() => sendResponse({ ok: true }))
        .catch(err => sendResponse({ ok: false, error: err.message }));
      return true;

    case ACTIONS.CLEAR_IMAGES:
      idbClearImages()
        .then(() => sendResponse({ ok: true }))
        .catch(err => sendResponse({ ok: false, error: err.message }));
      return true;

    case ACTIONS.ENQUEUE_TAG_SCRIPT:
      runQueueOp(() => enqueuePost(msg.postId, msg.editData))
        .then(queue => sendResponse({ ok: true, queue }))
        .catch(err => sendResponse({ ok: false, error: err.message }));
      return true;

    case ACTIONS.DEQUEUE_TAG_SCRIPT:
      runQueueOp(() => dequeuePost(msg.postId))
        .then(queue => sendResponse({ ok: true, queue }))
        .catch(err => sendResponse({ ok: false, error: err.message }));
      return true;

    case ACTIONS.CLEAR_TAG_QUEUE:
      runQueueOp(() => clearTagQueue())
        .then(() => sendResponse({ ok: true }))
        .catch(err => sendResponse({ ok: false, error: err.message }));
      return true;

    case ACTIONS.PROCESS_TAG_QUEUE:
      runQueueOp(() => processQueueInBackground())
        .then(res => sendResponse({ ok: true, ...res }))
        .catch(err => sendResponse({ ok: false, error: err.message }));
      return true;

    case ACTIONS.SET_CSRF_TOKEN:
      if (msg.csrfToken && chrome.storage?.session) {
        chrome.storage.session.set({ csrfToken: msg.csrfToken })
          .then(() => sendResponse({ ok: true }))
          .catch((err) => {
            console.warn('[background] Failed to save csrfToken to storage.session:', err);
            sendResponse({ ok: false, error: err.message });
          });
        return true;
      }
      sendResponse({ ok: true });
      return false;

    default:
      return false;
  }
});

// Periodic alarm: triggers background processing even when all e621 tabs are closed
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'tagQueueCheck') {
    await runQueueOp(() => processQueueInBackground());
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