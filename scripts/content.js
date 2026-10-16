(function () {
  'use strict';
  const { ACTIONS } = E621_CONSTANTS;
  const U = E621X.get('utils');
  const blacklist = E621X.get('blacklist');
  const tree = E621X.get('tree');
  const queue = E621X.get('tagScriptQueue');

  const handlers = {
    [ACTIONS.SHOW_POST_TREE]: async (req) => {
      if (!req.postId) return U.fail('Invalid post ID');
      tree.open(req.postId);
      return U.ok('Opening post tree...');
    },
    [ACTIONS.BACKUP_BLACKLIST]: () => blacklist.backupBlacklist(),
    [ACTIONS.LOAD_DOWNVOTES]: () => blacklist.loadDownvotes(),
    [ACTIONS.UPLOAD_DOWNVOTES]: () => blacklist.uploadDownvotes(),
    [ACTIONS.UNLOAD_DOWNVOTES]: () => blacklist.unloadDownvotes(),
    [ACTIONS.SYNC_API]: () => blacklist.syncApi(),
    [ACTIONS.TOGGLE_AUTO_UPDATE]: () => blacklist.toggleAutoUpdate(),
    [ACTIONS.PROCESS_TAG_QUEUE]: async () => {
      const res = await queue.processQueue();
      return U.ok(`Queue processed: ${res.updated || 0} updated`);
    }
  };

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (chrome.runtime?.id && sender?.id && sender.id !== chrome.runtime.id) return false;

    const handler = handlers[request?.action];
    if (!handler) {
      sendResponse({ ok: false, status: 'Unknown action' });
      return false;
    }

    Promise.resolve()
      .then(() => handler(request))
      .catch(err => {
        U.logWarn(`action ${request.action}`, err);
        return U.fail(err.message || String(err));
      })
      .then(result => sendResponse({ ok: result.ok, status: result.message }));
    return true;
  });

  window.addEventListener('message', async (event) => {
    if (!event.data || !event.data.fromE621Popup) return;
    const { action } = event.data;
    const handler = handlers[action];
    const port = event.ports && event.ports[0];

    if (!handler) {
      if (port) port.postMessage({ ok: false, status: 'Unknown action' });
      return;
    }

    try {
      const result = await Promise.resolve(handler(event.data));
      if (port) port.postMessage({ ok: result.ok, status: result.message });
    } catch (err) {
      U.logWarn(`postMessage action ${action}`, err);
      if (port) port.postMessage({ ok: false, status: err.message || String(err) });
    }
  });

  (async function start() {
    await U.ensureStorageSchema();
    const csrf = U.getCsrfToken();
    if (csrf && chrome.runtime?.id) {
      chrome.runtime.sendMessage({ action: ACTIONS.SET_CSRF_TOKEN, csrfToken: csrf }).catch(() => {});
    }
    for (const name of ['uploader', 'userEdits', 'tree', 'blacklist', 'hoverZoom', 'tagScriptQueue', 'timeoutedPage', 'tagScript', 'tooltipsManager']) {
      try {
        await E621X.get(name).init();
      } catch (err) {
        U.logWarn(`init ${name}`, err);
      }
    }
  })();
})();