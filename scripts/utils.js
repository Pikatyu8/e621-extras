E621X.define('utils', ['selectors'], (SEL) => {
  'use strict';
  const { STORAGE_KEYS, SCHEMA_VERSION } = E621_CONSTANTS;
  const TOAST_ID = 'e621-extras-toast';

  const logWarn = (scope, err) => {
    if (err && /Extension context invalidated/i.test(err.message || String(err))) return;
    console.warn(`[e621 extras] ${scope}:`, err);
  };
  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  const extensionAlive = () => {
    try {
      return Boolean(globalThis.chrome?.runtime?.id);
    } catch (_) {
      return false;
    }
  };

  // ---------- results ----------
  const ok = (message, extra = {}) => ({ ok: true, message, ...extra });
  const fail = (message, code = 'ERROR') => ({ ok: false, message, code });

  // ---------- storage ----------
  /* The extension context is invalidated after an update/reload; then storage calls must not throw. */
  const storageGet = (key, fallback) => new Promise(resolve => {
    if (!extensionAlive()) return resolve(fallback);
    try {
      chrome.storage.local.get([key], result => {
        if (chrome.runtime.lastError) {
          logWarn('storage.get', chrome.runtime.lastError.message);
          return resolve(fallback);
        }
        resolve(result && result[key] !== undefined ? result[key] : fallback);
      });
    } catch (err) {
      logWarn('storage.get', err);
      resolve(fallback);
    }
  });

  const storageSet = (key, value) => new Promise(resolve => {
    if (!extensionAlive()) return resolve();
    try {
      chrome.storage.local.set({ [key]: value }, () => {
        if (chrome.runtime.lastError) logWarn('storage.set', chrome.runtime.lastError.message);
        resolve();
      });
    } catch (err) {
      logWarn('storage.set', err);
      resolve();
    }
  });

  /* Idempotent migration. Uses the raw API on purpose: on a read failure we must NOT write fallbacks back. */
  async function ensureStorageSchema() {
    try {
      const K = STORAGE_KEYS;
      const data = await chrome.storage.local.get([K.SCHEMA_VERSION, K.DOWNVOTES]);
      if ((data[K.SCHEMA_VERSION] || 0) >= SCHEMA_VERSION) return;
      // v1: downvotes are stored as a de-duplicated array of numbers
      const ids = Array.isArray(data[K.DOWNVOTES]) ? data[K.DOWNVOTES] : [];
      await chrome.storage.local.set({
        [K.DOWNVOTES]: [...new Set(ids.map(Number).filter(Number.isFinite))],
        [K.SCHEMA_VERSION]: SCHEMA_VERSION
      });
    } catch (err) {
      logWarn('schema migration', err);
    }
  }

  const TOAST_CONTAINER_ID = 'e621x-toast-container';

  function showToast(message, isError = false) {
    let container = document.getElementById(TOAST_CONTAINER_ID);
    if (!container) {
      container = document.createElement('div');
      container.id = TOAST_CONTAINER_ID;
      container.className = 'e621x-toast-container';
      document.body.appendChild(container);
    }

    const MAX_TOASTS = 5;
    while (container.children.length >= MAX_TOASTS) {
      container.firstElementChild.remove();
    }

    const toast = document.createElement('div');
    toast.className = `e621x-toast${isError ? ' e621x-toast--error' : ''}`;
    toast.textContent = message;
    container.appendChild(toast);

    const duration = isError ? 5000 : 3500;
    setTimeout(() => {
      toast.classList.add('is-hiding');
      setTimeout(() => {
        toast.remove();
        if (container.children.length === 0) {
          container.remove();
        }
      }, 300);
    }, duration);
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ---------- site data ----------
  function getCurrentUser() {
    let userId = document.body?.dataset?.userId;
    let userName = document.body?.dataset?.userName;
    const isAnonymous = document.body?.dataset?.userIsAnonymous === 'true';

    if (!userId || !userName || isAnonymous) {
      const siteUserElem = document.querySelector(SEL.siteUser);
      if (siteUserElem) {
        try {
          const data = JSON.parse(atob(siteUserElem.textContent.trim()));
          if (data && data.name && !data.is?.anonymous) {
            userId = String(data.id);
            userName = data.name;
          }
        } catch (err) {
          logWarn('parse #site-user', err);
        }
      }
    }
    if (!userId || !userName || isAnonymous) return null;
    return { userId, userName };
  }

  const getCsrfToken = () => document.querySelector(SEL.csrfMeta)?.content || '';
  const siteUrl = (path) => new URL(path, location.origin).href;

  function getPostIdFromPage(el = null) {
    if (el) {
      const container = el.closest(SEL.postContainerForId);
      if (container) {
        const id = container.dataset.id || container.dataset.postId;
        if (id && /^\d+$/.test(id)) return Number(id);
      }
    }
    const meta = document.querySelector(SEL.postIdMeta);
    if (meta?.content && /^\d+$/.test(meta.content)) return Number(meta.content);
    const imgContainer = document.querySelector(SEL.imageContainer);
    if (imgContainer?.dataset.id) return Number(imgContainer.dataset.id);
    const match = location.pathname.match(/\/posts\/(\d+)/);
    return match ? Number(match[1]) : null;
  }

  /* API posts expose tags either as `tag_string`, string `tags`, array, or category object. */
  function getPostTagString(post) {
    if (!post) return '';
    if (typeof post.tag_string === 'string') return post.tag_string;
    if (typeof post.tags === 'string') return post.tags;
    if (Array.isArray(post.tags)) return post.tags.join(' ');
    if (post.tags && typeof post.tags === 'object') return Object.values(post.tags).flat().join(' ');
    return '';
  }

  // ---------- concurrency ----------
  /* Runs tasks strictly one after another; a failed task does not block the next ones. */
  function createQueue() {
    let tail = Promise.resolve();
    return {
      run(task) {
        const result = tail.then(task);
        tail = result.catch(() => {});
        return result;
      }
    };
  }

  async function mapLimit(items, limit, fn) {
    const results = new Array(items.length);
    let next = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await fn(items[i], i);
      }
    });
    await Promise.all(workers);
    return results;
  }

  /* Collects cleanup callbacks; run() executes them once, in reverse order. */
  function createDisposer() {
    const fns = [];
    let done = false;
    return {
      add(fn) { if (done) fn(); else fns.push(fn); },
      isDisposed: () => done,
      run() {
        if (done) return;
        done = true;
        while (fns.length) {
          try { fns.pop()(); } catch (err) { logWarn('disposer', err); }
        }
      }
    };
  }

  return {
    logWarn, sleep, ok, fail,
    storageGet, storageSet, ensureStorageSchema,
    showToast, downloadBlob,
    getCurrentUser, getCsrfToken, siteUrl, getPostIdFromPage, getPostTagString,
    createQueue, mapLimit, createDisposer
  };
});
