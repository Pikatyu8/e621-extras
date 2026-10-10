document.addEventListener('DOMContentLoaded', async () => {
  const { STORAGE_KEYS: KEYS, ACTIONS } = E621_CONSTANTS;
  const $ = (id) => document.getElementById(id);

  const mainView = $('mainView');
  const offlineView = $('offlineView');
  const statusMsg = $('statusMessage');
  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabs = {
    main: $('tab-main'),
    blck: $('tab-blck'),
    tagscr: $('tab-tagscr'),
    hz: $('tab-hz')
  };

  const autoUpdateState = $('autoUpdateState');
  const btnSyncApi = $('btnSyncApi');
  const manualActions = $('manualActions');
  const btnBackup = $('btnBackup');
  const showUploaderBadge = $('showUploaderBadge');
  const inputTreePostId = $('inputTreePostId');

  const setStatus = (text) => { statusMsg.textContent = text; };
  const setButtonsDisabled = (disabled) =>
    document.querySelectorAll('.btn').forEach(b => { b.disabled = disabled; });

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const isE621 = tab?.url && /^https:\/\/(e621|e926)\.net\//.test(tab.url);

  if (!isE621) {
    mainView.classList.add('hidden');
    offlineView.classList.remove('hidden');
    return;
  }

  function showTab(name) {
    tabBtns.forEach(b => b.classList.toggle('active', b.dataset.tab === name));
    Object.entries(tabs).forEach(([key, node]) => node.classList.toggle('hidden', key !== name));
  }

  tabBtns.forEach(btn => btn.addEventListener('click', () => {
    showTab(btn.dataset.tab);
    chrome.storage.local.set({ [KEYS.ACTIVE_POPUP_TAB]: btn.dataset.tab });
  }));

  const postMatch = tab.url.match(/\/posts\/(\d+)/);
  if (postMatch) inputTreePostId.value = postMatch[1];

  const btnHzToggle = $('btnHzToggle');
  const hzBadge = $('hzBadge');
  const btnHzSampleToggle = $('btnHzSampleToggle');
  const hzSampleBadge = $('hzSampleBadge');

  const btnCtrlPreviewToggle = $('btnCtrlPreviewToggle');
  const ctrlPreviewBadge = $('ctrlPreviewBadge');
  const btnCtrlStickyToggle = $('btnCtrlStickyToggle');
  const ctrlStickyBadge = $('ctrlStickyBadge');
  const inputTrackingFps = $('inputTrackingFps');
  const btnHideTooltipsToggle = $('btnHideTooltipsToggle');
  const hideTooltipsBadge = $('hideTooltipsBadge');

  const btnQueueToggle = $('btnQueueToggle');
  const queueBadge = $('queueBadge');
  const queueBlock = $('queueBlock');
  const queueStatusText = $('queueStatusText');
  const btnProcessQueue = $('btnProcessQueue');
  const btnOpenTimeouted = $('btnOpenTimeouted');

  if (btnOpenTimeouted && tab.url) {
    const isE926 = /^https:\/\/e926\.net/i.test(tab.url);
    btnOpenTimeouted.href = isE926 ? 'https://e926.net/posts/timeouted' : 'https://e621.net/posts/timeouted';
  }

  function formatTime(ms) {
    const totalSec = Math.ceil(ms / 1000);
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  }

  async function refreshUI() {
    const data = await chrome.storage.local.get([
      KEYS.AUTO_UPDATE,
      KEYS.BLACKLIST_LOCKED,
      KEYS.SHOW_UPLOADER,
      KEYS.HZ_ENABLED,
      KEYS.HZ_LOAD_SAMPLE,
      KEYS.CTRL_PREVIEW_ENABLED,
      KEYS.CTRL_PREVIEW_STICKY,
      KEYS.TRACKING_FPS,
      KEYS.HIDE_THUMB_TOOLTIPS,
      KEYS.QUEUE_TAG_SCRIPTS_ENABLED,
      KEYS.TAG_SCRIPT_QUEUE,
      KEYS.QUEUE_TIMEOUT_UNTIL,
      KEYS.QUEUE_SLOT_TIMESTAMPS
    ]);

    const isAuto = Boolean(data[KEYS.AUTO_UPDATE]);
    const isLocked = Boolean(data[KEYS.BLACKLIST_LOCKED]);

    const hzEnabled = data[KEYS.HZ_ENABLED] !== false;
    hzBadge.textContent = hzEnabled ? 'ON' : 'OFF';
    hzBadge.classList.toggle('on', hzEnabled);

    const hzSample = data[KEYS.HZ_LOAD_SAMPLE] !== false;
    hzSampleBadge.textContent = hzSample ? 'ON' : 'OFF';
    hzSampleBadge.classList.toggle('on', hzSample);

    const ctrlPreview = data[KEYS.CTRL_PREVIEW_ENABLED] !== false;
    ctrlPreviewBadge.textContent = ctrlPreview ? 'ON' : 'OFF';
    ctrlPreviewBadge.classList.toggle('on', ctrlPreview);

    const ctrlSticky = Boolean(data[KEYS.CTRL_PREVIEW_STICKY]);
    ctrlStickyBadge.textContent = ctrlSticky ? 'ON' : 'OFF';
    ctrlStickyBadge.classList.toggle('on', ctrlSticky);

    if (inputTrackingFps && document.activeElement !== inputTrackingFps) {
      inputTrackingFps.value = Number(data[KEYS.TRACKING_FPS]) || 0;
    }

    const hideTooltips = Boolean(data[KEYS.HIDE_THUMB_TOOLTIPS]);
    hideTooltipsBadge.textContent = hideTooltips ? 'ON' : 'OFF';
    hideTooltipsBadge.classList.toggle('on', hideTooltips);

    const queueEnabled = Boolean(data[KEYS.QUEUE_TAG_SCRIPTS_ENABLED]);
    queueBadge.textContent = queueEnabled ? 'ON' : 'OFF';
    queueBadge.classList.toggle('on', queueEnabled);
    queueBlock.classList.toggle('hidden', !queueEnabled);

    const queue = data[KEYS.TAG_SCRIPT_QUEUE] || {};
    const count = Object.keys(queue).length;
    const slots = data[KEYS.QUEUE_SLOT_TIMESTAMPS] || [];
    const timeoutUntil = Number(data[KEYS.QUEUE_TIMEOUT_UNTIL]) || 0;
    const now = Date.now();

    const nextSlot = slots[0] || timeoutUntil;
    const isTimeout = nextSlot > now;

    if (isTimeout && count > 0) {
      const nextMs = Math.max(0, nextSlot - now);
      const allSlotIdx = Math.min(count - 1, slots.length - 1);
      const allSlot = slots[allSlotIdx] || nextSlot;
      const allMs = Math.max(0, allSlot - now);

      if (count > 1) {
        queueStatusText.textContent = `${count} queued (next: ${formatTime(nextMs)}, all: ${formatTime(allMs)})`;
      } else {
        queueStatusText.textContent = `1 queued (ready in ${formatTime(nextMs)})`;
      }
    } else {
      queueStatusText.textContent = `${count} posts queued (ready)`;
    }

    setButtonsDisabled(false);
    autoUpdateState.textContent = isAuto ? 'ON' : 'OFF';
    autoUpdateState.classList.toggle('on', isAuto);
    btnSyncApi.classList.toggle('hidden', !isAuto);
    manualActions.classList.toggle('hidden', isAuto);
    if (!isAuto) btnBackup.disabled = isLocked;

    const showUploader = data[KEYS.SHOW_UPLOADER] !== false;
    showUploaderBadge.textContent = showUploader ? 'ON' : 'OFF';
    showUploaderBadge.classList.toggle('on', showUploader);
  }

  btnHzToggle?.addEventListener('click', async () => {
    const data = await chrome.storage.local.get([KEYS.HZ_ENABLED]);
    await chrome.storage.local.set({ [KEYS.HZ_ENABLED]: data[KEYS.HZ_ENABLED] === false });
    await refreshUI();
  });

  btnHzSampleToggle?.addEventListener('click', async () => {
    const data = await chrome.storage.local.get([KEYS.HZ_LOAD_SAMPLE]);
    const current = data[KEYS.HZ_LOAD_SAMPLE] !== false;
    await chrome.storage.local.set({ [KEYS.HZ_LOAD_SAMPLE]: !current });
    await refreshUI();
  });

  btnCtrlPreviewToggle?.addEventListener('click', async () => {
    const data = await chrome.storage.local.get([KEYS.CTRL_PREVIEW_ENABLED]);
    const current = data[KEYS.CTRL_PREVIEW_ENABLED] !== false;
    await chrome.storage.local.set({ [KEYS.CTRL_PREVIEW_ENABLED]: !current });
    if (current) {
      await chrome.storage.local.set({ [KEYS.CTRL_STICKY_ACTIVE]: false });
    }
    await refreshUI();
  });

  btnCtrlStickyToggle?.addEventListener('click', async () => {
    const data = await chrome.storage.local.get([KEYS.CTRL_PREVIEW_STICKY]);
    const current = Boolean(data[KEYS.CTRL_PREVIEW_STICKY]);
    await chrome.storage.local.set({ [KEYS.CTRL_PREVIEW_STICKY]: !current });
    if (current) {
      await chrome.storage.local.set({ [KEYS.CTRL_STICKY_ACTIVE]: false });
    }
    await refreshUI();
  });

  inputTrackingFps?.addEventListener('change', async () => {
    let val = parseInt(inputTrackingFps.value, 10);
    if (isNaN(val) || val < 0) val = 0;
    if (val > 360) val = 360;
    inputTrackingFps.value = val;
    await chrome.storage.local.set({ [KEYS.TRACKING_FPS]: val });
  });

  inputTrackingFps?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') inputTrackingFps.blur();
  });

  btnHideTooltipsToggle?.addEventListener('click', async () => {
    const data = await chrome.storage.local.get([KEYS.HIDE_THUMB_TOOLTIPS]);
    const current = Boolean(data[KEYS.HIDE_THUMB_TOOLTIPS]);
    await chrome.storage.local.set({ [KEYS.HIDE_THUMB_TOOLTIPS]: !current });
    await refreshUI();
  });

  btnQueueToggle?.addEventListener('click', async () => {
    const data = await chrome.storage.local.get([KEYS.QUEUE_TAG_SCRIPTS_ENABLED]);
    await chrome.storage.local.set({ [KEYS.QUEUE_TAG_SCRIPTS_ENABLED]: !data[KEYS.QUEUE_TAG_SCRIPTS_ENABLED] });
    await refreshUI();
  });

  async function sendAction(action) {
    const enabling = action === ACTIONS.TOGGLE_AUTO_UPDATE && autoUpdateState.textContent === 'OFF';
    setStatus(enabling ? 'Syncing API & enabling...' : 'Processing...');
    setButtonsDisabled(true);

    try {
      const response = await chrome.tabs.sendMessage(tab.id, { action });
      setStatus(response?.status || (response?.ok === false ? 'Failed' : 'Done'));
    } catch (err) {
      const noReceiver = /Receiving end does not exist|message (channel|port) closed/i.test(err.message);
      setStatus(noReceiver ? 'Error: Refresh the page' : `Error: ${err.message}`);
    } finally {
      await refreshUI();
    }
  }

  $('btnAutoUpdate').addEventListener('click', () => sendAction(ACTIONS.TOGGLE_AUTO_UPDATE));
  btnSyncApi.addEventListener('click', () => sendAction(ACTIONS.SYNC_API));
  btnBackup.addEventListener('click', () => sendAction(ACTIONS.BACKUP_BLACKLIST));
  $('btnLoadDownvotes').addEventListener('click', () => sendAction(ACTIONS.LOAD_DOWNVOTES));
  $('btnUpload').addEventListener('click', () => sendAction(ACTIONS.UPLOAD_DOWNVOTES));
  $('btnUnload').addEventListener('click', () => sendAction(ACTIONS.UNLOAD_DOWNVOTES));
  btnProcessQueue?.addEventListener('click', () => sendAction(ACTIONS.PROCESS_TAG_QUEUE));

  $('btnShowUploader').addEventListener('click', async () => {
    const data = await chrome.storage.local.get([KEYS.SHOW_UPLOADER]);
    await chrome.storage.local.set({ [KEYS.SHOW_UPLOADER]: data[KEYS.SHOW_UPLOADER] === false });
    await refreshUI();
  });

  $('btnShowTreePopup').addEventListener('click', async () => {
    const id = Number(inputTreePostId.value.trim());
    if (!Number.isInteger(id) || id <= 0) return setStatus('Enter a valid post ID');
    try {
      await chrome.tabs.sendMessage(tab.id, { action: ACTIONS.SHOW_POST_TREE, postId: id });
      window.close();
    } catch (err) {
      setStatus('Error: Refresh the page');
    }
  });

  const stored = await chrome.storage.local.get([KEYS.ACTIVE_POPUP_TAB]);
  const validTabs = ['main', 'blck', 'tagscr', 'hz'];
  let initialTab = 'main';
  if (stored[KEYS.ACTIVE_POPUP_TAB] === 'extra') {
    initialTab = 'tagscr';
  } else if (validTabs.includes(stored[KEYS.ACTIVE_POPUP_TAB])) {
    initialTab = stored[KEYS.ACTIVE_POPUP_TAB];
  }
  showTab(initialTab);

  await refreshUI();

  const liveTimer = setInterval(refreshUI, 1000);
  window.addEventListener('unload', () => clearInterval(liveTimer));
});