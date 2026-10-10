E621X.define('tree',
  ['utils', 'selectors', 'dom', 'layout', 'thumbnail', 'treeData', 'treeExport'],
  (U, SEL, D, Layout, Thumb, TreeData, TreeExport) => {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const FIRST_DRAW_DELAY_MS = 60;
  let closeActiveModal = null;

  // ---------- building blocks ----------
  function createModalShell(targetPostId) {
    const titleSpan = D.el('span', { class: 'e621x-tree-title', text: `Post Tree (#${targetPostId})` });
    const btnExportJson = D.button({ text: 'Export JSON', icon: 'download' });
    const btnExportSvg = D.button({ text: 'Export SVG', icon: 'download' });
    const closeBtn = D.el('button', {
      type: 'button', class: 'e621x-tree-close st-button kinetic', text: '×', 'aria-label': 'Close'
    });
    const contentArea = D.el('div', { class: 'e621x-tree-content' }, [
      D.el('div', { class: 'e621x-tree-message', text: 'Loading full dependency tree...' })
    ]);
    const dialog = D.el('div', { class: 'e621x-tree-dialog', role: 'dialog', 'aria-modal': 'true' }, [
      D.el('div', { class: 'e621x-tree-titlebar' }, [
        titleSpan,
        D.el('div', { class: 'e621x-tree-toolbar' }, [btnExportJson, btnExportSvg, closeBtn])
      ]),
      contentArea
    ]);
    const overlay = D.el('div', { class: 'e621x-tree-overlay' });
    return { overlay, dialog, titleSpan, btnExportJson, btnExportSvg, closeBtn, contentArea };
  }

  /* Breadth-first: tiers[i] holds generation i+1 as { node, parentNode }. */
  function buildTiers(rootNode) {
    const tiers = [];
    const queue = [{ node: rootNode, parentNode: null, gen: 1 }];
    while (queue.length) {
      const { node, parentNode, gen } = queue.shift();
      (tiers[gen - 1] ||= []).push({ node, parentNode });
      node.children.forEach(child => queue.push({ node: child, parentNode: node, gen: gen + 1 }));
    }
    return tiers;
  }

  const createDivider = (gen, count) => D.el('div', { class: 'e621x-tree-divider' }, [
    D.el('div', { class: 'e621x-tree-divider-line' }),
    D.el('span', { class: 'e621x-tree-divider-label', text: `Generation ${gen} (${count})` }),
    D.el('div', { class: 'e621x-tree-divider-line' })
  ]);

  function bindLineHighlight(card, postId, svgCanvas) {
    const id = String(postId);
    card.addEventListener('mouseenter', () => {
      svgCanvas.querySelectorAll('path').forEach(p => {
        const related = p.dataset.from === id || p.dataset.to === id;
        p.classList.toggle('is-active', related);
        p.classList.toggle('is-dim', !related);
      });
    });
    card.addEventListener('mouseleave', () => {
      svgCanvas.querySelectorAll('path').forEach(p => p.classList.remove('is-active', 'is-dim'));
    });
  }

  function createLineDrawer(treeContainer, svgCanvas, lineConnections) {
    return function drawLines() {
      svgCanvas.replaceChildren();
      const containerRect = treeContainer.getBoundingClientRect();
      const width = Math.max(treeContainer.scrollWidth, treeContainer.offsetWidth);
      const height = Math.max(treeContainer.scrollHeight, treeContainer.offsetHeight);
      svgCanvas.setAttribute('width', width);
      svgCanvas.setAttribute('height', height);

      for (const { fromEl, toEl, fromId, toId } of lineConnections) {
        const f = fromEl.getBoundingClientRect();
        const t = toEl.getBoundingClientRect();
        const x1 = f.left + f.width / 2 - containerRect.left;
        const y1 = f.bottom - containerRect.top + 16;
        const x2 = t.left + t.width / 2 - containerRect.left;
        const y2 = t.top - containerRect.top - 16;
        const midY = (y1 + y2) / 2;

        const path = document.createElementNS(SVG_NS, 'path');
        path.setAttribute('class', 'e621x-tree-line');
        path.setAttribute('d', `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`);
        path.dataset.from = String(fromId);
        path.dataset.to = String(toId);
        svgCanvas.appendChild(path);
      }
    };
  }

  function renderTree(shell, tree, disposer, getLayout) {
    const { rootId, postsMap, warnings } = tree;
    const rootNode = TreeData.buildHierarchy(rootId, postsMap);
    if (!rootNode) throw new Error('Root post is missing');

    const incomplete = warnings.length ? `, incomplete: ${warnings.length} request(s) failed` : '';
    shell.titleSpan.textContent = `Post Tree: Root #${rootId} (${postsMap.size} posts in tree${incomplete})`;
    if (warnings.length) U.logWarn('tree', warnings.join('; '));

    const treeContainer = D.el('div', { class: 'e621x-tree' });
    const svgCanvas = document.createElementNS(SVG_NS, 'svg');
    svgCanvas.setAttribute('class', 'e621x-tree-lines');
    treeContainer.appendChild(svgCanvas);

    const cardMap = new Map();
    const renderedCards = [];
    const lineConnections = [];
    const tiers = buildTiers(rootNode);

    tiers.forEach((tierItems, index) => {
      const gen = index + 1;
      const cardsRow = D.el('div', { class: 'e621x-tree-cards' });

      for (const { node, parentNode } of tierItems) {
        const hasParent = Boolean(parentNode);
        const hasChildren = node.children.length > 0;
        const card = Thumb.createThumbnail(node.post, { layout: getLayout(), gen, hasParent, hasChildren, enablePins: true });
        bindLineHighlight(card, node.post.id, svgCanvas);
        cardsRow.appendChild(card);
        cardMap.set(node.post.id, card);
        renderedCards.push({ card, post: node.post, gen, hasParent, hasChildren });
      }

      treeContainer.appendChild(
        D.el('div', { class: 'e621x-tree-tier', 'data-gen': gen }, [createDivider(gen, tierItems.length), cardsRow])
      );
    });

    for (const tierItems of tiers) {
      for (const { node, parentNode } of tierItems) {
        if (!parentNode) continue;
        const fromEl = cardMap.get(parentNode.post.id);
        const toEl = cardMap.get(node.post.id);
        if (fromEl && toEl) lineConnections.push({ fromEl, toEl, fromId: parentNode.post.id, toId: node.post.id });
      }
    }

    treeContainer.appendChild(D.el('div', { class: 'e621x-tree-spacer' }));
    shell.contentArea.replaceChildren(treeContainer);

    const drawLines = createLineDrawer(treeContainer, svgCanvas, lineConnections);

    shell.btnExportJson.onclick = () => TreeExport.exportTreeToJson(rootNode, postsMap, rootId);
    shell.btnExportSvg.onclick = async () => {
      shell.btnExportSvg.disabled = true;
      try {
        await TreeExport.exportTreeToSvg({
          treeContainer, renderedCards, lineConnections, rootId, isContain: getLayout().isContain
        });
      } catch (err) {
        U.showToast(`SVG export failed: ${err.message}`, true);
      } finally {
        shell.btnExportSvg.disabled = false;
      }
    };

    // everything below is released by the disposer when the modal closes
    const resizeObserver = new ResizeObserver(drawLines);
    resizeObserver.observe(treeContainer);
    disposer.add(() => resizeObserver.disconnect());

    window.addEventListener('resize', drawLines);
    disposer.add(() => window.removeEventListener('resize', drawLines));

    const timer = setTimeout(drawLines, FIRST_DRAW_DELAY_MS);
    disposer.add(() => clearTimeout(timer));

    return drawLines;
  }

  // ---------- public: open modal ----------
  async function openPostTreeModal(targetPostId) {
    closeActiveModal?.();

    const disposer = U.createDisposer();
    const shell = createModalShell(targetPostId);
    let layout = Layout.getLayoutSettings();
    Layout.applyLayoutVars(shell.dialog, layout);
    document.body.append(shell.overlay, shell.dialog);

    const close = () => disposer.run();
    closeActiveModal = close;
    disposer.add(() => { if (closeActiveModal === close) closeActiveModal = null; });
    disposer.add(() => { shell.overlay.remove(); shell.dialog.remove(); });

    shell.closeBtn.addEventListener('click', close);
    shell.overlay.addEventListener('click', close);

    const onKeydown = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKeydown);
    disposer.add(() => document.removeEventListener('keydown', onKeydown));

    try {
      const tree = await TreeData.fetchFullTree(targetPostId);
      if (disposer.isDisposed()) return; // closed while loading
      const drawLines = renderTree(shell, tree, disposer, () => layout);

      disposer.add(Layout.onLayoutSettingsChange((next) => {
        layout = next;
        Layout.applyLayoutVars(shell.dialog, next);
        drawLines();
      }));
    } catch (err) {
      if (disposer.isDisposed()) return;
      U.logWarn('tree', err);
      shell.contentArea.replaceChildren(
        D.el('div', { class: 'e621x-tree-message e621x-tree-message--error', text: `Error loading tree: ${err.message}` })
      );
    }
  }

  // ---------- "show post tree" button next to parent/child notices ----------
  function setupPageNoticeTreeButton() {
    document.querySelector(SEL.parentChildren)?.classList.add('e621x-notice-row');

    const notices = document.querySelectorAll(SEL.relationNotices);
    if (!notices.length) return;
    notices.forEach(n => n.classList.add('e621x-notice-inline'));

    if (document.getElementById('btn-show-post-tree')) return;
    const currentPostId = U.getPostIdFromPage();
    if (!currentPostId) return;

    const treeBtn = D.button({
      text: 'show post tree',
      className: 'e621x-tree-btn',
      onClick: (e) => { e.preventDefault(); openPostTreeModal(currentPostId); }
    });
    treeBtn.id = 'btn-show-post-tree';
    notices[notices.length - 1].appendChild(treeBtn);
  }

  return { init: setupPageNoticeTreeButton, open: openPostTreeModal };
});