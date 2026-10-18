/* User Profile: Specific Post Edits filter & Tag Update Statistics dashboard.
 * - Allows filtering post versions by specific tags.
 * - Collects and visualizes comprehensive tag update statistics for any user:
 *   most added tags, most removed tags, most common tags in edited posts, timeline dates,
 *   with full category coloring matching e621 conventions. */
E621X.define('userEdits', ['utils', 'selectors', 'net', 'dom'], (U, SEL, Net, D) => {
  'use strict';

  const STORAGE_KEY_PREFIX = 'e621x_specific_edits_';
  const FORM_CONTAINER_ID = 'e621x-specific-edits-container';
  const STATS_MODAL_ID = 'e621x-tag-stats-modal';

  const CATEGORY_NAMES = {
    0: 'General',
    1: 'Artist',
    2: 'Contributor',
    3: 'Copyright',
    4: 'Character',
    5: 'Species',
    6: 'Invalid',
    7: 'Meta',
    8: 'Lore'
  };

  const tagCategoryCache = new Map();
  const inFlightCategories = new Set();
  const userStatsCache = new Map(); // userId -> { statsMap, totalVersions, uniquePosts }

  let isCounting = false;

  function isUserPage() {
    return /^\/users\/\d+/i.test(location.pathname) ||
      (document.body?.classList?.contains('c-users') && document.body?.classList?.contains('a-show'));
  }

  function getProfileUserId() {
    const match = location.pathname.match(/^\/users\/(\d+)/i);
    if (match) return match[1];

    const cardLink = document.querySelector('.user-card-name a[href*="/users/"]');
    if (cardLink) {
      const m = cardLink.href.match(/\/users\/(\d+)/);
      if (m) return m[1];
    }

    const meta = document.querySelector('meta[name="user-id"]');
    if (meta?.content && /^\d+$/.test(meta.content)) return meta.content;

    const link = document.querySelector('a[href*="/post_versions?"]');
    if (link) {
      const m = link.href.match(/search(?:\[|%5B)updater_id(?:\]|%5D)=(\d+)/);
      if (m) return m[1];
    }

    return null;
  }

  /* Takes the username directly from .user-card-name of the profile being viewed */
  function getProfileUserName() {
    const cardLink = document.querySelector('.user-card-name a, .user-card-name');
    if (cardLink) {
      const name = cardLink.textContent.trim();
      if (name) return name;
    }

    const ogTitle = document.querySelector('meta[property="og:title"]');
    if (ogTitle?.content) {
      const clean = ogTitle.content.replace(/\s*-\s*e621.*$/i, '').trim();
      if (clean) return clean;
    }

    const titleMatch = document.title.match(/User\s*-\s*(.+?)\s*-\s*e621/i);
    if (titleMatch?.[1]) {
      return titleMatch[1].trim();
    }

    const userId = getProfileUserId();
    return userId ? `User #${userId}` : 'User';
  }

  /* Reads the exact number of post edits from the profile Changes block (e.g. <h5>4652</h5>) */
  function getProfilePostEditsCount() {
    const postVersionLink = document.querySelector('a[href*="/post_versions"][href*="updater_id"], a[href*="/post_versions"]');
    if (postVersionLink) {
      const h5 = postVersionLink.querySelector('h5');
      if (h5) {
        const num = parseInt(h5.textContent.replace(/[^\d]/g, ''), 10);
        if (Number.isFinite(num) && num > 0) return num;
      }
      const rawNum = parseInt(postVersionLink.textContent.replace(/[^\d]/g, ''), 10);
      if (Number.isFinite(rawNum) && rawNum > 0) return rawNum;
    }

    const changesLines = document.querySelectorAll('.profile-line');
    for (const line of changesLines) {
      const text = line.textContent || '';
      if (text.includes('Changes') || text.includes('Post')) {
        const link = line.querySelector('a[href*="/post_versions"]');
        if (link) {
          const num = parseInt(link.textContent.replace(/[^\d]/g, ''), 10);
          if (Number.isFinite(num) && num > 0) return num;
        }
      }
    }

    return 0;
  }

  function seedCategoryCache() {
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

  async function fetchMissingCategories(tagNames) {
    const missing = tagNames.filter(t => !tagCategoryCache.has(t) && !inFlightCategories.has(t));
    if (!missing.length) return;

    missing.forEach(t => inFlightCategories.add(t));
    for (let i = 0; i < missing.length; i += 100) {
      const chunk = missing.slice(i, i + 100);
      try {
        const url = `/tags.json?search[name]=${encodeURIComponent(chunk.join(','))}&limit=100`;
        const data = await Net.fetchJson(url);
        const list = Array.isArray(data) ? data : (data?.tags || []);
        list.forEach(t => {
          if (t?.name && t.category !== undefined) {
            tagCategoryCache.set(String(t.name).toLowerCase(), Number(t.category));
          }
        });
        chunk.forEach(t => {
          if (!tagCategoryCache.has(t)) tagCategoryCache.set(t, 0);
        });
      } catch (err) {
        U.logWarn('fetchMissingCategories', err);
        chunk.forEach(t => {
          if (!tagCategoryCache.has(t)) tagCategoryCache.set(t, 0);
        });
      } finally {
        chunk.forEach(t => inFlightCategories.delete(t));
      }
    }
  }

  function extractTags(val) {
    if (!val) return [];
    if (Array.isArray(val)) return val.map(t => String(t).trim().toLowerCase()).filter(Boolean);
    if (typeof val === 'string') return val.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return [];
  }

  function formatShortDate(timestamp) {
    if (!timestamp) return '—';
    const d = new Date(timestamp);
    if (isNaN(d.getTime())) return '—';
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  // ==========================================
  // TAG UPDATE STATISTICS MODAL
  // ==========================================
  function openTagStatsModal(userId) {
    const existing = document.getElementById(STATS_MODAL_ID);
    if (existing) existing.remove();

    const userName = getProfileUserName();
    const expectedTotal = getProfilePostEditsCount();
    let abortFetch = false;

    // Active filters & sorting
    let sortKey = 'added_desc';
    let filterCategory = 'all';
    let filterAction = 'all';
    let filterUploadType = 'all';
    let filterQuery = '';
    let currentPage = 1;
    const PAGE_SIZE = 50;

    // Elements
    const overlay = D.el('div', { id: STATS_MODAL_ID, class: 'e621x-stats-overlay' });
    const dialog = D.el('div', { class: 'e621x-stats-dialog', role: 'dialog', 'aria-modal': 'true' });

    // 1. Header
    const titleSpan = D.el('span', { class: 'e621x-stats-title', text: `Tag Update Statistics — ${userName} (#${userId})` });
    function closeModal() {
      abortFetch = true;
      document.removeEventListener('keydown', handleKeydown);
      overlay.remove();
    }

    const closeBtn = D.el('button', {
      type: 'button',
      class: 'e621x-modal-close st-button kinetic',
      text: '×',
      'aria-label': 'Close',
      onClick: closeModal
    });

    const header = D.el('div', { class: 'e621x-stats-header' }, [
      titleSpan,
      closeBtn
    ]);

    // 2. Fetch Progress Area
    const progressText = D.el('div', { class: 'e621x-stats-progress-text', text: 'Preparing to fetch updates...' });
    const progressBar = D.el('div', { class: 'e621x-stats-progress-fill' });
    const progressTrack = D.el('div', { class: 'e621x-stats-progress-track' }, [progressBar]);

    const btnStopView = D.button({
      text: 'Stop & View',
      title: 'Stop loading more edits and view collected stats',
      className: 'st-button--sm',
      onClick: () => {
        abortFetch = true;
        progressText.textContent = 'Stopping and displaying collected stats...';
      }
    });

    const btnCancel = D.button({
      text: 'Cancel',
      className: 'st-button--sm',
      onClick: closeModal
    });

    const progressBox = D.el('div', { class: 'e621x-stats-progress-box' }, [
      progressText,
      progressTrack,
      D.el('div', { class: 'e621x-stats-progress-actions' }, [btnStopView, btnCancel])
    ]);

    // 3. Summary Cards
    const summaryCardVersions = D.el('div', { class: 'e621x-stats-summary-card' }, [
      D.el('span', { class: 'e621x-stats-summary-num', text: '0' }),
      D.el('span', { class: 'e621x-stats-summary-lbl', text: 'Total Versions' })
    ]);
    const summaryCardPosts = D.el('div', { class: 'e621x-stats-summary-card' }, [
      D.el('span', { class: 'e621x-stats-summary-num', text: '0' }),
      D.el('span', { class: 'e621x-stats-summary-lbl', text: 'Unique Posts' })
    ]);
    const summaryCardAdded = D.el('div', { class: 'e621x-stats-summary-card' }, [
      D.el('span', { class: 'e621x-stats-summary-num e621x-color-add', text: '0' }),
      D.el('span', { class: 'e621x-stats-summary-lbl', text: 'Tags Added' })
    ]);
    const summaryCardRemoved = D.el('div', { class: 'e621x-stats-summary-card' }, [
      D.el('span', { class: 'e621x-stats-summary-num e621x-color-rem', text: '0' }),
      D.el('span', { class: 'e621x-stats-summary-lbl', text: 'Tags Removed' })
    ]);
    const summaryCardPool = D.el('div', { class: 'e621x-stats-summary-card' }, [
      D.el('span', { class: 'e621x-stats-summary-num', text: '0' }),
      D.el('span', { class: 'e621x-stats-summary-lbl', text: 'Tags in Posts' })
    ]);

    const summaryBar = D.el('div', { class: 'e621x-stats-summary-bar hidden', style: 'display: none;' }, [
      summaryCardVersions,
      summaryCardPosts,
      summaryCardAdded,
      summaryCardRemoved,
      summaryCardPool
    ]);

    // 4. Controls Toolbar
    const inputSearch = D.el('input', {
      type: 'text',
      class: 'st-input e621x-stats-search',
      placeholder: 'Filter tags by name...',
      autocomplete: 'off'
    });

    const selectSort = D.el('select', { class: 'st-select e621x-stats-select' }, [
      D.el('option', { value: 'added_desc', text: 'Sort by: Most Added (↓)' }),
      D.el('option', { value: 'added_asc', text: 'Sort by: Least Added (↑)' }),
      D.el('option', { value: 'removed_desc', text: 'Sort by: Most Removed (↓)' }),
      D.el('option', { value: 'removed_asc', text: 'Sort by: Least Removed (↑)' }),
      D.el('option', { value: 'posts_desc', text: 'Sort by: Most in Posts (↓)' }),
      D.el('option', { value: 'date_desc', text: 'Sort by: Date (Most Recent)' }),
      D.el('option', { value: 'date_asc', text: 'Sort by: Date (Oldest First)' }),
      D.el('option', { value: 'name_asc', text: 'Sort by: Name (A-Z)' })
    ]);

    const selectAction = D.el('select', { class: 'st-select e621x-stats-select' }, [
      D.el('option', { value: 'all', text: 'All Tag Changes' }),
      D.el('option', { value: 'added_only', text: 'Added Only (>0)' }),
      D.el('option', { value: 'added_or_removed', text: 'Added or Removed (>0)' }),
      D.el('option', { value: 'removed_only', text: 'Removed Only (>0)' }),
      D.el('option', { value: 'both', text: 'Both Added & Removed' })
    ]);

    const selectUploadType = D.el('select', { class: 'st-select e621x-stats-select' }, [
      D.el('option', { value: 'all', text: 'All (Uploads & Edits)' }),
      D.el('option', { value: 'uploads_only', text: 'Uploads Only' }),
      D.el('option', { value: 'non_uploads', text: 'Non-Uploads Only' })
    ]);

    const selectCat = D.el('select', { class: 'st-select e621x-stats-select' }, [
      D.el('option', { value: 'all', text: 'All Categories' }),
      ...Object.entries(CATEGORY_NAMES).map(([val, label]) =>
        D.el('option', { value: val, text: label }))
    ]);

    const btnExportCsv = D.button({
      text: 'Export CSV',
      className: 'st-button--sm',
      title: 'Download tag statistics as CSV'
    });

    const btnRefresh = D.button({
      text: 'Re-fetch',
      className: 'st-button--sm',
      title: 'Clear cache and re-fetch all versions from API'
    });

    const toolbar = D.el('div', { class: 'e621x-stats-toolbar hidden', style: 'display: none;' }, [
      D.el('div', { class: 'e621x-stats-toolbar-group' }, [
        inputSearch,
        selectSort,
        selectAction,
        selectUploadType,
        selectCat
      ]),
      D.el('div', { class: 'e621x-stats-toolbar-group' }, [
        btnExportCsv,
        btnRefresh
      ])
    ]);

    // 5. Table Container
    const tableBody = D.el('tbody');
    const table = D.el('table', { class: 'e621x-stats-table' }, [
      D.el('thead', {}, [
        D.el('tr', {}, [
          D.el('th', { style: 'width: 32%', text: 'Tag' }),
          D.el('th', { style: 'width: 14%', text: 'Category' }),
          D.el('th', { style: 'width: 13%', text: 'Times Added' }),
          D.el('th', { style: 'width: 13%', text: 'Times Removed' }),
          D.el('th', { style: 'width: 13%', text: 'In Edited Posts' }),
          D.el('th', { style: 'width: 15%', text: 'Last Activity' })
        ])
      ]),
      tableBody
    ]);

    const tableWrap = D.el('div', { class: 'e621x-stats-table-wrap hidden', style: 'display: none;' }, [table]);

    // 6. Pagination Footer
    const pageInfo = D.el('span', { class: 'e621x-stats-page-info', text: 'Showing 0 tags' });
    const btnPrev = D.button({ text: '« Prev', className: 'st-button--sm', disabled: true });
    const btnNext = D.button({ text: 'Next »', className: 'st-button--sm', disabled: true });

    const paginationBar = D.el('div', { class: 'e621x-stats-pagination hidden', style: 'display: none;' }, [
      pageInfo,
      D.el('div', { class: 'e621x-stats-pagination-buttons' }, [btnPrev, btnNext])
    ]);

    dialog.append(header, progressBox, summaryBar, toolbar, tableWrap, paginationBar);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    // Keydown listener to close modal on Escape
    function handleKeydown(e) {
      if (e.key === 'Escape') {
        closeModal();
      }
    }

    document.addEventListener('keydown', handleKeydown);
    let activeDataset = null;
    let renderId = 0;
    let isFetchingMissing = false;

    async function renderActiveTable() {
      if (!activeDataset) return;
      const currentRenderId = ++renderId;

      const {
        statsMap,
        totalVersions = 0,
        uploadVersions = 0,
        editVersions = 0,
        uniquePosts = 0,
        uniquePostsAll = uniquePosts,
        uniquePostsUpload = 0,
        uniquePostsEdit = 0
      } = activeDataset;

      // Map metrics according to the selected upload scope
      let tags = Array.from(statsMap.values()).map(s => {
        if (filterUploadType === 'uploads_only') {
          return {
            name: s.name,
            added: s.uploadAdded || 0,
            removed: s.uploadRemoved || 0,
            inPosts: s.uploadInPosts || 0,
            firstDate: s.uploadFirstDate || 0,
            lastDate: s.uploadLastDate || 0
          };
        }
        if (filterUploadType === 'non_uploads') {
          return {
            name: s.name,
            added: s.editAdded || 0,
            removed: s.editRemoved || 0,
            inPosts: s.editInPosts || 0,
            firstDate: s.editFirstDate || 0,
            lastDate: s.editLastDate || 0
          };
        }
        return {
          name: s.name,
          added: s.added || 0,
          removed: s.removed || 0,
          inPosts: s.inPosts || 0,
          firstDate: s.firstDate || 0,
          lastDate: s.lastDate || 0
        };
      });

      // Synchronize Summary Cards with the active upload scope
      let totalAddedCount = 0;
      let totalRemovedCount = 0;
      let totalInPostsCount = 0;

      for (const s of tags) {
        if (s.added > 0) totalAddedCount++;
        if (s.removed > 0) totalRemovedCount++;
        if (s.inPosts > 0) totalInPostsCount++;
      }

      let displayedVersions = totalVersions;
      let displayedPosts = uniquePostsAll;
      if (filterUploadType === 'uploads_only') {
        displayedVersions = uploadVersions;
        displayedPosts = uniquePostsUpload;
      } else if (filterUploadType === 'non_uploads') {
        displayedVersions = editVersions;
        displayedPosts = uniquePostsEdit;
      }

      const numVersionsEl = summaryCardVersions.querySelector('.e621x-stats-summary-num');
      if (numVersionsEl) numVersionsEl.textContent = (displayedVersions || 0).toLocaleString();

      const numPostsEl = summaryCardPosts.querySelector('.e621x-stats-summary-num');
      if (numPostsEl) numPostsEl.textContent = (displayedPosts || 0).toLocaleString();

      const numAddedEl = summaryCardAdded.querySelector('.e621x-stats-summary-num');
      if (numAddedEl) numAddedEl.textContent = totalAddedCount.toLocaleString();

      const numRemovedEl = summaryCardRemoved.querySelector('.e621x-stats-summary-num');
      if (numRemovedEl) numRemovedEl.textContent = totalRemovedCount.toLocaleString();

      const numPoolEl = summaryCardPool.querySelector('.e621x-stats-summary-num');
      if (numPoolEl) numPoolEl.textContent = totalInPostsCount.toLocaleString();

      // Text Search
      if (filterQuery) {
        tags = tags.filter(t => t.name.includes(filterQuery));
      }

      // Action Filter
      if (filterAction === 'added_only') {
        tags = tags.filter(t => t.added > 0);
      } else if (filterAction === 'added_or_removed') {
        tags = tags.filter(t => t.added > 0 || t.removed > 0);
      } else if (filterAction === 'removed_only') {
        tags = tags.filter(t => t.removed > 0);
      } else if (filterAction === 'both') {
        tags = tags.filter(t => t.added > 0 && t.removed > 0);
      }

      // Category Filter
      if (filterCategory !== 'all') {
        const catNum = Number(filterCategory);
        tags = tags.filter(t => (tagCategoryCache.get(t.name) ?? 0) === catNum);
      }

      // Sorting
      tags.sort((a, b) => {
        switch (sortKey) {
          case 'added_desc':
            return (b.added - a.added) || (b.inPosts - a.inPosts) || a.name.localeCompare(b.name);
          case 'added_asc':
            return (a.added - b.added) || (a.inPosts - b.inPosts) || a.name.localeCompare(b.name);
          case 'removed_desc':
            return (b.removed - a.removed) || (b.inPosts - a.inPosts) || a.name.localeCompare(b.name);
          case 'removed_asc':
            return (a.removed - b.removed) || (a.inPosts - b.inPosts) || a.name.localeCompare(b.name);
          case 'posts_desc':
            return (b.inPosts - a.inPosts) || (b.added - a.added) || a.name.localeCompare(b.name);
          case 'date_desc':
            return (b.lastDate - a.lastDate) || (b.added - a.added);
          case 'date_asc':
            return (a.firstDate - b.firstDate) || (a.lastDate - b.lastDate);
          case 'name_asc':
            return a.name.localeCompare(b.name);
          default:
            return 0;
        }
      });

      const totalMatching = tags.length;
      const totalPages = Math.max(1, Math.ceil(totalMatching / PAGE_SIZE));
      if (currentPage > totalPages) currentPage = totalPages;
      if (currentPage < 1) currentPage = 1;

      const startIdx = (currentPage - 1) * PAGE_SIZE;
      const pageItems = tags.slice(startIdx, startIdx + PAGE_SIZE);

      // Lock pagination controls while categories are being fetched
      btnPrev.disabled = true;
      btnNext.disabled = true;

      const visibleNames = pageItems.map(p => p.name);
      const missing = visibleNames.filter(t => !tagCategoryCache.has(t));
      if (missing.length > 0) {
        isFetchingMissing = true;
        try {
          await fetchMissingCategories(visibleNames);
        } finally {
          isFetchingMissing = false;
        }
        // Discard stale renders triggered by fast filter or page changes
        if (currentRenderId !== renderId) return;
      }

      tableBody.replaceChildren();

      if (!pageItems.length) {
        const emptyRow = D.el('tr', {}, [
          D.el('td', { colspan: '6', class: 'e621x-stats-empty', text: 'No tags match the selected filters.' })
        ]);
        tableBody.appendChild(emptyRow);
      } else {
        pageItems.forEach(item => {
          const cat = tagCategoryCache.get(item.name) ?? 0;
          const catClass = `e621x-tag-type-${cat}`;
          const catName = CATEGORY_NAMES[cat] || 'General';

          const tagLink = D.el('a', {
            href: `/posts?tags=${encodeURIComponent(item.name)}`,
            target: '_blank',
            rel: 'noopener',
            class: `e621x-stats-tag-link ${catClass}`,
            text: item.name
          });

          const catBadge = D.el('span', {
            class: `e621x-cat-badge ${catClass}`,
            text: catName
          });

          const versionParam = filterUploadType === 'uploads_only' ? '&search[version]=1' : '';
          const addedLink = item.added > 0 ? D.el('a', {
            href: `/post_versions?search[updater_id]=${userId}&search[tags_added]=${encodeURIComponent(item.name)}${versionParam}`,
            target: '_blank',
            rel: 'noopener',
            class: 'e621x-stats-count-link e621x-color-add',
            title: `View edits where ${userName} added ${item.name}`,
            text: `+${item.added}`
          }) : D.el('span', { class: 'e621x-stats-count-zero', text: '0' });

          const removedLink = item.removed > 0 ? D.el('a', {
            href: `/post_versions?search[updater_id]=${userId}&search[tags_removed]=${encodeURIComponent(item.name)}`,
            target: '_blank',
            rel: 'noopener',
            class: 'e621x-stats-count-link e621x-color-rem',
            title: `View edits where ${userName} removed ${item.name}`,
            text: `-${item.removed}`
          }) : D.el('span', { class: 'e621x-stats-count-zero', text: '0' });

          const inPostsLink = item.inPosts > 0 ? D.el('a', {
            href: `/post_versions?search[updater_id]=${userId}&search[tags]=${encodeURIComponent(item.name)}${versionParam}`,
            target: '_blank',
            rel: 'noopener',
            class: 'e621x-stats-count-link',
            title: `View edits on posts containing ${item.name}`,
            text: String(item.inPosts)
          }) : D.el('span', { class: 'e621x-stats-count-zero', text: '0' });

          const row = D.el('tr', { class: 'e621x-stats-row' }, [
            D.el('td', {}, [tagLink]),
            D.el('td', {}, [catBadge]),
            D.el('td', {}, [addedLink]),
            D.el('td', {}, [removedLink]),
            D.el('td', {}, [inPostsLink]),
            D.el('td', { class: 'e621x-stats-date', text: formatShortDate(item.lastDate) })
          ]);

          tableBody.appendChild(row);
        });
      }

      // Pagination status and boundaries
      pageInfo.textContent = `Showing ${Math.min(totalMatching, startIdx + 1)}–${Math.min(totalMatching, startIdx + PAGE_SIZE)} of ${totalMatching} tags`;
      btnPrev.disabled = currentPage <= 1;
      btnNext.disabled = currentPage >= totalPages;
    }

    // Attach control listeners
    inputSearch.addEventListener('input', () => {
      filterQuery = inputSearch.value.trim().toLowerCase();
      currentPage = 1;
      renderActiveTable();
    });

    selectSort.addEventListener('change', () => {
      sortKey = selectSort.value;
      currentPage = 1;
      renderActiveTable();
    });

    selectAction.addEventListener('change', () => {
      filterAction = selectAction.value;
      currentPage = 1;
      renderActiveTable();
    });

    selectUploadType.addEventListener('change', () => {
      filterUploadType = selectUploadType.value;
      currentPage = 1;
      renderActiveTable();
    });

    selectCat.addEventListener('change', () => {
      filterCategory = selectCat.value;
      currentPage = 1;
      renderActiveTable();
    });

    btnPrev.addEventListener('click', () => {
      if (isFetchingMissing) return;
      if (currentPage > 1) {
        currentPage--;
        renderActiveTable();
        tableWrap.scrollTop = 0;
      }
    });

    btnNext.addEventListener('click', () => {
      if (isFetchingMissing) return;
      currentPage++;
      renderActiveTable();
      tableWrap.scrollTop = 0;
    });

    btnExportCsv.addEventListener('click', () => {
      if (!activeDataset) return;
      const rows = [
        ['Tag', 'Category', 'Added Count', 'Removed Count', 'Posts Count', 'Last Activity Date']
      ];
      Array.from(activeDataset.statsMap.values()).forEach(s => {
        let added = s.added;
        let removed = s.removed;
        let inPosts = s.inPosts;
        let lastDate = s.lastDate;

        if (filterUploadType === 'uploads_only') {
          added = s.uploadAdded;
          removed = s.uploadRemoved;
          inPosts = s.uploadInPosts;
          lastDate = s.uploadLastDate;
        } else if (filterUploadType === 'non_uploads') {
          added = s.editAdded;
          removed = s.editRemoved;
          inPosts = s.editInPosts;
          lastDate = s.editLastDate;
        }

        const cat = CATEGORY_NAMES[tagCategoryCache.get(s.name) ?? 0] || 'General';
        rows.push([
          `"${s.name.replace(/"/g, '""')}"`,
          `"${cat}"`,
          added,
          removed,
          inPosts,
          `"${formatShortDate(lastDate)}"`
        ]);
      });
      const csvContent = rows.map(r => r.join(',')).join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      U.downloadBlob(blob, `tag_stats_user_${userId}_${filterUploadType}_${Date.now()}.csv`);
    });

    btnRefresh.addEventListener('click', () => {
      userStatsCache.delete(userId);
      startFetch();
    });

    // 7. Data Fetching and Processing Engine
    async function startFetch() {
      if (userStatsCache.has(userId)) {
        activeDataset = userStatsCache.get(userId);
        finishAndDisplay();
        return;
      }

      abortFetch = false;
      progressBox.classList.remove('hidden');
      progressBox.style.display = '';

      summaryBar.classList.add('hidden');
      summaryBar.style.display = 'none';
      toolbar.classList.add('hidden');
      toolbar.style.display = 'none';
      tableWrap.classList.add('hidden');
      tableWrap.style.display = 'none';
      paginationBar.classList.add('hidden');
      paginationBar.style.display = 'none';

      const statsMap = new Map();
      const uniquePostsAll = new Set();
      const uniquePostsUpload = new Set();
      const uniquePostsEdit = new Set();
      let totalVersions = 0;
      let uploadVersions = 0;
      let editVersions = 0;
      let lowestId = null;
      let pageNum = 1;
      const PAGE_LIMIT = 320;

      const getStat = (name) => {
        let stat = statsMap.get(name);
        if (!stat) {
          stat = {
            name,
            // Combined totals
            added: 0,
            removed: 0,
            inPosts: 0,
            postIds: new Set(),
            firstDate: 0,
            lastDate: 0,
            // Uploads only (version === 1)
            uploadAdded: 0,
            uploadRemoved: 0,
            uploadInPosts: 0,
            uploadPostIds: new Set(),
            uploadFirstDate: 0,
            uploadLastDate: 0,
            // Non-uploads only (version > 1)
            editAdded: 0,
            editRemoved: 0,
            editInPosts: 0,
            editPostIds: new Set(),
            editFirstDate: 0,
            editLastDate: 0
          };
          statsMap.set(name, stat);
        }
        return stat;
      };

      const updateProgressUi = (currentCount, currentPg) => {
        if (expectedTotal > 0) {
          const denominator = Math.max(expectedTotal, currentCount);
          const pct = Math.min(100, Math.round((currentCount / denominator) * 100));
          progressBar.style.width = `${pct}%`;
          progressText.textContent = `Fetching post updates: ${currentCount.toLocaleString()} / ${expectedTotal.toLocaleString()} (${pct}%) — page ${currentPg}...`;
        } else {
          const pct = Math.min(95, currentPg * 8);
          progressBar.style.width = `${pct}%`;
          progressText.textContent = `Fetching post updates: ${currentCount.toLocaleString()} loaded — page ${currentPg}...`;
        }
      };

      // Set initial progress
      updateProgressUi(0, 1);

      try {
        while (!abortFetch) {
          let url = `/post_versions.json?search[updater_id]=${userId}&limit=${PAGE_LIMIT}`;
          if (lowestId !== null) {
            url += `&page=b${lowestId}`;
          }

          const data = await Net.fetchJson(url);
          const list = Array.isArray(data) ? data : (data?.post_versions || []);
          if (!list.length) break;

          for (const v of list) {
            totalVersions++;
            const postId = Number(v.post_id || v.id);
            const isUpload = Number(v.version) === 1;

            if (isUpload) {
              uploadVersions++;
              if (postId) uniquePostsUpload.add(postId);
            } else {
              editVersions++;
              if (postId) uniquePostsEdit.add(postId);
            }
            if (postId) uniquePostsAll.add(postId);

            const vId = Number(v.id);
            if (vId && (lowestId === null || vId < lowestId)) {
              lowestId = vId;
            }

            const dateStr = v.updated_at || v.created_at;
            const time = dateStr ? new Date(dateStr).getTime() : 0;

            const added = extractTags(v.added_tags || v.tags_added);
            const removed = extractTags(v.removed_tags || v.tags_removed);
            const inPost = extractTags(v.tags);

            added.forEach(tag => {
              const s = getStat(tag);
              s.added++;
              if (time > s.lastDate) s.lastDate = time;
              if (!s.firstDate || time < s.firstDate) s.firstDate = time;

              if (isUpload) {
                s.uploadAdded++;
                if (time > s.uploadLastDate) s.uploadLastDate = time;
                if (!s.uploadFirstDate || time < s.uploadFirstDate) s.uploadFirstDate = time;
              } else {
                s.editAdded++;
                if (time > s.editLastDate) s.editLastDate = time;
                if (!s.editFirstDate || time < s.editFirstDate) s.editFirstDate = time;
              }
            });

            removed.forEach(tag => {
              const s = getStat(tag);
              s.removed++;
              if (time > s.lastDate) s.lastDate = time;
              if (!s.firstDate || time < s.firstDate) s.firstDate = time;

              if (isUpload) {
                s.uploadRemoved++;
                if (time > s.uploadLastDate) s.uploadLastDate = time;
                if (!s.uploadFirstDate || time < s.uploadFirstDate) s.uploadFirstDate = time;
              } else {
                s.editRemoved++;
                if (time > s.editLastDate) s.editLastDate = time;
                if (!s.editFirstDate || time < s.editFirstDate) s.editFirstDate = time;
              }
            });

            inPost.forEach(tag => {
              const s = getStat(tag);
              if (postId) {
                s.postIds.add(postId);
                if (isUpload) s.uploadPostIds.add(postId);
                else s.editPostIds.add(postId);
              }
              if (time > s.lastDate) s.lastDate = time;
              if (!s.firstDate || time < s.firstDate) s.firstDate = time;

              if (isUpload) {
                if (time > s.uploadLastDate) s.uploadLastDate = time;
                if (!s.uploadFirstDate || time < s.uploadFirstDate) s.uploadFirstDate = time;
              } else {
                if (time > s.editLastDate) s.editLastDate = time;
                if (!s.editFirstDate || time < s.editFirstDate) s.editFirstDate = time;
              }
            });
          }

          // Immediately update progress bar with the real loaded versions count
          updateProgressUi(totalVersions, pageNum);

          if (list.length < PAGE_LIMIT) break;
          pageNum++;
        }
      } catch (err) {
        if (!abortFetch) {
          U.logWarn(`fetch user edits #${userId}`, err);
          progressText.textContent = `Warning: Fetch stopped early (${err.message}). Showing loaded results.`;
          await U.sleep(1000);
        }
      }

      // Compute inPosts counts
      for (const stat of statsMap.values()) {
        stat.inPosts = stat.postIds.size;
        stat.uploadInPosts = stat.uploadPostIds.size;
        stat.editInPosts = stat.editPostIds.size;
      }

      activeDataset = {
        statsMap,
        totalVersions,
        uploadVersions,
        editVersions,
        uniquePosts: uniquePostsAll.size,
        uniquePostsAll: uniquePostsAll.size,
        uniquePostsUpload: uniquePostsUpload.size,
        uniquePostsEdit: uniquePostsEdit.size
      };

      userStatsCache.set(userId, activeDataset);
      finishAndDisplay();
    }

    function finishAndDisplay() {
      if (!activeDataset) return;

      // Hide progress box and reveal dashboard
      progressBox.classList.add('hidden');
      progressBox.style.display = 'none';

      summaryBar.classList.remove('hidden');
      summaryBar.style.display = '';
      toolbar.classList.remove('hidden');
      toolbar.style.display = '';
      tableWrap.classList.remove('hidden');
      tableWrap.style.display = '';
      paginationBar.classList.remove('hidden');
      paginationBar.style.display = '';

      renderActiveTable();
    }

    startFetch();
  }

  // ==========================================
  // SPECIFIC POST EDITS FILTER (EXISTING)
  // ==========================================
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
      showStatus('Counting edits...');

      try {
        let total = 0;
        let page = 1;
        const PAGE_LIMIT = 320;
        const MAX_PAGES = 100;

        while (page <= MAX_PAGES && isCounting) {
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
      removeStatus();
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
      className: 'st-button--sm',
      onClick: handleNavigate
    });

    const btnCount = D.button({
      text: 'Count',
      title: 'Count edits matching these tags via API',
      className: 'st-button--sm',
      onClick: handleCount
    });

    const btnClear = D.button({
      text: 'Clear',
      title: 'Clear all fields and remove results',
      className: 'st-button--sm',
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
    seedCategoryCache();

    const userId = getProfileUserId();
    if (!userId) return;

    if (document.getElementById(FORM_CONTAINER_ID)) return;

    const form = createForm(userId);
    const postVersionLink = document.querySelector('a[href*="/post_versions"]');
    const changesLine = postVersionLink?.closest('.profile-line');

    if (changesLine) {
      const triggerForm = D.el('a', {
        role: 'button',
        class: 'e621x-specific-edits-trigger',
        text: 'view specific post edits',
        onClick: (e) => {
          e.preventDefault();
          toggleForm(form);
        }
      });

      const triggerStats = D.el('a', {
        role: 'button',
        class: 'e621x-specific-edits-trigger',
        text: 'view tag update statistics',
        onClick: (e) => {
          e.preventDefault();
          openTagStatsModal(userId);
        }
      });

      const sep = D.el('span', { class: 'e621x-trigger-sep', text: '·' });

      const triggersRow = D.el('div', { class: 'e621x-specific-edits-triggers-row' }, [
        triggerForm,
        sep,
        triggerStats
      ]);

      const wrapper = D.el('div', { class: 'e621x-specific-edits-wrapper' }, [
        triggersRow,
        form
      ]);
      changesLine.appendChild(wrapper);
    }
  }

  return { init: inject, openTagStatsModal };
});