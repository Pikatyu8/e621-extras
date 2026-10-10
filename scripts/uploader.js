E621X.define('uploader', ['utils', 'selectors', 'net', 'dom'], (U, SEL, Net, D) => {
  'use strict';
  const { STORAGE_KEYS } = E621_CONSTANTS;
  const ITEM_ID = 'post-info-extra-uploader';
  const rankCache = new Map();

  /* Link to a user, styled with the site's rank classes (taken from the page, the cache, or /users/:id.json). */
  function createUserLink(id, name = '') {
    if (!/^\d+$/.test(String(id))) return D.el('span', { text: name || 'unknown user' });

    const link = D.el('a', { href: `/users/${id}`, text: name || `User #${id}` });
    const existing = document.querySelector(`a[href="/users/${id}"]`);
    if (existing?.className) {
      link.className = existing.className;
      return link;
    }

    const cached = rankCache.get(String(id));
    if (cached) {
      link.textContent = cached.name;
      link.className = cached.cssClass;
      return link;
    }

    Net.fetchJson(`/users/${id}.json`)
      .then(user => {
        const level = String(user.level_string || 'member').toLowerCase().replace(/[^a-z0-9_-]/g, '');
        const cssClass = user.is_banned ? 'user-blocked' : `user-${level}`;
        rankCache.set(String(id), { name: user.name, cssClass });
        link.textContent = user.name;
        link.className = cssClass;
      })
      .catch(err => U.logWarn('uploader rank lookup', err));

    return link;
  }

  const findInfoItem = (prefix, excludeId = null) =>
    Array.from(document.querySelectorAll(SEL.postInfoItems)).find(li =>
      li.id !== excludeId && li.textContent.trim().toLowerCase().startsWith(prefix));

  function updateVisibility(enabled) {
    const existing = document.getElementById(ITEM_ID);
    if (!enabled) { existing?.remove(); return; }

    // The site may already render a native "Uploader:" row
    if (findInfoItem('uploader:', ITEM_ID)) { existing?.remove(); return; }
    if (existing) return;

    const container = document.querySelector(SEL.imageContainer);
    const uploaderId = container?.dataset.uploaderId;
    if (!uploaderId) return;

    const li = D.el('li', { id: ITEM_ID }, [
      'Uploader: ',
      createUserLink(uploaderId, container.dataset.uploader || '')
    ]);

    const postedLi = findInfoItem('posted:');
    if (postedLi) {
      postedLi.insertAdjacentElement('afterend', li);
    } else {
      const lists = document.querySelectorAll(SEL.postInfoLists);
      lists[lists.length - 1]?.appendChild(li);
    }
  }

  async function init() {
    updateVisibility(await U.storageGet(STORAGE_KEYS.SHOW_UPLOADER, true));
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes[STORAGE_KEYS.SHOW_UPLOADER]) {
        updateVisibility(changes[STORAGE_KEYS.SHOW_UPLOADER].newValue !== false);
      }
    });
  }

  return { init, updateVisibility };
});