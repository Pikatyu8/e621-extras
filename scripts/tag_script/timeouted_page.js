E621X.define('timeoutedPage',
  ['utils', 'dom', 'layout', 'thumbnail', 'tagScriptQueue', 'treeData'],
  (U, D, Layout, Thumb, Queue, TreeData) => {
  'use strict';

  const isTimeoutedPage = () => /^\/posts\/timeouted\/?$/i.test(location.pathname);
  let countdownTimer = null;

  function createHeader(queueCount, timing, onProcess, onClear) {
    const isTimeout = timing.isTimeout;
    const statusText = isTimeout
      ? (queueCount > 1
          ? `Next in ${Queue.formatDuration(timing.nextMs)} · All finish in ${Queue.formatDuration(timing.allMs)}`
          : `Next in ${Queue.formatDuration(timing.nextMs)}`)
      : 'Status: Ready to submit';

    const statusPill = D.el('div', {
      id: 'e621x-queue-status-pill',
      class: `e621x-queue-status-pill ${isTimeout ? 'is-timeout' : 'is-ready'}`,
      text: statusText
    });

    const btnProcess = D.button({
      id: 'e621x-btn-process-queue',
      text: 'Process Queue Now',
      primary: true,
      onClick: onProcess
    });
    btnProcess.disabled = queueCount === 0;

    const btnClear = D.button({
      text: 'Clear Queue',
      onClick: onClear
    });
    btnClear.disabled = queueCount === 0;

    return D.el('header', { class: 'e621x-queue-header' }, [
      D.el('div', { class: 'e621x-queue-title-area' }, [
        D.el('h2', {}, [
          'Queued Tag Scripts',
          D.el('span', { class: 'e621x-queue-badge', text: `${queueCount} posts` })
        ]),
        D.el('span', { class: 'e621x-queue-subtitle', text: 'Delayed post edits waiting to be sent to e621' })
      ]),
      D.el('div', { class: 'e621x-queue-actions' }, [
        statusPill,
        btnProcess,
        btnClear
      ])
    ]);
  }

  function startLiveCountdown(untilNext, untilAll, count, onTimeoutElapsed) {
    if (countdownTimer) clearInterval(countdownTimer);
    if (!untilNext || untilNext <= Date.now()) return;

    countdownTimer = setInterval(() => {
      const now = Date.now();
      const nextRemaining = untilNext - now;
      const allRemaining = untilAll - now;
      const pill = document.getElementById('e621x-queue-status-pill');

      if (nextRemaining <= 0) {
        clearInterval(countdownTimer);
        countdownTimer = null;
        if (pill) {
          pill.className = 'e621x-queue-status-pill is-ready';
          pill.textContent = 'Status: Ready to submit';
        }
        if (typeof onTimeoutElapsed === 'function') onTimeoutElapsed();
      } else if (pill) {
        pill.textContent = count > 1
          ? `Next in ${Queue.formatDuration(nextRemaining)} · All finish in ${Queue.formatDuration(allRemaining)}`
          : `Next in ${Queue.formatDuration(nextRemaining)}`;
      }
    }, 1000);
  }

  function createQueueCard(post, queueItem, onRemove) {
    const layout = Layout.getLayoutSettings();
    const card = Thumb.createThumbnail(post, { layout, enablePins: false });
    card.classList.add('e621x-thumb-queued');

    const meta = D.el('div', { class: 'e621x-queue-card-meta' }, [
      D.el('div', { class: 'e621x-queue-diff', title: queueItem.changes, text: queueItem.changes }),
      D.el('div', { class: 'e621x-queue-card-actions' }, [
        D.el('span', { text: queueItem.reason ? `Reason: ${queueItem.reason}` : '' }),
        D.el('button', {
          type: 'button',
          class: 'e621x-queue-remove-btn',
          text: 'Remove',
          onClick: (e) => {
            e.preventDefault();
            e.stopPropagation();
            onRemove(post.id);
          }
        })
      ])
    ]);

    return D.el('div', { class: 'e621x-queue-card-wrap', 'data-post-id': post.id }, [
      card,
      meta
    ]);
  }

  async function renderPage() {
    document.title = 'Queued Tag Scripts - e621';

    let mainContainer = document.querySelector('#c-posts #content, #content, #page, main');
    if (!mainContainer) {
      mainContainer = document.createElement('div');
      document.body.appendChild(mainContainer);
    }

    const pageRoot = D.el('div', { class: 'e621x-queue-page' }, [
      D.el('div', { class: 'e621x-tree-message', text: 'Loading queued posts...' })
    ]);

    mainContainer.replaceChildren(pageRoot);

    const layout = Layout.getLayoutSettings();
    Layout.applyLayoutVars(pageRoot, layout);

    async function refresh() {
      if (countdownTimer) {
        clearInterval(countdownTimer);
        countdownTimer = null;
      }

      const queue = await Queue.getQueue();
      const ids = Object.keys(queue).map(Number).filter(n => Number.isInteger(n) && n > 0);
      const timing = await Queue.getQueueTimingInfo();

      const handleProcess = async () => {
        await Queue.processQueue();
        await refresh();
      };

      const handleClear = async () => {
        if (!confirm('Clear all queued tag scripts?')) return;
        await Queue.clearQueue();
        U.showToast('Queue cleared');
        await refresh();
      };

      const handleRemove = async (postId) => {
        await Queue.dequeue(postId);
        U.showToast(`Post #${postId} removed from queue`);
        await refresh();
      };

      const header = createHeader(ids.length, timing, handleProcess, handleClear);

      if (!ids.length) {
        pageRoot.replaceChildren(
          header,
          D.el('div', { class: 'e621x-queue-empty' }, [
            D.el('h3', { text: 'No tag scripts in queue' }),
            D.el('p', { text: 'When hourly edit limits are active, clicked posts will queue here with a yellow outline.' })
          ])
        );
        return;
      }

      // Check which posts lack metadata
      const missingIds = ids.filter(id => {
        const it = queue[id];
        return !it || it.score === undefined;
      });

      const fetchedMap = new Map();
      if (missingIds.length > 0) {
        pageRoot.replaceChildren(header, D.el('div', { class: 'e621x-tree-message', text: `Caching data for ${missingIds.length} post(s)...` }));
        try {
          const posts = await TreeData.fetchByIds(missingIds);
          for (const p of posts) {
            fetchedMap.set(p.id, p);
            const previewUrl = p.preview?.url || '';
            if (previewUrl) {
              const b64 = await Queue.fetchImageAsBase64(previewUrl);
              if (b64) await Queue.saveImage(p.id, b64);
            }
          }
        } catch (err) {
          U.logWarn('timeouted page fetch missing', err);
        }
      }

      const grid = D.el('div', { class: 'e621x-tree-cards' });

      for (const id of ids) {
        const item = queue[id] || {};
        const fetched = fetchedMap.get(id);
        const storedImage = await Queue.getImage(id);

        const post = fetched || {
          id,
          rating: item.rating || 's',
          score: item.score ?? 0,
          fav_count: item.favCount ?? 0,
          comment_count: item.commentCount ?? 0,
          file: { ext: item.fileExt || 'jpg' },
          tags: item.tags || '',
          flags: item.flags || '',
          has_parent: item.hasParent ?? false,
          has_children: item.hasChildren ?? false,
          preview: { url: storedImage || item.previewUrl || '' }
        };

        grid.appendChild(createQueueCard(post, item, handleRemove));
      }

      pageRoot.replaceChildren(header, grid);

      if (timing.isTimeout) {
        startLiveCountdown(timing.nextSlot, timing.allSlot, ids.length, () => {
          U.showToast('Slot available! Queue ready.');
        });
      }
    }

    await refresh();

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && (changes[E621_CONSTANTS.STORAGE_KEYS.TAG_SCRIPT_QUEUE] || changes[E621_CONSTANTS.STORAGE_KEYS.QUEUE_SLOT_TIMESTAMPS])) {
        refresh();
      }
    });

    Layout.onLayoutSettingsChange((next) => {
      Layout.applyLayoutVars(pageRoot, next);
    });
  }

  async function init() {
    if (isTimeoutedPage()) {
      await renderPage();
    }
  }

  return { init, renderPage };
});
