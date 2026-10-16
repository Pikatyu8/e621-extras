/* Tag script queue client: delegates mutations and processing to background.js
 * and uses IndexedDB for image storage to avoid storage quota issues. */
E621X.define('tagScriptQueue', ['utils', 'net'], (U, Net) => {
  'use strict';
  const { STORAGE_KEYS: KEYS, ACTIONS } = E621_CONSTANTS;
  const HOURLY_EDIT_LIMIT = 150;
  const ONE_HOUR_MS = 60 * 60 * 1000;

  async function isEnabled() {
    return Boolean(await U.storageGet(KEYS.QUEUE_TAG_SCRIPTS_ENABLED, false));
  }

  async function setEnabled(val) {
    await U.storageSet(KEYS.QUEUE_TAG_SCRIPTS_ENABLED, Boolean(val));
  }

  async function getTimeoutUntil() {
    return Number(await U.storageGet(KEYS.QUEUE_TIMEOUT_UNTIL, 0)) || 0;
  }

  async function isTimeoutActive() {
    if (!(await isEnabled())) return false;
    const until = await getTimeoutUntil();
    return Date.now() < until;
  }

  async function getRemainingTimeoutMs() {
    const until = await getTimeoutUntil();
    return Math.max(0, until - Date.now());
  }

  async function getQueue() {
    return (await U.storageGet(KEYS.TAG_SCRIPT_QUEUE, {})) || {};
  }

  async function getQueueCount() {
    const q = await getQueue();
    return Object.keys(q).length;
  }

  async function getSlotSchedule() {
    return (await U.storageGet(KEYS.QUEUE_SLOT_TIMESTAMPS, [])) || [];
  }

  // ---------- IndexedDB image operations via background ----------
  async function saveImage(postId, dataUrl) {
    if (!dataUrl) return;
    try {
      await chrome.runtime.sendMessage({ action: ACTIONS.SAVE_IMAGE, postId, dataUrl });
    } catch (err) {
      U.logWarn('saveImage to IndexedDB', err);
    }
  }

  async function getImage(postId) {
    try {
      const res = await chrome.runtime.sendMessage({ action: ACTIONS.GET_IMAGE, postId });
      return res?.dataUrl || null;
    } catch (err) {
      U.logWarn('getImage from IndexedDB', err);
      return null;
    }
  }

  async function deleteImage(postId) {
    try {
      await chrome.runtime.sendMessage({ action: ACTIONS.DELETE_IMAGE, postId });
    } catch (err) {
      U.logWarn('deleteImage from IndexedDB', err);
    }
  }

  async function clearImages() {
    try {
      await chrome.runtime.sendMessage({ action: ACTIONS.CLEAR_IMAGES });
    } catch (err) {
      U.logWarn('clearImages from IndexedDB', err);
    }
  }

  /* Fetches image as Base64 via service worker (avoids CORS) */
  async function fetchImageAsBase64(url) {
    if (!url || typeof url !== 'string' || url.startsWith('data:')) return url || null;
    try {
      const res = await chrome.runtime.sendMessage({ action: ACTIONS.FETCH_IMAGE, url });
      if (res?.ok && res.dataUrl) return res.dataUrl;
    } catch (_) {}
    return null;
  }

  /* Fast extraction of Base64 from loaded DOM img tag, falls back to fetch */
  async function getBase64FromThumb(thumb, previewUrl) {
    const img = thumb?.querySelector?.('img');
    if (img && img.complete && img.naturalWidth > 0) {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        if (dataUrl && dataUrl.startsWith('data:image/')) return dataUrl;
      } catch (_) {
        // Canvas tainted by CORS, fallback to background service worker
      }
    }

    const targetUrl = previewUrl || thumb?.dataset?.previewUrl || img?.src;
    if (targetUrl) {
      const b64 = await fetchImageAsBase64(targetUrl);
      if (b64) return b64;
    }
    return null;
  }

  function extractThumbData(thumb) {
    if (!thumb) return {};
    const d = thumb.dataset || {};
    const img = thumb.querySelector('img');
    const previewUrl = d.previewUrl || img?.src || '';

    return {
      previewUrl,
      score: Number(d.score || 0),
      favCount: Number(d.favCount || 0),
      commentCount: Number(d.commentCount || 0),
      rating: String(d.rating || 's').toLowerCase(),
      fileExt: String(d.fileExt || 'jpg').toLowerCase(),
      tags: d.tags || '',
      flags: d.flags || '',
      hasParent: thumb.querySelector('.ribbon.left') !== null || d.hasParent === 'true',
      hasChildren: thumb.querySelector('.ribbon.right') !== null || d.hasChildren === 'true'
    };
  }

  async function enqueue(postId, editData) {
    const id = Number(postId);
    const thumbnailDataUrl = editData.thumbnailDataUrl;
    if (thumbnailDataUrl) {
      await saveImage(id, thumbnailDataUrl);
    }

    const sanitized = { ...editData };
    delete sanitized.thumbnailDataUrl;

    const res = await chrome.runtime.sendMessage({
      action: ACTIONS.ENQUEUE_TAG_SCRIPT,
      postId: id,
      editData: sanitized
    });

    return res?.queue || (await getQueue());
  }

  async function enqueueFromThumb(thumb, editData) {
    const postId = Number(thumb.dataset.id);
    const meta = extractThumbData(thumb);
    const b64 = await getBase64FromThumb(thumb, meta.previewUrl);

    return enqueue(postId, {
      ...meta,
      ...editData,
      thumbnailDataUrl: b64 || meta.previewUrl
    });
  }

  async function dequeue(postId) {
    const id = Number(postId);
    await deleteImage(id);
    const res = await chrome.runtime.sendMessage({
      action: ACTIONS.DEQUEUE_TAG_SCRIPT,
      postId: id
    });
    return res?.queue || (await getQueue());
  }

  async function clearQueue() {
    await clearImages();
    await chrome.runtime.sendMessage({ action: ACTIONS.CLEAR_TAG_QUEUE });
  }

  async function processQueue() {
    try {
      const res = await chrome.runtime.sendMessage({ action: ACTIONS.PROCESS_TAG_QUEUE });
      if (res?.ok) {
        return res;
      }
      return { total: 0, updated: 0, errors: 1, error: res?.error };
    } catch (err) {
      U.logWarn('processQueue request failed', err);
      return { total: 0, updated: 0, errors: 1, error: err.message };
    }
  }

  async function checkPostLockStatus(postId, changes = '') {
    const thumb = document.querySelector(`article.thumbnail[data-id="${postId}"]`);
    if (thumb) {
      const flags = (thumb.dataset.flags || '').split(/\s+/);
      if (flags.includes('deleted') || thumb.classList.contains('post-status-deleted')) {
        return { isLocked: true, reason: 'Post is deleted' };
      }
      if (flags.includes('status_locked') || flags.includes('statuslocked')) {
        return { isLocked: true, reason: 'Post is status locked' };
      }
      if (flags.includes('rating_locked') && /(?:^|\s)[-+]?rating:[sqe]/i.test(changes)) {
        return { isLocked: true, reason: `Rating is locked on post #${postId}` };
      }
    }

    try {
      const data = await Net.fetchJson(`/posts/${postId}.json`);
      const post = data?.post || data;
      if (!post) return { isLocked: false, reason: '' };

      const flags = post.flags || {};
      if (flags.status_locked || post.is_status_locked) {
        return { isLocked: true, reason: 'Post is status locked' };
      }
      if (flags.deleted || post.is_deleted) {
        return { isLocked: true, reason: 'Post is deleted' };
      }

      let lockedTags = [];
      if (Array.isArray(post.locked_tags)) {
        lockedTags = post.locked_tags;
      } else if (typeof post.locked_tags === 'string') {
        lockedTags = post.locked_tags.split(/\s+/).filter(Boolean);
      }

      if (lockedTags.length > 0 && changes) {
        const lockedSet = new Set(lockedTags.map(t => String(t).trim().toLowerCase()));
        const tokens = String(changes).split(/\s+/).filter(Boolean);
        for (const token of tokens) {
          if (token.includes(':') && !token.startsWith('-') && !token.startsWith('+')) continue;
          const cleanTag = token.replace(/^[-+]/, '').toLowerCase();
          if (lockedSet.has(cleanTag)) {
            return { isLocked: true, reason: `Tag "${cleanTag}" is locked on post #${postId}` };
          }
        }
      }

      if ((flags.rating_locked || post.is_rating_locked) && /(?:^|\s)[-+]?rating:[sqe]/i.test(changes)) {
        return { isLocked: true, reason: `Rating is locked on post #${postId}` };
      }

      return { isLocked: false, reason: '' };
    } catch (err) {
      U.logWarn(`checkPostLockStatus #${postId}`, err);
      return { isLocked: false, reason: '' };
    }
  }

  function isHourlyLimitResponse(status, errorText) {
    if (status === 429) return true;
    if (status === 403) {
      const msg = String(errorText || '').toLowerCase();
      return msg.includes('hourly limit') || msg.includes('limit exceeded') || msg.includes('throttl');
    }
    return false;
  }

  async function parseErrorBody(res) {
    try {
      const data = await res.json();
      if (data.reason) return data.reason;
      if (data.errors) {
        if (typeof data.errors === 'object') return Object.values(data.errors).flat().join('; ');
        if (Array.isArray(data.errors)) return data.errors.join('; ');
      }
      if (data.message) return data.message;
    } catch (_) {}
    return `HTTP ${res.status}`;
  }

  function formatDuration(ms) {
    const totalSec = Math.ceil(ms / 1000);
    const hours = Math.floor(totalSec / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = totalSec % 60;
    if (hours > 0) return `${hours}h ${mins}m`;
    if (mins > 0) return `${mins}m ${secs}s`;
    return `${secs}s`;
  }

  async function getQueueTimingInfo() {
    const queue = await getQueue();
    const count = Object.keys(queue).length;
    if (count === 0) {
      return { count: 0, nextMs: 0, allMs: 0, isTimeout: false, nextSlot: 0, allSlot: 0 };
    }

    let slots = await getSlotSchedule();
    const now = Date.now();

    if (!slots.length) {
      const until = await getTimeoutUntil();
      const nextMs = Math.max(0, until - now);
      return { count, nextMs, allMs: nextMs, isTimeout: nextMs > 0, nextSlot: until, allSlot: until };
    }

    while (slots.length < count) {
      const baseIdx = Math.max(0, slots.length - HOURLY_EDIT_LIMIT);
      slots.push((slots[baseIdx] || now) + ONE_HOUR_MS);
    }

    const nextSlot = slots[0] || now;
    const nextMs = Math.max(0, nextSlot - now);
    const allSlotIdx = Math.min(count - 1, slots.length - 1);
    const allSlot = slots[allSlotIdx] || nextSlot;
    const allMs = Math.max(0, allSlot - now);

    return { count, nextMs, allMs, isTimeout: nextMs > 0, nextSlot, allSlot };
  }

  async function init() {}

  return {
    init,
    isEnabled,
    setEnabled,
    getTimeoutUntil,
    isTimeoutActive,
    getRemainingTimeoutMs,
    getQueueTimingInfo,
    getSlotSchedule,
    checkPostLockStatus,
    isHourlyLimitResponse,
    getQueue,
    getQueueCount,
    enqueue,
    enqueueFromThumb,
    extractThumbData,
    fetchImageAsBase64,
    dequeue,
    clearQueue,
    formatDuration,
    processQueue,
    parseErrorBody,
    saveImage,
    getImage,
    deleteImage,
    clearImages,
    HOURLY_EDIT_LIMIT
  };
});