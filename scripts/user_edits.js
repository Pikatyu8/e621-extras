/* User Profile: Specific Post Edits filter & tracker.
 * Allows filtering post versions for a specific user by:
 * - tags in post (search[tags])
 * - tags added (search[tags_added])
 * - tags removed (search[tags_removed])
 * Supports native e621 AND/OR operators (space for AND, ~ for OR). */
E621X.define('userEdits', ['utils', 'selectors', 'net', 'dom'], (U, SEL, Net, D) => {
  'use strict';

  const STORAGE_KEY_PREFIX = 'e621x_specific_edits_';
  const FORM_CONTAINER_ID = 'e621x-specific-edits-container';

  let isCounting = false;

  function isUserPage() {
    return /^\/users\/\d+/i.test(location.pathname) ||
      (document.body?.classList?.contains('c-users') && document.body?.classList?.contains('a-show'));
  }

  function getProfileUserId() {
    const match = location.pathname.match(/^\/users\/(\d+)/i);
    if (match) return match[1];

    const meta = document.querySelector('meta[name="user-id"]');
    if (meta?.content && /^\d+$/.test(meta.content)) return meta.content;

    const link = document.querySelector('a[href*="/post_versions?"]');
    if (link) {
      const m = link.href.match(/search(?:\[|%5B)updater_id(?:\]|%5D)=(\d+)/);
      if (m) return m[1];
    }

    return document.body?.dataset?.userId || null;
  }

  function loadSavedQuery(userId) {
    try {
      const raw = localStorage.getItem(`${STORAGE_KEY_PREFIX}${userId}`) ||
                  localStorage.getItem(`${STORAGE_KEY_PREFIX}last`);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  function saveQuery(userId, query) {
    try {
      const json = JSON.stringify(query);
      localStorage.setItem(`${STORAGE_KEY_PREFIX}${userId}`, json);
      localStorage.setItem(`${STORAGE_KEY_PREFIX}last`, json);
    } catch (_) {
      // localStorage disabled or full
    }
  }

  function clearSavedQuery(userId) {
    try {
      localStorage.removeItem(`${STORAGE_KEY_PREFIX}${userId}`);
    } catch (_) {
      // Ignored
    }
  }

  function buildUrl(userId, { tags, added, removed }, isJson = false) {
    const endpoint = isJson ? '/post_versions.json' : '/post_versions';
    const params = new URLSearchParams();

    if (userId) {
      params.set('search[updater_id]', userId);
    }
    if (tags?.trim()) {
      params.set('search[tags]', tags.trim());
    }
    if (added?.trim()) {
      params.set('search[tags_added]', added.trim());
    }
    if (removed?.trim()) {
      params.set('search[tags_removed]', removed.trim());
    }

    return `${endpoint}?${params.toString()}`;
  }

  function createForm(userId) {
    const container = D.el('div', {
      id: FORM_CONTAINER_ID,
      class: 'e621x-specific-edits-panel is-hidden'
    });

    const saved = loadSavedQuery(userId) || {};

    const inputTags = D.el('input', {
      type: 'text',
      id: 'e621x-edits-tags',
      class: 'st-input e621x-specific-edits-input',
      placeholder: '(use space for AND matches)',
      value: saved.tags || '',
      autocomplete: 'off'
    });

    const inputAdded = D.el('input', {
      type: 'text',
      id: 'e621x-edits-added',
      class: 'st-input e621x-specific-edits-input',
      placeholder: '(use ~ for OR matches)',
      value: saved.added || '',
      autocomplete: 'off'
    });

    const inputRemoved = D.el('input', {
      type: 'text',
      id: 'e621x-edits-removed',
      class: 'st-input e621x-specific-edits-input',
      placeholder: '(use - to exclude tags)',
      value: saved.removed || '',
      autocomplete: 'off'
    });

    function removeStatus() {
      const existing = container.querySelector('.e621x-specific-edits-status');
      if (existing) existing.remove();
    }

    function showStatus(children, isError = false) {
      removeStatus();
      const status = D.el('div', {
        class: `e621x-specific-edits-status${isError ? ' is-error' : ''}`
      }, children);
      container.appendChild(status);
      return status;
    }

    function getValues() {
      return {
        tags: inputTags.value.trim(),
        added: inputAdded.value.trim(),
        removed: inputRemoved.value.trim()
      };
    }

    function handleNavigate() {
      const q = getValues();
      if (!q.tags && !q.added && !q.removed) {
        showStatus('Enter at least one tag filter (in post, added, or removed).', true);
        return;
      }
      saveQuery(userId, q);
      const url = buildUrl(userId, q, false);
      window.open(url, '_blank', 'noopener');
    }

    async function handleCount() {
      if (isCounting) return;

      const q = getValues();
      if (!q.tags && !q.added && !q.removed) {
        showStatus('Enter at least one tag filter to count edits.', true);
        return;
      }

      saveQuery(userId, q);
      isCounting = true;
      btnCount.style.cursor = 'wait';

      // 1. Создаем статус сразу после клика на Count
      showStatus('Counting edits...');

      try {
        let total = 0;
        let page = 1;
        const PAGE_LIMIT = 320;
        const MAX_PAGES = 100; // До 32 000 правок

        while (page <= MAX_PAGES && isCounting) {
          // 2. Отображаем живой прогресс в созданном элементе
          const statusEl = container.querySelector('.e621x-specific-edits-status');
          if (statusEl) {
            statusEl.textContent = total > 0
              ? `Counting edits: ${total}... (page ${page})`
              : `Counting edits... (page ${page})`;
          }

          const url = `${buildUrl(userId, q, true)}&limit=${PAGE_LIMIT}&page=${page}`;
          const data = await Net.fetchJson(url);
          const list = Array.isArray(data) ? data : (data?.post_versions || []);
          total += list.length;

          if (list.length < PAGE_LIMIT) break;
          page++;
        }

        if (!isCounting) return;

        const viewUrl = buildUrl(userId, q, false);
        const limitText = page > MAX_PAGES ? '+' : '';

        // 3. Выводим итоговый результат со ссылкой
        showStatus([
          document.createTextNode(`Found ${total}${limitText} edit(s) by User #${userId}. `),
          D.el('a', {
            href: viewUrl,
            target: '_blank',
            rel: 'noopener',
            text: '[View Edits]'
          })
        ]);
      } catch (err) {
        if (isCounting) {
          showStatus(`Error counting edits: ${err.message}`, true);
        }
      } finally {
        isCounting = false;
        btnCount.style.cursor = '';
      }
    }

    function handleClear() {
      isCounting = false;
      btnCount.style.cursor = '';
      inputTags.value = '';
      inputAdded.value = '';
      inputRemoved.value = '';
      clearSavedQuery(userId);
      removeStatus(); // Удаляем статус из DOM
    }

    [inputTags, inputAdded, inputRemoved].forEach(input => {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          handleNavigate();
        }
      });
    });

    const btnView = D.button({
      text: 'View',
      title: 'Open post versions in a new tab',
      className: 'e621x-specific-edits-btn',
      onClick: handleNavigate
    });

    const btnCount = D.button({
      text: 'Count',
      title: 'Count edits matching these tags via API',
      className: 'e621x-specific-edits-btn',
      onClick: handleCount
    });

    const btnClear = D.button({
      text: 'Clear',
      title: 'Clear all fields and remove results',
      className: 'e621x-specific-edits-btn',
      onClick: handleClear
    });

    const closeBtn = D.el('button', {
      type: 'button',
      class: 'e621x-specific-edits-close',
      text: '×',
      title: 'Close',
      onClick: () => {
        isCounting = false;
        btnCount.style.cursor = '';
        container.classList.add('is-hidden');
      }
    });

    const header = D.el('div', { class: 'e621x-specific-edits-header' }, [
      D.el('span', { class: 'e621x-specific-edits-title', text: `Specific Post Edits (User #${userId})` }),
      closeBtn
    ]);

    const fields = D.el('div', { class: 'e621x-specific-edits-fields' }, [
      D.el('div', { class: 'e621x-specific-edits-field' }, [
        D.el('label', { for: 'e621x-edits-tags', text: 'Tags in post' }),
        inputTags
      ]),
      D.el('div', { class: 'e621x-specific-edits-field' }, [
        D.el('label', { for: 'e621x-edits-added', text: 'Tags added' }),
        inputAdded
      ]),
      D.el('div', { class: 'e621x-specific-edits-field' }, [
        D.el('label', { for: 'e621x-edits-removed', text: 'Tags removed' }),
        inputRemoved
      ])
    ]);

    const actions = D.el('div', { class: 'e621x-specific-edits-actions' }, [
      btnView,
      btnCount,
      btnClear
    ]);

    container.append(header, fields, actions);
    return container;
  }

  function toggleForm(form) {
    const isHidden = form.classList.toggle('is-hidden');
    if (!isHidden) {
      const statsTabBtn = document.querySelector('tabs-menu button[name="stats"]');
      if (statsTabBtn && !statsTabBtn.classList.contains('active')) {
        statsTabBtn.click();
      }
      form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      form.querySelector('input')?.focus();
    }
  }

  function inject() {
    if (!isUserPage()) return;
    if (document.getElementById(FORM_CONTAINER_ID)) return;

    const userId = getProfileUserId();
    if (!userId) return;

    const form = createForm(userId);

    const postVersionLink = document.querySelector('a[href*="/post_versions"]');
    const changesLine = postVersionLink?.closest('.profile-line');

    if (changesLine) {
      const trigger = D.el('a', {
        role: 'button',
        class: 'e621x-specific-edits-trigger',
        text: 'view specific post edits',
        onClick: (e) => {
          e.preventDefault();
          toggleForm(form);
        }
      });

      const wrapper = D.el('div', { class: 'e621x-specific-edits-wrapper' }, [
        trigger,
        form
      ]);
      changesLine.appendChild(wrapper);
    }
  }

  return { init: inject };
});