E621X.define('tagScriptQueue', ['utils', 'net'], (U, Net) => {
  'use strict';
  const { STORAGE_KEYS: KEYS, ACTIONS } = E621_CONSTANTS;
  const HOURLY_EDIT_LIMIT = 150;
  const ONE_HOUR_MS = 60 * 60 * 1000;
  const CLOCK_BUFFER_MS = 3000;
  const LOCK_KEY = 'e621_queue_processing_lock';
  const LOCK_TIMEOUT_MS = 25000;

  let autoProcessTimer = null;

  async function isEnabled() {
    return Boolean(await U.storageGet(KEYS.QUEUE_TAG_SCRIPTS_ENABLED, false));
  }

  async function setEnabled(val) {
    await U.storageSet(KEYS.QUEUE_TAG_SCRIPTS_ENABLED, Boolean(val));
  }

  async function getTimeoutUntil() {
    return Number(await U.storageGet(KEYS.QUEUE_TIMEOUT_UNTIL, 0)) || 0;
  }

  async function setTimeoutUntil(timestamp) {
    await U.storageSet(KEYS.QUEUE_TIMEOUT_UNTIL, timestamp);
    const delay = timestamp - Date.now();
    if (delay > 0) {
      scheduleAutoProcess(delay);
    } else if (autoProcessTimer) {
      clearTimeout(autoProcessTimer);
      autoProcessTimer = null;
    }
  }

  async function getSlotSchedule() {
    return (await U.storageGet(KEYS.QUEUE_SLOT_TIMESTAMPS, [])) || [];
  }

  async function setSlotSchedule(slots) {
    await U.storageSet(KEYS.QUEUE_SLOT_TIMESTAMPS, slots);
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

  /* Merge tag diff tokens when queuing edits to an already queued post */
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

  /* Fetches image as Base64 via service worker (avoids CORS) */
  async function fetchImageAsBase64(url) {
    if (!url || typeof url !== 'string' || url.startsWith('data:')) return url || null;
    try {
      const res = await chrome.runtime.sendMessage({ action: ACTIONS.FETCH_IMAGE, url });
      if (res?.ok && res.dataUrl) return res.dataUrl;
    } catch (_) {
      // Swallowed safely
    }
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

  /* Extracts full post details and statistics directly from thumbnail element */
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
    const queue = await getQueue();
    const existing = queue[id];

    queue[id] = {
      id,
      changes: existing ? mergeDiffs(existing.changes, editData.changes) : editData.changes,
      reason: editData.reason || existing?.reason || '',
      queuedAt: existing?.queuedAt || Date.now(),
      previewUrl: editData.previewUrl || existing?.previewUrl || '',
      thumbnailDataUrl: editData.thumbnailDataUrl || existing?.thumbnailDataUrl || '',
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

    await U.storageSet(KEYS.TAG_SCRIPT_QUEUE, queue);
    return queue;
  }

  /* Queues a post extracting its statistics and Base64 thumbnail directly from DOM element */
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

  async function updatePostCache(postId, cacheData) {
    const id = Number(postId);
    const queue = await getQueue();
    if (!queue[id]) return;

    queue[id] = { ...queue[id], ...cacheData };
    await U.storageSet(KEYS.TAG_SCRIPT_QUEUE, queue);
  }

  async function dequeue(postId) {
    const id = Number(postId);
    const queue = await getQueue();
    if (queue[id]) {
      delete queue[id];
      await U.storageSet(KEYS.TAG_SCRIPT_QUEUE, queue);
      if (Object.keys(queue).length === 0) {
        await setSlotSchedule([]);
        await setTimeoutUntil(0);
      }
    }
    return queue;
  }

  async function clearQueue() {
    await U.storageSet(KEYS.TAG_SCRIPT_QUEUE, {});
    await setSlotSchedule([]);
    await setTimeoutUntil(0);
  }

  /* Checks GET /posts/{id}.json to verify if a post or any applied tags are locked */
  async function checkPostLockStatus(postId, changes = '') {
    // Fast path: inspect thumbnail in DOM first to avoid network request
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
          if (token.includes(':') && !token.startsWith('-') && !token.startsWith('+')) {
            continue;
          }
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

  /* Checks if status and server response body explicitly indicate edit rate limit */
  function isHourlyLimitResponse(status, errorText) {
    if (status === 429) return true;
    if (status === 403) {
      const msg = String(errorText || '').toLowerCase();
      // Only match specific rate limiting/throttling phrases to prevent permanent bans from triggering infinite loops
      return msg.includes('hourly limit') || msg.includes('limit exceeded') || msg.includes('throttl');
    }
    return false;
  }

  /* Parse error responses matching OpenAPI schemas */
  async function parseErrorBody(res) {
    try {
      const data = await res.json();
      if (data.reason) return data.reason;
      if (data.errors) {
        if (typeof data.errors === 'object') return Object.values(data.errors).flat().join('; ');
        if (Array.isArray(data.errors)) return data.errors.join('; ');
      }
      if (data.message) return data.message;
    } catch (_) {
      // Ignored: fallback to status code
    }
    return `HTTP ${res.status}`;
  }

  /* Verifies against /post_versions.json whether the 150 edits/hour rolling limit is truly reached */
  async function verifyHourlyLimitExceeded() {
    try {
      const user = U.getCurrentUser();
      if (!user?.userId) return { isLimit: false, nextAvailableMs: 0, slots: [] };

      const data = await Net.fetchJson(`/post_versions.json?search[updater_id]=${user.userId}&limit=${HOURLY_EDIT_LIMIT}`);
      const list = Array.isArray(data) ? data : (data?.post_versions || []);
      const now = Date.now();

      const recentTimestamps = [];
      for (const item of list) {
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

      const slots = [];
      for (const t of recentTimestamps) {
        slots.push(t + ONE_HOUR_MS + CLOCK_BUFFER_MS);
      }

      const queue = await getQueue();
      const queueLen = Math.max(Object.keys(queue).length, slots.length);
      while (slots.length < queueLen) {
        const baseIdx = Math.max(0, slots.length - HOURLY_EDIT_LIMIT);
        slots.push((slots[baseIdx] || now) + ONE_HOUR_MS);
      }

      const nextAvailableMs = Math.max(1000, slots[0] - now);
      await setSlotSchedule(slots);

      return { isLimit: true, nextAvailableMs, slots };
    } catch (err) {
      U.logWarn('verifyHourlyLimitExceeded', err);
      return { isLimit: false, nextAvailableMs: 0, slots: [] };
    }
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

  function scheduleAutoProcess(delayMs) {
    if (autoProcessTimer) clearTimeout(autoProcessTimer);
    if (delayMs <= 0 || delayMs > 24 * 60 * 60 * 1000) return;

    autoProcessTimer = setTimeout(async () => {
      autoProcessTimer = null;
      if (!(await isEnabled())) return;

      const until = await getTimeoutUntil();
      if (Date.now() >= until) {
        await setTimeoutUntil(0);
        const queue = await getQueue();
        if (Object.keys(queue).length > 0) {
          U.showToast('Slot available: processing next queued post...');
          await processQueue();
        }
      }
    }, delayMs + 1000);
  }

  async function acquireLock() {
    const lock = Number(await U.storageGet(LOCK_KEY, 0)) || 0;
    if (Date.now() - lock < LOCK_TIMEOUT_MS) return false;
    await U.storageSet(LOCK_KEY, Date.now());
    return true;
  }

  async function releaseLock() {
    await U.storageSet(LOCK_KEY, 0);
  }

  async function processQueue(onProgress = null) {
    if (!(await acquireLock())) {
      U.showToast('Queue is already being processed in another tab', true);
      return { inProgress: true };
    }

    const queue = await getQueue();
    const items = Object.values(queue);
    if (!items.length) {
      await releaseLock();
      U.showToast('Tag script queue is empty');
      return { total: 0, updated: 0, errors: 0 };
    }

    let updated = 0;
    let errors = 0;
    let hitLimit = false;
    let slots = await getSlotSchedule();

    try {
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        await U.storageSet(LOCK_KEY, Date.now());

        const scheduledTime = slots[0] || 0;
        const now = Date.now();

        if (scheduledTime > now) {
          const waitMs = scheduledTime - now;
          await setTimeoutUntil(scheduledTime);
          hitLimit = true;
          U.showToast(`Next slot opens in ${formatDuration(waitMs)}. Paused.`);
          break;
        }

        if (typeof onProgress === 'function') {
          onProgress({ index: i, total: items.length, current: item });
        }
        U.showToast(`Processing queue ${i + 1}/${items.length} (Post #${item.id})...`);

        try {
          const res = await Net.sendForm(`/posts/${item.id}.json`, 'PATCH', {
            'post[tag_string_diff]': item.changes,
            'post[edit_reason]': item.reason || ''
          });

          if (!res.ok) {
            const errorMsg = await parseErrorBody(res);

            if (isHourlyLimitResponse(res.status, errorMsg)) {
              const check = await verifyHourlyLimitExceeded();
              if (check.isLimit) {
                const delay = check.nextAvailableMs;
                await setTimeoutUntil(Date.now() + delay);
                hitLimit = true;
                U.showToast(`Hourly limit active. Next slot in ${formatDuration(delay)}.`, true);
                break;
              } else if (res.status === 429) {
                const delay = 60 * 1000;
                await setTimeoutUntil(Date.now() + delay);
                hitLimit = true;
                U.showToast('API rate limit reached (429). Pausing queue for 1m.', true);
                break;
              }
              // If 403 and NOT a limit, fall through to dequeue (do not loop forever!)
            }

            await dequeue(item.id);
            const isLockedMsg = /locked|is deleted|cannot be edited/i.test(errorMsg);
            let lockReason = isLockedMsg ? errorMsg : '';
            if (!isLockedMsg) {
              const lockCheck = await checkPostLockStatus(item.id, item.changes);
              if (lockCheck.isLocked) lockReason = lockCheck.reason;
            }

            const thumb = document.querySelector(`article.thumbnail[data-id="${item.id}"]`);
            if (thumb && lockReason) {
              thumb.classList.remove('e621x-thumb-queued', 'e621x-thumb-updated');
              thumb.classList.add('e621x-thumb-locked');
            }
            U.showToast(`Post #${item.id} skipped: ${lockReason || errorMsg}`, true);
            errors++;
            continue;
          }

          // Successfully updated
          await dequeue(item.id);
          const thumb = document.querySelector(`article.thumbnail[data-id="${item.id}"]`);
          if (thumb) {
            thumb.classList.remove('e621x-thumb-queued', 'e621x-thumb-locked');
            thumb.classList.add('e621x-thumb-updated');
          }
          if (slots.length > 0) {
            slots.shift();
            await setSlotSchedule(slots);
          }
          updated++;

        } catch (err) {
          errors++;
          U.logWarn(`queued post #${item.id}`, err);
        }
      }
    } finally {
      await releaseLock();
    }

    if (!hitLimit) {
      const remQueue = await getQueue();
      if (Object.keys(remQueue).length === 0) {
        await setSlotSchedule([]);
        await setTimeoutUntil(0);
      }
      U.showToast(`Queue finished: ${updated} updated${errors ? `, ${errors} errors` : ''}`);
    }

    return { total: items.length, updated, errors, hitLimit };
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

  async function init() {
    const until = await getTimeoutUntil();
    if (until > 0) {
      if (Date.now() >= until) {
        await setTimeoutUntil(0);
        const queue = await getQueue();
        if (Object.keys(queue).length > 0 && (await isEnabled())) {
          setTimeout(() => processQueue(), 2000);
        }
      } else {
        scheduleAutoProcess(until - Date.now());
      }
    }
  }

  return {
    init,
    isEnabled,
    setEnabled,
    getTimeoutUntil,
    setTimeoutUntil,
    isTimeoutActive,
    getRemainingTimeoutMs,
    getQueueTimingInfo,
    getSlotSchedule,
    checkPostLockStatus,
    verifyHourlyLimitExceeded,
    isHourlyLimitResponse,
    getQueue,
    enqueue,
    enqueueFromThumb,
    extractThumbData,
    fetchImageAsBase64,
    updatePostCache,
    dequeue,
    clearQueue,
    formatDuration,
    processQueue,
    parseErrorBody,
    HOURLY_EDIT_LIMIT
  };
});