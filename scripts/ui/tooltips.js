/* Tooltip suppressor: permanently disables native browser hover tooltips on thumbnails when enabled. */
E621X.define('tooltipsManager', ['utils', 'selectors'], (U, SEL) => {
  'use strict';
  const { STORAGE_KEYS: KEYS } = E621_CONSTANTS;

  let enabled = false;

  function suppressTitle(el) {
    if (!el) return;
    const targets = el.hasAttribute('title') ? [el] : [];
    targets.push(...el.querySelectorAll('[title]'));
    for (const t of targets) {
      const val = t.getAttribute('title');
      if (val) {
        t.setAttribute('data-stashed-title', val);
        t.removeAttribute('title');
      }
    }
  }

  function restoreTitle(el) {
    if (!el) return;
    const targets = el.hasAttribute('data-stashed-title') ? [el] : [];
    targets.push(...el.querySelectorAll('[data-stashed-title]'));
    for (const t of targets) {
      const val = t.getAttribute('data-stashed-title');
      if (val) {
        t.setAttribute('title', val);
        t.removeAttribute('data-stashed-title');
      }
    }
  }

  function setupListeners() {
    document.addEventListener('mouseover', (e) => {
      if (!enabled) return;
      const thumb = e.target.closest(SEL.thumbnail) || e.target.closest('.post-preview, div.post-thumbnail, .e621x-thumb, [data-id]');
      if (thumb) {
        suppressTitle(thumb);
      }
    }, true);
  }

  async function init() {
    enabled = Boolean(await U.storageGet(KEYS.HIDE_THUMB_TOOLTIPS, false));
    setupListeners();

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes[KEYS.HIDE_THUMB_TOOLTIPS]) {
        enabled = Boolean(changes[KEYS.HIDE_THUMB_TOOLTIPS].newValue);
        if (!enabled) {
          document.querySelectorAll('[data-stashed-title]').forEach(restoreTitle);
        }
      }
    });
  }

  return { init };
});