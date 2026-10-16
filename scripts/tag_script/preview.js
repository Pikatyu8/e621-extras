/* Rendered preview tooltip of active tag scripts on holding/toggling CTRL.
 * Smoothly follows cursor matching display refresh rate or custom FPS limit.
 * Automatically mirrors to opposite side when Hover Zoom is active to avoid collisions. */
E621X.define('tagScriptPreview', ['utils', 'selectors', 'net', 'dom', 'tagScriptStorage', 'tagScriptRunner'], (U, SEL, Net, D, Storage, Runner) => {
  'use strict';
  const { STORAGE_KEYS: KEYS } = E621_CONSTANTS;

  const TOOLTIP_ID = 'e621x-ts-preview';
  const VIEWPORT_MARGIN = 12;
  const CURSOR_OFFSET_X = 24;

  const clamp = (val, min, max) => Math.min(Math.max(val, min), max);

  const tagCategoryCache = new Map();
  const inFlightTags = new Set();

  let tooltipEl = null;
  let isCtrlDown = false;
  let isStickyCtrl = false;
  let targetFps = 0; // 0 = native monitor refresh rate via requestAnimationFrame
  let scheduled = false;
  let lastTime = 0;
  let lastClientX = 0;
  let lastClientY = 0;

  function isTagScriptMode() {
    const select = document.querySelector(SEL.modeSelect);
    return select?.value === 'tag-script-ext';
  }

  function collectPageTags() {
    document.querySelectorAll('#tag-list li[class*="tag-type-"]').forEach(li => {
      const match = li.className.match(/tag-type-(\d+)/);
      const tagLink = li.querySelector('a.search-tag, a');
      if (match && tagLink) {
        const cat = Number(match[1]);
        const name = tagLink.textContent.trim().toLowerCase().replace(/\s+/g, '_');
        if (name) tagCategoryCache.set(name, cat);
      }
    });
  }

  async function fetchMissingTags(tagNames) {
    const missing = tagNames.filter(t => !tagCategoryCache.has(t) && !inFlightTags.has(t));
    if (!missing.length) return;

    missing.forEach(t => inFlightTags.add(t));
    try {
      const url = `/tags.json?search[name]=${encodeURIComponent(missing.join(','))}&limit=100`;
      const data = await Net.fetchJson(url);
      const list = Array.isArray(data) ? data : (data?.tags || []);
      list.forEach(t => {
        if (t?.name && t.category !== undefined) {
          tagCategoryCache.set(String(t.name).toLowerCase(), Number(t.category));
        }
      });
      missing.forEach(t => {
        if (!tagCategoryCache.has(t)) tagCategoryCache.set(t, 0);
      });
      if (isCtrlDown && isTagScriptMode() && tooltipEl && !tooltipEl.classList.contains('is-hidden')) {
        renderPreview();
      }
    } catch (_) {
      missing.forEach(t => tagCategoryCache.set(t, 0));
    } finally {
      missing.forEach(t => inFlightTags.delete(t));
    }
  }

  function getActiveScripts() {
    if (Storage.isStickyMode()) {
      const slots = Storage.getActiveStickySlots();
      if (!slots.length) return [];
      return slots
        .slice()
        .sort((a, b) => a - b)
        .map(id => ({ id, text: Storage.getStoredScript(id).trim() }))
        .filter(s => Boolean(s.text));
    }
    const currentId = Storage.getCurrentScriptId();
    if (currentId === 10) return [];
    const field = Runner.getScriptField();
    const text = (field ? field.value : Storage.getStoredScript(currentId)).trim();
    return text ? [{ id: currentId, text }] : [];
  }

  function formatScriptLine(scriptText) {
    const tokens = String(scriptText || '').trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) return '';

    let line = '';
    let currentLineLen = 0;
    const missing = [];

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      let prefix = '';
      let rawTag = token;

      if (token.startsWith('-') || token.startsWith('+') || token.startsWith('~')) {
        prefix = token[0];
        rawTag = token.slice(1);
      }

      const cleanTag = rawTag.toLowerCase();
      let catClass = 'e621x-tag-type-general';

      if (token.startsWith('[') && token.endsWith(']')) {
        catClass = 'e621x-tag-type-command';
      } else if (rawTag.includes(':')) {
        catClass = 'e621x-tag-type-meta';
      } else if (tagCategoryCache.has(cleanTag)) {
        const cat = tagCategoryCache.get(cleanTag);
        catClass = `e621x-tag-type-${cat}`;
      } else {
        missing.push(cleanTag);
        catClass = 'e621x-tag-type-0';
      }

      const tokenHtml = `${prefix ? `<span class="e621x-tag-type-prefix">${prefix}</span>` : ''}<span class="${catClass}">${D.escapeHtml(rawTag)}</span>`;
      const tokenLen = token.length + (i > 0 ? 1 : 0);

      if (currentLineLen + tokenLen > 80 && currentLineLen > 0) {
        line += '<br>&nbsp;&nbsp;';
        currentLineLen = 2;
      } else if (i > 0) {
        line += ' ';
        currentLineLen += 1;
      }

      line += tokenHtml;
      currentLineLen += token.length;
    }

    if (missing.length > 0) {
      fetchMissingTags(missing);
    }

    return line;
  }

  function alignTooltip(clientX, clientY) {
    if (!tooltipEl || tooltipEl.classList.contains('is-hidden')) return;

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const rect = tooltipEl.getBoundingClientRect();
    const boxW = rect.width;
    const boxH = rect.height;
    if (!boxW || !boxH) return;

    const zoomContainer = document.getElementById('e621x-zoom-container');
    const isZoomActive = zoomContainer && !zoomContainer.classList.contains('is-hidden');

    const placeOnRight = isZoomActive ? (clientX >= vw / 2) : (clientX < vw / 2);

    let left;
    if (placeOnRight) {
      left = clientX + CURSOR_OFFSET_X;
      if (left + boxW > vw - VIEWPORT_MARGIN) left = vw - boxW - VIEWPORT_MARGIN;
    } else {
      left = clientX - boxW - CURSOR_OFFSET_X;
      if (left < VIEWPORT_MARGIN) left = VIEWPORT_MARGIN;
    }

    let top = clamp(clientY - (boxH / 2), VIEWPORT_MARGIN, vh - boxH - VIEWPORT_MARGIN);

    if (left <= clientX + 8 && left + boxW >= clientX - 8) {
      if (clientY < vh / 2) {
        top = clamp(clientY + CURSOR_OFFSET_X + 12, VIEWPORT_MARGIN, vh - boxH - VIEWPORT_MARGIN);
      } else {
        top = clamp(clientY - boxH - CURSOR_OFFSET_X - 12, VIEWPORT_MARGIN, vh - boxH - VIEWPORT_MARGIN);
      }
    }

    tooltipEl.style.left = `${Math.round(left)}px`;
    tooltipEl.style.top = `${Math.round(top)}px`;
  }

  function requestAlignTooltip() {
    if (scheduled) return;
    scheduled = true;

    const now = performance.now();
    const minInterval = targetFps > 0 ? (1000 / targetFps) : 0;
    const wait = Math.max(0, minInterval - (now - lastTime));

    const execute = () => {
      requestAnimationFrame(() => {
        scheduled = false;
        lastTime = performance.now();
        if (isCtrlDown && isTagScriptMode()) {
          alignTooltip(lastClientX, lastClientY);
        }
      });
    };

    if (wait > 0) {
      setTimeout(execute, wait);
    } else {
      execute();
    }
  }

  function renderPreview() {
    if (!isTagScriptMode()) {
      hideTooltip();
      return;
    }

    const scripts = getActiveScripts();
    if (!scripts.length) {
      hideTooltip();
      return;
    }

    if (lastClientX === 0 && lastClientY === 0) {
      // Coordinates not known yet (e.g. right after reload); wait for cursor movement
      return;
    }

    tooltipEl.replaceChildren();
    for (const script of scripts) {
      const row = document.createElement('div');
      row.className = 'e621x-ts-preview-line';
      row.innerHTML = `<span class="e621x-ts-preview-bullet">•</span>${formatScriptLine(script.text)}`;
      tooltipEl.appendChild(row);
    }

    tooltipEl.classList.remove('is-hidden');
    alignTooltip(lastClientX, lastClientY);
  }

  function showTooltip() {
    if (!tooltipEl || !isTagScriptMode()) return;
    renderPreview();
  }

  function hideTooltip() {
    if (!tooltipEl) return;
    tooltipEl.classList.add('is-hidden');
    tooltipEl.replaceChildren();
  }

  function syncPreview() {
    if (!isTagScriptMode()) {
      hideTooltip();
      return;
    }
    if (isCtrlDown || (tooltipEl && !tooltipEl.classList.contains('is-hidden'))) {
      const scripts = getActiveScripts();
      if (!scripts.length) {
        hideTooltip();
        return;
      }
      renderPreview();
    }
  }

  async function isFeatureEnabled() {
    return (await U.storageGet(KEYS.CTRL_PREVIEW_ENABLED, true)) !== false;
  }

  function setupEvents() {
    const handlePointerActivity = (e) => {
      lastClientX = e.clientX;
      lastClientY = e.clientY;

      if (!isCtrlDown || !isTagScriptMode() || !tooltipEl) return;

      if (tooltipEl.classList.contains('is-hidden')) {
        renderPreview();
        return;
      }

      requestAlignTooltip();
    };

    document.addEventListener('mousemove', handlePointerActivity, { passive: true });
    document.addEventListener('mouseover', (e) => {
      if (!isCtrlDown || !isTagScriptMode() || !tooltipEl || !tooltipEl.classList.contains('is-hidden')) return;
      lastClientX = e.clientX;
      lastClientY = e.clientY;
      renderPreview();
    }, { passive: true });

    document.addEventListener('click', (e) => {
      if (!isStickyCtrl && !e.ctrlKey && isCtrlDown) {
        isCtrlDown = false;
        hideTooltip();
      }
    });

    window.addEventListener('e621x-zoom-change', () => {
      if (isCtrlDown && isTagScriptMode()) {
        alignTooltip(lastClientX, lastClientY);
      }
    });

    window.addEventListener('keydown', async (e) => {
      if (e.key === 'Escape') {
        // Sticky Ctrl preview MUST NOT be dismissed or deactivated by Escape
        if (isStickyCtrl) return;

        if (isCtrlDown || (tooltipEl && !tooltipEl.classList.contains('is-hidden'))) {
          isCtrlDown = false;
          hideTooltip();
          if (document.activeElement?.tagName === 'SELECT') {
            document.activeElement.blur();
          }
        }
        return;
      }

      if (['TEXTAREA', 'INPUT'].includes(document.activeElement?.tagName)) return;

      if (e.key !== 'Control' || e.repeat) return;
      if (!isTagScriptMode()) return;
      if (!(await isFeatureEnabled())) return;

      if (isStickyCtrl) {
        isCtrlDown = !isCtrlDown;
        await U.storageSet(KEYS.CTRL_STICKY_ACTIVE, isCtrlDown);
        if (isCtrlDown) {
          showTooltip();
        } else {
          hideTooltip();
        }
      } else {
        if (!isCtrlDown) {
          isCtrlDown = true;
          showTooltip();
        }
      }
    });

    window.addEventListener('keyup', (e) => {
      if (e.key !== 'Control') return;
      if (isStickyCtrl) return;

      isCtrlDown = false;
      hideTooltip();
    });

    window.addEventListener('blur', () => {
      if (isStickyCtrl) return;
      isCtrlDown = false;
      hideTooltip();
    });

    window.addEventListener('focus', () => {
      if (isStickyCtrl && isCtrlDown && isTagScriptMode()) {
        alignTooltip(lastClientX, lastClientY);
      }
    });
  }

  async function init() {
    if (document.getElementById(TOOLTIP_ID)) return;

    tooltipEl = document.createElement('div');
    tooltipEl.id = TOOLTIP_ID;
    tooltipEl.className = 'e621x-ts-preview is-hidden';
    document.body.appendChild(tooltipEl);

    const isEnabled = (await U.storageGet(KEYS.CTRL_PREVIEW_ENABLED, true)) !== false;
    isStickyCtrl = Boolean(await U.storageGet(KEYS.CTRL_PREVIEW_STICKY, false));
    if (isEnabled && isStickyCtrl) {
      isCtrlDown = Boolean(await U.storageGet(KEYS.CTRL_STICKY_ACTIVE, false));
    } else {
      isCtrlDown = false;
    }
    targetFps = Number(await U.storageGet(KEYS.TRACKING_FPS, 0)) || 0;

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local') {
        if (changes[KEYS.CTRL_PREVIEW_STICKY] !== undefined) {
          isStickyCtrl = Boolean(changes[KEYS.CTRL_PREVIEW_STICKY].newValue);
          if (!isStickyCtrl && isCtrlDown) {
            isCtrlDown = false;
            hideTooltip();
            U.storageSet(KEYS.CTRL_STICKY_ACTIVE, false);
          }
        }
        if (changes[KEYS.CTRL_PREVIEW_ENABLED] !== undefined && !changes[KEYS.CTRL_PREVIEW_ENABLED].newValue) {
          isCtrlDown = false;
          hideTooltip();
          U.storageSet(KEYS.CTRL_STICKY_ACTIVE, false);
        }
        if (changes[KEYS.CTRL_STICKY_ACTIVE] !== undefined && isStickyCtrl) {
          const nextActive = Boolean(changes[KEYS.CTRL_STICKY_ACTIVE].newValue);
          if (isCtrlDown !== nextActive) {
            isCtrlDown = nextActive;
            if (isCtrlDown) {
              syncPreview();
            } else {
              hideTooltip();
            }
          }
        }
        if (changes[KEYS.TRACKING_FPS] !== undefined) {
          targetFps = Number(changes[KEYS.TRACKING_FPS].newValue) || 0;
        }
      }
    });

    collectPageTags();
    setupEvents();
  }

  return { init, renderPreview, syncPreview, hideTooltip };
});