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
    if (sender.id !== chrome.runtime.id) return false;

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

  (async function start() {
    await U.ensureStorageSchema();
    for (const name of ['uploader', 'userEdits', 'tree', 'blacklist', 'hoverZoom', 'tagScriptQueue', 'timeoutedPage', 'tagScript', 'tooltipsManager']) {
      try {
        await E621X.get(name).init();
      } catch (err) {
        U.logWarn(`init ${name}`, err);
      }
    }
  })();
})();