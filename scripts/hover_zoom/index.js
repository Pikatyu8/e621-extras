E621X.define('hoverZoom', ['utils', 'selectors', 'dom', 'hoverZoomData'], (U, SEL, D, HZData) => {
  'use strict';
  const { STORAGE_KEYS: KEYS } = E621_CONSTANTS;
  const { clamp, parsePostFromElement, PLACEHOLDER_IMG } = HZData;

  const VIEWPORT_MARGIN = 12;
  const CURSOR_OFFSET_X = 24;

  let enabled = true;
  let loadSample = true; // default true: load /data/sample/*
  let targetFps = 0; // 0 = native monitor refresh rate via requestAnimationFrame
  let dom = null;
  let activePost = null;
  let shiftPressed = false;
  let lastClientX = 0;
  let lastClientY = 0;
  let scheduled = false;
  let lastTime = 0;
  let stashedTitles = [];

  // ---------- Exact Dimension Calculation ----------
  function updateMediaDimensions(mediaEl) {
    if (!activePost || !dom) return;

    const naturalW = mediaEl.naturalWidth || mediaEl.videoWidth || 0;
    const naturalH = mediaEl.naturalHeight || mediaEl.videoHeight || 0;
    if (!naturalW || !naturalH) return;

    const maxW = Math.floor(window.innerWidth * 0.55);
    const maxH = Math.floor(window.innerHeight * 0.88);

    let w = naturalW;
    let h = naturalH;

    // Scale down to fit inside max bounds while preserving exact aspect ratio
    if (w > maxW) {
      h = Math.round(h * (maxW / w));
      w = maxW;
    }
    if (h > maxH) {
      w = Math.round(w * (maxH / h));
      h = maxH;
    }

    mediaEl.style.width = `${w}px`;
    mediaEl.style.height = `${h}px`;
    dom.container.style.width = `${w}px`;
    dom.container.style.height = `${h}px`;

    dom.container.classList.remove('is-hidden');
    alignWindow(lastClientX, lastClientY);

    window.dispatchEvent(new CustomEvent('e621x-zoom-change', { detail: { active: true } }));
  }

  // ---------- DOM Setup ----------
  function createZoomContainer() {
    if (document.getElementById('e621x-zoom-container')) return;

    const container = D.el('div', {
      id: 'e621x-zoom-container',
      class: 'e621x-zoom is-hidden'
    });

    const img = D.el('img', {
      id: 'e621x-zoom-img',
      class: 'e621x-zoom-media is-hidden',
      src: PLACEHOLDER_IMG,
      alt: ''
    });

    const video = D.el('video', {
      id: 'e621x-zoom-video',
      class: 'e621x-zoom-media is-hidden',
      loop: true,
      playsinline: true,
      controls: false,
      autoplay: true,
      muted: true
    });

    img.addEventListener('load', () => {
      if (img.src !== PLACEHOLDER_IMG) updateMediaDimensions(img);
    });

    // Fallback: if sample 404s, seamlessly load full fileUrl
    img.addEventListener('error', () => {
      if (img.src && !img.src.startsWith('data:') && activePost?.fileUrl && img.src !== activePost.fileUrl) {
        img.src = activePost.fileUrl;
      }
    });

    video.addEventListener('loadedmetadata', () => {
      updateMediaDimensions(video);
    });

    video.addEventListener('error', () => {
      if (video.src && activePost?.fileUrl && video.src !== activePost.fileUrl) {
        video.src = activePost.fileUrl;
        video.play().catch(() => {});
      }
    });

    container.append(img, video);
    document.body.appendChild(container);

    dom = { container, img, video };
  }

  // ---------- Tooltip Suppressor ----------
  function suppressTooltips(element) {
    restoreTooltips();
    if (!element) return;

    const targets = element.hasAttribute('title') ? [element] : [];
    targets.push(...element.querySelectorAll('[title]'));

    for (const el of targets) {
      const title = el.getAttribute('title');
      if (title) {
        stashedTitles.push({ el, title });
        el.removeAttribute('title');
      }
    }
  }

  function restoreTooltips() {
    while (stashedTitles.length) {
      const { el, title } = stashedTitles.pop();
      try { el.setAttribute('title', title); } catch (_) {
        // Ignored
      }
    }
  }

  // ---------- Positioning ----------
  function alignWindow(clientX, clientY) {
    if (!dom || dom.container.classList.contains('is-hidden')) return;

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const rect = dom.container.getBoundingClientRect();
    const boxW = rect.width;
    const boxH = rect.height;
    if (!boxW || !boxH) return;

    let left;
    if (clientX < vw / 2) {
      left = clientX + CURSOR_OFFSET_X;
      if (left + boxW > vw - VIEWPORT_MARGIN) left = vw - boxW - VIEWPORT_MARGIN;
    } else {
      left = clientX - boxW - CURSOR_OFFSET_X;
      if (left < VIEWPORT_MARGIN) left = VIEWPORT_MARGIN;
    }

    const top = clamp(clientY - (boxH / 2), VIEWPORT_MARGIN, vh - boxH - VIEWPORT_MARGIN);

    dom.container.style.left = `${Math.round(left)}px`;
    dom.container.style.top = `${Math.round(top)}px`;
  }

  function requestAlignWindow() {
    if (scheduled) return;
    scheduled = true;

    const now = performance.now();
    const minInterval = targetFps > 0 ? (1000 / targetFps) : 0;
    const wait = Math.max(0, minInterval - (now - lastTime));

    const execute = () => {
      requestAnimationFrame(() => {
        scheduled = false;
        lastTime = performance.now();
        alignWindow(lastClientX, lastClientY);
      });
    };

    if (wait > 0) {
      setTimeout(execute, wait);
    } else {
      execute();
    }
  }

  // ---------- Zoom Lifecycle ----------
  function stopZoom() {
    activePost = null;
    restoreTooltips();

    if (!dom) return;
    const wasVisible = !dom.container.classList.contains('is-hidden');
    dom.container.classList.add('is-hidden');
    dom.container.style.width = '';
    dom.container.style.height = '';

    dom.img.classList.add('is-hidden');
    dom.img.style.width = '';
    dom.img.style.height = '';
    dom.img.src = PLACEHOLDER_IMG;

    dom.video.classList.add('is-hidden');
    dom.video.style.width = '';
    dom.video.style.height = '';
    dom.video.pause();
    dom.video.removeAttribute('src');
    dom.video.load();

    if (wasVisible) {
      window.dispatchEvent(new CustomEvent('e621x-zoom-change', { detail: { active: false } }));
    }
  }

  function startZoom(post) {
    if (!enabled || !shiftPressed || !post || post.ext === 'swf' || post.isDeleted) return;

    activePost = post;
    suppressTooltips(post.element);

    const targetMediaUrl = loadSample
      ? (post.sampleUrl || post.fileUrl)
      : (post.fileUrl || post.sampleUrl);

    if (post.isVideo) {
      dom.img.classList.add('is-hidden');
      dom.video.classList.remove('is-hidden');
      dom.video.src = targetMediaUrl;
      dom.video.play().catch(() => {});
    } else {
      dom.video.classList.add('is-hidden');
      dom.img.classList.remove('is-hidden');

      const targetUrl = targetMediaUrl || post.previewUrl;
      dom.img.src = targetUrl;

      if (dom.img.complete && dom.img.naturalWidth > 0) {
        updateMediaDimensions(dom.img);
      }
    }
  }

  // ---------- Event Listeners ----------
  function setupEvents() {
    document.addEventListener('mousemove', (e) => {
      lastClientX = e.clientX;
      lastClientY = e.clientY;

      requestAlignWindow();
    }, { passive: true });

    document.addEventListener('mouseover', (e) => {
      if (!enabled || !shiftPressed) return;
      const thumb = e.target.closest(SEL.thumbnail) || e.target.closest('.post-preview, div.post-thumbnail');
      if (!thumb) return;

      const post = parsePostFromElement(thumb);
      if (post && activePost?.id !== post.id) {
        startZoom(post);
      }
    });

    document.addEventListener('mouseout', (e) => {
      if (!activePost) return;
      const thumb = e.target.closest(SEL.thumbnail) || e.target.closest('.post-preview, div.post-thumbnail');
      if (!thumb) return;

      const related = e.relatedTarget ? e.relatedTarget.closest(SEL.thumbnail) || e.relatedTarget.closest('.post-preview') : null;
      if (related === thumb) return;

      stopZoom();
    });

    window.addEventListener('keydown', (e) => {
      if (e.key !== 'Shift' || shiftPressed) return;
      shiftPressed = true;

      if (enabled && !activePost) {
        const hovered = document.elementFromPoint(lastClientX, lastClientY);
        const post = parsePostFromElement(hovered);
        if (post) startZoom(post);
      }
    });

    window.addEventListener('keyup', (e) => {
      if (e.key !== 'Shift') return;
      shiftPressed = false;
      stopZoom();
    });

    window.addEventListener('blur', () => {
      shiftPressed = false;
      stopZoom();
    });

    window.addEventListener('scroll', () => {
      if (activePost) stopZoom();
    }, { passive: true });
  }

  async function init() {
    createZoomContainer();
    const data = await chrome.storage.local.get([KEYS.HZ_ENABLED, KEYS.HZ_LOAD_SAMPLE, KEYS.TRACKING_FPS]);
    enabled = data[KEYS.HZ_ENABLED] !== false;
    loadSample = data[KEYS.HZ_LOAD_SAMPLE] !== false;
    targetFps = Number(data[KEYS.TRACKING_FPS]) || 0;
    setupEvents();

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local') {
        if (changes[KEYS.HZ_ENABLED]) {
          enabled = changes[KEYS.HZ_ENABLED].newValue !== false;
          if (!enabled) stopZoom();
        }
        if (changes[KEYS.HZ_LOAD_SAMPLE]) {
          loadSample = changes[KEYS.HZ_LOAD_SAMPLE].newValue !== false;
        }
        if (changes[KEYS.TRACKING_FPS] !== undefined) {
          targetFps = Number(changes[KEYS.TRACKING_FPS].newValue) || 0;
        }
      }
    });
  }

  return { init };
});