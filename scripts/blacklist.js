/* Blacklist / downvotes manager.
 *
 * Glossary (popup labels map to these):
 *   downvotes        – IDs of posts the user downvoted on the site.
 *   loadDownvotes    – site API  -> extension storage.
 *   uploadDownvotes  – storage   -> site blacklist (adds `id:N` rules).
 *   unloadDownvotes  – removes the `id:N` rules of stored downvotes from the blacklist.
 *   backupBlacklist  – live blacklist -> extension storage (disabled while LOCKED).
 *   LOCKED           – set while `id:N` rules are in the blacklist, so a backup would be polluted.
 *
 * Invariants:
 *  - every public operation runs through ONE queue (no lost read-modify-write updates);
 *  - the blacklist is persisted via the API and checked (res.ok) BEFORE local flags change;
 *  - operations return Result objects ({ ok, message, code }), never magic strings.
 */
E621X.define('blacklist', ['utils', 'selectors', 'net'], (U, SEL, Net) => {
  'use strict';
  const { STORAGE_KEYS: KEYS } = E621_CONSTANTS;
  const { ok, fail } = U;

  const DOWNVOTES_PAGE_LIMIT = 320;
  const RELOAD_DELAY_MS = 1500;

  const queue = U.createQueue();
  let reloadTimer = null;

  // ---------- helpers ----------
  const parseBlacklistText = (text) => String(text || '').split('\n').map(t => t.trim()).filter(Boolean);

  function idFromRule(rule) {
    const m = String(rule).trim().match(/^id:(\d+)$/i);
    return m ? Number(m[1]) : null;
  }

  const readDownvotes = async () => (await U.storageGet(KEYS.DOWNVOTES, [])).map(Number);

  /* Debounced: several operations in a row cause a single reload, after all writes and toasts. */
  function scheduleReload() {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => location.reload(), RELOAD_DELAY_MS);
  }

  const notLoggedIn = () => {
    U.showToast('Sign in to e621 first', true);
    return fail('Not logged in', 'NOT_LOGGED_IN');
  };

  const failFromError = (err) => {
    U.logWarn('blacklist', err);
    U.showToast(`Error: ${err.message}`, true);
    return fail(err.message);
  };

  // ---------- blacklist I/O ----------
  /* Reads directly from the page DOM (meta tag or #site-user) to avoid unnecessary HTTP requests. */
  function readDomBlacklist() {
    const meta = document.querySelector(SEL.blacklistMeta);
    if (meta?.content) {
      try {
        const parsed = JSON.parse(meta.content);
        if (Array.isArray(parsed)) return parsed.map(t => String(t).trim()).filter(Boolean);
      } catch (err) {
        U.logWarn('parsing blacklist meta tag', err);
      }
    }

    const siteUser = document.querySelector(SEL.siteUser);
    if (siteUser) {
      try {
        const data = JSON.parse(atob(siteUser.textContent.trim()));
        if (Array.isArray(data?.blacklist)) return data.blacklist.map(t => String(t).trim()).filter(Boolean);
      } catch (err) {
        U.logWarn('parsing site-user blacklist', err);
      }
    }

    return null;
  }

  /* Reads DOM first to avoid spamming /users/me.json on single downvotes.
   * Falls back to API or forces API read for backups. */
  async function fetchLiveBlacklist(forceApi = false) {
    if (!forceApi) {
      const domRules = readDomBlacklist();
      if (domRules) return domRules;
    }

    try {
      const data = await Net.fetchJson('/users/me.json');
      if (typeof data.blacklisted_tags === 'string') return parseBlacklistText(data.blacklisted_tags);
    } catch (err) {
      U.logWarn('reading blacklist via API failed, checking DOM fallback', err);
    }

    const fallbackDom = readDomBlacklist();
    if (fallbackDom) return fallbackDom;

    throw new Error('Cannot read the current blacklist');
  }

  async function saveBlacklist(userId, rules) {
    const res = await Net.sendForm(`/users/${userId}.json`, 'PATCH', {
      'user[blacklisted_tags]': rules.join('\n')
    });
    if (!res.ok) throw new Net.HttpError(res.status, res.url);

    // Keep the in-DOM meta tag updated so subsequent operations read without network round-trips
    const meta = document.querySelector(SEL.blacklistMeta);
    if (meta) meta.content = JSON.stringify(rules);
  }

  // ---------- operations (internal, NOT queued; composed by the public wrappers) ----------
  async function backupBlacklistImpl() {
    if (await U.storageGet(KEYS.BLACKLIST_LOCKED, false)) {
      const msg = 'Disabled: downvotes are in blacklist.';
      U.showToast(msg, true);
      return fail(msg, 'LOCKED');
    }
    const user = U.getCurrentUser();
    if (!user) return notLoggedIn();
    try {
      U.showToast('Backing up blacklist...');
      const rules = await fetchLiveBlacklist(true); // force fresh API read for backups
      await U.storageSet(KEYS.BLACKLIST_BACKUP, rules);
      const msg = `Backup saved (${rules.length} rules)`;
      U.showToast(msg);
      return ok(msg);
    } catch (err) {
      return failFromError(err);
    }
  }

  async function loadDownvotesImpl() {
    const user = U.getCurrentUser();
    if (!user) return notLoggedIn();
    try {
      U.showToast('Fetching downvoted posts...');
      const ids = new Set();
      let lowestId = null;

      for (;;) {
        let url = `/posts.json?tags=downvoted:${encodeURIComponent(user.userName)}&limit=${DOWNVOTES_PAGE_LIMIT}`;
        if (lowestId) url += `&page=b${lowestId}`;
        const data = await Net.fetchJson(url);
        const posts = Array.isArray(data) ? data : (data.posts || []);
        if (!posts.length) break;

        posts.forEach(p => ids.add(p.id));
        lowestId = Math.min(...posts.map(p => p.id));
        if (posts.length < DOWNVOTES_PAGE_LIMIT) break;
      }

      await U.storageSet(KEYS.DOWNVOTES, [...ids]);
      const msg = `Loaded ${ids.size} downvotes`;
      U.showToast(msg);
      return ok(msg);
    } catch (err) {
      return failFromError(err);
    }
  }

  async function uploadDownvotesImpl() {
    const user = U.getCurrentUser();
    if (!user) return notLoggedIn();

    const downvoted = await readDownvotes();
    if (!downvoted.length) {
      U.showToast('No saved downvotes found', true);
      return fail('No downvotes in storage', 'NO_DOWNVOTES');
    }

    try {
      U.showToast('Processing blacklist update...');
      const current = await fetchLiveBlacklist();
      const existing = new Set(current.map(idFromRule).filter(id => id !== null));
      const toAdd = downvoted.filter(id => !existing.has(id));

      if (toAdd.length) {
        await saveBlacklist(user.userId, [...current, ...toAdd.map(id => `id:${id}`)]);
      }
      await U.storageSet(KEYS.BLACKLIST_LOCKED, true); // only after a successful save

      if (!toAdd.length) {
        U.showToast('All downvotes already blacklisted');
        return ok('Already up to date');
      }
      const msg = `Added ${toAdd.length} posts to blacklist`;
      U.showToast(msg);
      scheduleReload();
      return ok(msg);
    } catch (err) {
      return failFromError(err);
    }
  }

  async function unloadDownvotesImpl() {
    const user = U.getCurrentUser();
    if (!user) return notLoggedIn();

    const downvoted = new Set(await readDownvotes());
    if (!downvoted.size) {
      U.showToast('No downvotes stored to match', true);
      return fail('No downvotes in storage', 'NO_DOWNVOTES');
    }

    try {
      U.showToast('Removing downvotes...');
      const current = await fetchLiveBlacklist();
      const updated = current.filter(rule => !downvoted.has(idFromRule(rule)));
      const removed = current.length - updated.length;

      if (removed) await saveBlacklist(user.userId, updated);
      await U.storageSet(KEYS.BLACKLIST_LOCKED, false); // only after a successful save

      if (!removed) {
        U.showToast('No downvotes found in blacklist');
        return ok('None found to remove');
      }
      const msg = `Removed ${removed} posts`;
      U.showToast(msg);
      scheduleReload();
      return ok(msg);
    } catch (err) {
      return failFromError(err);
    }
  }

  async function syncApiImpl() {
    const loaded = await loadDownvotesImpl();
    if (!loaded.ok) return loaded;
    return uploadDownvotesImpl();
  }

  async function toggleAutoUpdateImpl() {
    if (await U.storageGet(KEYS.AUTO_UPDATE, false)) {
      await U.storageSet(KEYS.AUTO_UPDATE, false);
      U.showToast('Auto Update disabled');
      return ok('Auto Update OFF');
    }

    U.showToast('Auto Update: syncing downvotes via API...');
    const result = await syncApiImpl();
    // "no downvotes yet" is fine; any other failure must NOT enable auto mode
    if (!result.ok && result.code !== 'NO_DOWNVOTES') {
      return fail(`Auto Update not enabled: ${result.message}`, result.code);
    }
    await U.storageSet(KEYS.AUTO_UPDATE, true);
    U.showToast('Auto Update enabled & synced');
    return ok(`Auto Update ON (${result.message})`);
  }

  // ---------- auto mode: single votes (throw on failure, caller reports) ----------
  async function addPost(postId) {
    const user = U.getCurrentUser();
    if (!user) throw new Error('Not logged in');

    const current = await fetchLiveBlacklist();
    const rule = `id:${postId}`;
    const present = current.some(r => r.trim().toLowerCase() === rule);
    if (!present) await saveBlacklist(user.userId, [...current, rule]);

    const ids = new Set(await readDownvotes());
    ids.add(postId);
    await U.storageSet(KEYS.DOWNVOTES, [...ids]);
    await U.storageSet(KEYS.BLACKLIST_LOCKED, true);
    if (!present) U.showToast(`Auto: #${postId} blacklisted (applies after reload)`);
  }

  async function removePost(postId) {
    const user = U.getCurrentUser();
    if (!user) throw new Error('Not logged in');

    const current = await fetchLiveBlacklist();
    const rule = `id:${postId}`;
    const updated = current.filter(r => r.trim().toLowerCase() !== rule);
    if (updated.length !== current.length) await saveBlacklist(user.userId, updated);

    const ids = (await readDownvotes()).filter(id => id !== postId);
    await U.storageSet(KEYS.DOWNVOTES, ids);
    if (updated.length !== current.length) U.showToast(`Auto: #${postId} un-blacklisted`);
  }

  /* Vote state of the button's own post. A global querySelector fallback is only valid on a post page
   * (button outside any thumbnail); on listings it would return another post's state. */
  function readVoteState(voteBtn) {
    let container = voteBtn.closest(SEL.thirdParty.voteContainer);
    if (!container && !voteBtn.closest('article.thumbnail')) {
      container = document.querySelector(SEL.thirdParty.voteContainer);
    }
    return container ? String(container.dataset.vote || '0') : null; // null = unknown
  }

  async function handleVote(action, postId, domState) {
    if (!(await U.storageGet(KEYS.AUTO_UPDATE, false))) return;
    try {
      await queue.run(async () => {
        const wasDownvoted = domState !== null
          ? domState === '-1'
          : (await readDownvotes()).includes(postId); // unknown DOM state: trust our own record
        if (action === '-1') {
          return wasDownvoted ? removePost(postId) : addPost(postId);
        }
        if (action === '1' && wasDownvoted) return removePost(postId);
      });
    } catch (err) {
      U.logWarn('vote sync', err);
      U.showToast(`Blacklist sync failed for #${postId}: ${err.message}`, true);
    }
  }

  function setupVoteListener() {
    document.addEventListener('click', (e) => {
      const voteBtn = e.target.closest(SEL.voteButton);
      if (!voteBtn) return;
      if (SEL.commentVoteClasses.some(c => voteBtn.classList.contains(c))) return;
      if (!chrome.runtime?.id) return;

      const action = voteBtn.dataset.action;
      if (action !== '1' && action !== '-1') return;
      const postId = U.getPostIdFromPage(voteBtn);
      if (!postId) return;

      // Must be read synchronously: the site's own handler mutates the state right after this capture listener.
      const domState = readVoteState(voteBtn);
      handleVote(action, postId, domState);
    }, true);
  }

  // ---------- public API (names match E621_CONSTANTS.ACTIONS) ----------
  return {
    init: setupVoteListener,
    backupBlacklist: () => queue.run(backupBlacklistImpl),
    loadDownvotes: () => queue.run(loadDownvotesImpl),
    uploadDownvotes: () => queue.run(uploadDownvotesImpl),
    unloadDownvotes: () => queue.run(unloadDownvotesImpl),
    syncApi: () => queue.run(syncApiImpl),
    toggleAutoUpdate: () => queue.run(toggleAutoUpdateImpl)
  };
});