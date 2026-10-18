/* Execution engine: applies tag scripts to single posts or bulk selections.
 * In Sticky Keys mode, multiple active tag scripts are combined and executed in a single request. */
E621X.define('tagScriptRunner',
  ['utils', 'selectors', 'net', 'tagScriptEngine', 'tagScriptQueue', 'tagScriptStorage', 'tagScriptLogger'],
  (U, SEL, Net, Engine, Queue, Storage, Log) => {
  'use strict';

  const PLAN_PREVIEW_COUNT = 5;
  const QUEUE_LINK_ID = 'e621x-tag-script-queue-link';

  let bulkRunning = false;
  const inFlight = new Set();
  const updatedPostIds = new Set();
  const lockedPostIds = new Set();

  function onPostStatus(postId, status, error = '') {
    const id = String(postId);
    const thumb = document.querySelector(`article.thumbnail[data-id="${id}"]`);

    if (status === 'updated') {
      updatedPostIds.add(id);
      lockedPostIds.delete(id);
      if (thumb) {
        thumb.classList.remove('e621x-thumb-queued', 'e621x-thumb-locked');
        thumb.classList.add('e621x-thumb-updated');
      }
      U.showToast(`Post #${id} updated`);
    } else if (status === 'locked') {
      lockedPostIds.add(id);
      updatedPostIds.delete(id);
      if (thumb) {
        thumb.classList.remove('e621x-thumb-queued', 'e621x-thumb-updated');
        thumb.classList.add('e621x-thumb-locked');
      }
      U.showToast(`Post #${id} skipped: ${error || 'Locked'}`, true);
    }
  }

  const getScriptField = () =>
    document.getElementById('e621x-tag-script-field') || document.querySelector(SEL.nativeTagScriptField);
  const getReason = () => document.getElementById('e621x-tag-script-reason')?.value || '';

  function readScript() {
    if (Storage.isStickyMode()) {
      const activeSlots = Storage.getActiveStickySlots();
      if (activeSlots.length > 1) {
        return activeSlots
          .slice()
          .sort((a, b) => a - b)
          .map(id => Storage.getStoredScript(id).trim())
          .filter(Boolean)
          .join(' ');
      }
      if (activeSlots.length === 1) {
        return Storage.getStoredScript(activeSlots[0]).trim();
      }
      return '';
    }

    const curId = Storage.getCurrentScriptId();
    if (curId === 10) return '';

    return (getScriptField()?.value ?? Storage.getStoredScript(curId)).trim();
  }

  function postDataFromThumb(thumb) {
    const d = thumb.dataset || {};
    const tags = (d.tags || '').split(/\s+/).filter(Boolean);
    const flags = (d.flags || '').split(/\s+/).filter(Boolean);

    const isDeleted = flags.includes('deleted') || thumb.classList.contains('post-status-deleted');
    const isPending = flags.includes('pending') || thumb.classList.contains('post-status-pending');
    const isFlagged = flags.includes('flagged') || thumb.classList.contains('post-status-flagged');

    return {
      id: Number(d.id || 0),
      tagsSet: new Set(tags),
      rating: String(d.rating || 's').toLowerCase(),
      flags,
      status: isDeleted ? 'deleted' : (isFlagged ? 'flagged' : (isPending ? 'pending' : 'active')),
      file_ext: String(d.fileExt || '').toLowerCase(),
      width: Number(d.width) || 0,
      height: Number(d.height) || 0,
      size: Number(d.size) || 0,
      score: Number(d.score) || 0,
      fav_count: Number(d.favCount) || 0,
      comment_count: Number(d.commentCount) || 0,
      uploader: String(d.uploader || '').toLowerCase(),
      uploader_id: Number(d.uploaderId) || 0,
      pools: (d.pools || '').split(/\s+/).map(Number).filter(n => Number.isInteger(n) && n > 0),
      has_parent: thumb.querySelector('.ribbon.left') !== null || d.hasParent === 'true',
      has_children: thumb.querySelector('.ribbon.right') !== null || d.hasChildren === 'true'
    };
  }

  async function sendTagScript(postId, changes, reason) {
    const res = await Net.sendForm(`/posts/${postId}.json`, 'PATCH', {
      'post[tag_string_diff]': changes,
      'post[edit_reason]': reason
    }, { retries: 1 });
    if (!res.ok) {
      const msg = await Queue.parseErrorBody(res);
      const err = new Error(msg);
      err.status = res.status;
      err.response = res;
      throw err;
    }
    return res.json();
  }

  function applyLocalTagDiff(currentTagString, diffString) {
    const tags = new Set(String(currentTagString || '').split(/\s+/).filter(Boolean));
    const tokens = diffString.split(/\s+/).filter(Boolean);
    for (const token of tokens) {
      if (token.startsWith('-')) {
        tags.delete(token.slice(1).toLowerCase());
      } else if (!token.includes(':')) {
        tags.add(token.toLowerCase());
      }
    }
    return Array.from(tags).join(' ');
  }

  function refreshThumbnail(thumb, postId, responseData, changes) {
    const post = responseData?.post || responseData;
    const tags = U.getPostTagString(post) || (changes ? applyLocalTagDiff(thumb.dataset.tags, changes) : '');

    if (!tags) return false;
    thumb.dataset.tags = tags;

    const ratingMatch = changes?.match(/(?:^|\s)[-+]?rating:([sqe])/i);
    if (ratingMatch) thumb.dataset.rating = ratingMatch[1].toLowerCase();
    else if (post?.rating) thumb.dataset.rating = post.rating;

    return true;
  }

  async function syncQueuedOutlines() {
    const queue = await Queue.getQueue();
    const queuedIds = new Set(Object.keys(queue).map(String));

    document.querySelectorAll(SEL.thumbnail).forEach(thumb => {
      const id = String(thumb.dataset.id);
      const isQueued = queuedIds.has(id);
      const wasQueued = thumb.classList.contains('e621x-thumb-queued');

      if (isQueued) {
        thumb.classList.remove('e621x-thumb-updated', 'e621x-thumb-locked');
        thumb.classList.add('e621x-thumb-queued');
      } else {
        thumb.classList.remove('e621x-thumb-queued');

        // If the post was queued on this page and is now finished, turn outline green
        if (updatedPostIds.has(id) || wasQueued) {
          if (!lockedPostIds.has(id)) {
            thumb.classList.remove('e621x-thumb-locked');
            thumb.classList.add('e621x-thumb-updated');
            updatedPostIds.add(id);
          } else {
            thumb.classList.remove('e621x-thumb-updated');
            thumb.classList.add('e621x-thumb-locked');
          }
        }
      }
    });

    const link = document.getElementById(QUEUE_LINK_ID);
    if (link) {
      const count = queuedIds.size;
      link.textContent = `Queue (${count})`;
      link.classList.toggle('hidden', count === 0 && !(await Queue.isEnabled()));
    }
  }

  async function handleThumbClick(thumb) {
    const postId = thumb.dataset.id;
    Log.click({ target: thumb }, `Thumbnail click for post #${postId}`);
    if (bulkRunning) return U.showToast('A bulk tag script is running — please wait', true);
    if (inFlight.has(postId)) return;

    const script = readScript();
    if (!script) return U.showToast('Tag script is empty', true);

    const postData = postDataFromThumb(thumb);

    if (postData.status === 'deleted' || postData.flags.includes('status_locked')) {
      thumb.classList.remove('e621x-thumb-updated', 'e621x-thumb-queued');
      thumb.classList.add('e621x-thumb-locked');
      const reason = postData.status === 'deleted' ? 'Post is deleted' : 'Post is status locked';
      return U.showToast(`Post #${postId} cannot be edited: ${reason}`, true);
    }

    const changes = Engine.runTagScript(postData, script);
    if (!changes.trim()) return U.showToast(`Post #${postId}: No changes needed`);

    const queueEnabled = await Queue.isEnabled();
    const queueCount = await Queue.getQueueCount();
    const isTimeout = await Queue.isTimeoutActive();

    // If queue is non-empty, do not attempt immediate edit or slot check: append directly to queue
    if (queueEnabled && (queueCount > 0 || isTimeout)) {
      await Queue.enqueueFromThumb(thumb, {
        changes,
        reason: getReason()
      });
      thumb.classList.remove('e621x-thumb-updated', 'e621x-thumb-locked');
      thumb.classList.add('e621x-thumb-queued');
      thumb.dataset.tags = applyLocalTagDiff(thumb.dataset.tags, changes);
      const remMs = await Queue.getRemainingTimeoutMs();
      U.showToast(queueCount > 0
        ? `Added to queue (#${postId}). Position: ${queueCount + 1}`
        : `Hourly limit active. Post #${postId} queued (${Queue.formatDuration(remMs)} left).`);
      await syncQueuedOutlines();
      return;
    }

    inFlight.add(postId);
    try {
      U.showToast(`Updating post #${postId}...`);
      try {
        const data = await sendTagScript(postId, changes, getReason());
        refreshThumbnail(thumb, postId, data, changes);
        thumb.classList.remove('e621x-thumb-queued', 'e621x-thumb-locked');
        thumb.classList.add('e621x-thumb-updated');
        try {
          await Queue.dequeue(postId);
        } catch (_) {
          // Extension might be reloaded; post was already updated successfully
        }
        U.showToast(`Post #${postId} updated`);
      } catch (err) {
        if (queueEnabled && Queue.isHourlyLimitResponse(err.status, err.message)) {
          const check = await Queue.verifyHourlyLimitExceeded();
          if (check.isLimit || err.status === 429) {
            const duration = check.isLimit ? check.nextAvailableMs : (60 * 1000);
            await Queue.setTimeoutUntil(Date.now() + duration);
            await Queue.enqueueFromThumb(thumb, {
              changes,
              reason: getReason()
            });
            thumb.classList.remove('e621x-thumb-updated', 'e621x-thumb-locked');
            thumb.classList.add('e621x-thumb-queued');
            thumb.dataset.tags = applyLocalTagDiff(thumb.dataset.tags, changes);
            U.showToast(`Hourly limit reached. Post #${postId} queued for ${Queue.formatDuration(duration)}.`, true);
            await syncQueuedOutlines();
            return;
          }
        }

        const isLockedMsg = /locked|is deleted|cannot be edited/i.test(err.message);
        let lockReason = isLockedMsg ? err.message : '';
        if (!isLockedMsg) {
          const lockCheck = await Queue.checkPostLockStatus(postId, changes);
          if (lockCheck.isLocked) lockReason = lockCheck.reason;
        }

        if (lockReason) {
          thumb.classList.remove('e621x-thumb-queued', 'e621x-thumb-updated');
          thumb.classList.add('e621x-thumb-locked');
          U.showToast(`Post #${postId} cannot be edited: ${lockReason}`, true);
          return;
        }

        throw err;
      }
    } catch (err) {
      if (/Extension context invalidated/i.test(err.message)) {
        U.showToast('Extension reloaded. Please refresh the page.', true);
      } else {
        U.showToast(`Error #${postId}: ${err.message}`, true);
      }
    } finally {
      inFlight.delete(postId);
    }
  }

  function buildPlan(thumbs, script) {
    const items = [];
    let skipped = 0;

    for (let i = 0; i < thumbs.length; i++) {
      const thumb = thumbs[i];
      try {
        const postData = postDataFromThumb(thumb);
        if (postData.status === 'deleted' || postData.flags.includes('status_locked')) {
          skipped++;
          continue;
        }
        const changes = Engine.runTagScript(postData, script).trim();
        if (changes) items.push({ thumb, id: thumb.dataset.id, changes });
      } catch (err) {
        skipped++;
        U.logWarn(`checking post #${thumb.dataset.id}`, err);
      }
    }
    return { items, skipped };
  }

  function formatPlanSummary(plan, total) {
    const truncate = (s, n) => (s.length > n ? `${s.slice(0, n)}…` : s);
    const lines = [`${plan.items.length} of ${total} posts will be edited.`];
    if (plan.skipped) lines.push(`${plan.skipped} posts could not be checked and will be skipped.`);
    lines.push('');
    plan.items.slice(0, PLAN_PREVIEW_COUNT).forEach(({ id, changes }) => lines.push(`#${id}: ${truncate(changes, 80)}`));
    if (plan.items.length > PLAN_PREVIEW_COUNT) lines.push(`…and ${plan.items.length - PLAN_PREVIEW_COUNT} more`);
    lines.push('', 'Apply the tag script?');
    return lines.join('\n');
  }

  async function applyPlan(items, reason) {
    const queueEnabled = await Queue.isEnabled();
    let updated = 0;
    let errors = 0;

    for (let i = 0; i < items.length; i++) {
      const { thumb, id, changes } = items[i];
      U.showToast(`Applying ${i + 1}/${items.length}...`);
      try {
        const data = await sendTagScript(id, changes, reason);
        refreshThumbnail(thumb, id, data);
        thumb.classList.remove('e621x-thumb-queued', 'e621x-thumb-locked');
        thumb.classList.add('e621x-thumb-updated');
        try {
          await Queue.dequeue(id);
        } catch (_) {
          // Extension might be reloaded; post was already updated successfully
        }
        updated++;
      } catch (err) {
        if (queueEnabled && Queue.isHourlyLimitResponse(err.status, err.message)) {
          const check = await Queue.verifyHourlyLimitExceeded();
          if (check.isLimit || err.status === 429) {
            const duration = check.isLimit ? check.nextAvailableMs : (60 * 1000);

            for (let j = i; j < items.length; j++) {
              const rem = items[j];
              await Queue.enqueueFromThumb(rem.thumb, {
                changes: rem.changes,
                reason
              });
              rem.thumb.classList.remove('e621x-thumb-updated', 'e621x-thumb-locked');
              rem.thumb.classList.add('e621x-thumb-queued');
              rem.thumb.dataset.tags = applyLocalTagDiff(rem.thumb.dataset.tags, rem.changes);
            }

            await Queue.setTimeoutUntil(Date.now() + duration);
            U.showToast(`Limit reached at post #${id}. Queued remaining ${items.length - i} posts (${Queue.formatDuration(duration)} left).`, true);
            await syncQueuedOutlines();
            return;
          }
        }

        const isLockedMsg = /locked|is deleted|cannot be edited/i.test(err.message);
        let lockReason = isLockedMsg ? err.message : '';
        if (!isLockedMsg) {
          const lockCheck = await Queue.checkPostLockStatus(id, changes);
          if (lockCheck.isLocked) lockReason = lockCheck.reason;
        }

        if (lockReason) {
          thumb.classList.remove('e621x-thumb-queued', 'e621x-thumb-updated');
          thumb.classList.add('e621x-thumb-locked');
          U.showToast(`Post #${id} skipped: ${lockReason}`, true);
          errors++;
          continue;
        }

        errors++;
        U.logWarn(`updating post #${id}`, err);
      }
    }
    U.showToast(`Tag Script applied: ${updated} updated${errors ? `, ${errors} errors` : ''}`, errors > 0);
  }

  async function handleApplyAll() {
    Log.action('handleApplyAll', 'Apply all button triggered');
    if (bulkRunning) return;
    const script = readScript();
    if (!script) return U.showToast('Tag script is empty', true);

    const thumbs = Array.from(document.querySelectorAll(SEL.thumbnail));
    if (!thumbs.length) return U.showToast('No posts found on this page', true);

    bulkRunning = true;
    try {
      const plan = await buildPlan(thumbs, script);
      if (!plan) return;
      if (!plan.items.length) return U.showToast('No changes needed');

      const queueEnabled = await Queue.isEnabled();
      const queueCount = await Queue.getQueueCount();
      const isTimeout = await Queue.isTimeoutActive();

      // If queue already has items or timeout is active, enqueue all without checking slots
      if (queueEnabled && (queueCount > 0 || isTimeout)) {
        for (const item of plan.items) {
          await Queue.enqueueFromThumb(item.thumb, {
            changes: item.changes,
            reason: getReason()
          });
          item.thumb.classList.add('e621x-thumb-queued');
          item.thumb.dataset.tags = applyLocalTagDiff(item.thumb.dataset.tags, item.changes);
        }
        U.showToast(`Queued ${plan.items.length} posts`);
        await syncQueuedOutlines();
        return;
      }

      if (!confirm(formatPlanSummary(plan, thumbs.length))) return;
      await applyPlan(plan.items, getReason());
    } catch (err) {
      U.showToast(`Error: ${err.message}`, true);
    } finally {
      bulkRunning = false;
      await syncQueuedOutlines();
    }
  }

  return {
    postDataFromThumb,
    sendTagScript,
    applyLocalTagDiff,
    refreshThumbnail,
    syncQueuedOutlines,
    handleThumbClick,
    handleApplyAll,
    readScript,
    getScriptField,
    getReason,
    onPostStatus
  };
});