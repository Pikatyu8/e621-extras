E621X.define('treeExport', ['utils', 'dom'], (U, D) => {
  'use strict';
  const { ACTIONS } = E621_CONSTANTS;
  const esc = D.escapeHtml;

  const IMAGE_CONCURRENCY = 6;
  const PADDING = 40;
  const PIN_OFFSET = 16;
  const DESC_HEIGHT = 28;
  const RATING_COLORS = { E: '#e45f5f', Q: '#e4a15f', S: '#5fe476' };

  function exportTreeToJson(rootNode, postsMap, rootId) {
    const serialize = (n) => ({
      id: n.post.id,
      rating: n.post.rating,
      score: n.post.score?.total || 0,
      fav_count: n.post.fav_count || 0,
      comment_count: n.post.comment_count || 0,
      tags: n.post.tags,
      file: n.post.file,
      preview: n.post.preview,
      relationships: n.post.relationships,
      children: n.children.map(serialize)
    });
    const data = {
      rootId,
      exportedAt: new Date().toISOString(),
      totalPosts: postsMap.size,
      tree: serialize(rootNode)
    };
    U.downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), `e621_post_tree_${rootId}.json`);
    U.showToast(`Exported JSON for Tree #${rootId}`);
  }

  /* Image bytes are fetched by the background worker: a content-script fetch is bound by the page's CORS. */
  async function fetchImageAsDataUrl(url) {
    try {
      const res = await chrome.runtime.sendMessage({ action: ACTIONS.FETCH_IMAGE, url });
      if (res?.ok) return res.dataUrl;
      U.logWarn('image fetch', res?.error);
    } catch (err) {
      U.logWarn('image fetch', err);
    }
    return null;
  }

  async function embedImages(renderedCards) {
    const images = new Map();
    await U.mapLimit(renderedCards, IMAGE_CONCURRENCY, async ({ post, card }) => {
      const url = card.dataset.previewUrl;
      if (url) images.set(post.id, await fetchImageAsDataUrl(url));
    });
    return images;
  }

  const relativeRect = (element, containerRect) => {
    const r = element.getBoundingClientRect();
    return { x: r.left - containerRect.left, y: r.top - containerRect.top, w: r.width, h: r.height };
  };

  function renderConnection(from, to) {
    const x1 = from.x + from.w / 2;
    const y1 = from.y + from.h + PIN_OFFSET;
    const x2 = to.x + to.w / 2;
    const y2 = to.y - PIN_OFFSET;
    const midY = (y1 + y2) / 2;
    return `  <path class="tree-line" d="M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}" />\n`;
  }

  function renderCard({ post, gen, hasParent, hasChildren }, rect, imageHref, preserveAspect) {
    const { x, y, w, h } = rect;
    const imgH = h - DESC_HEIGHT;
    const score = post.score?.total || 0;
    const rating = (post.rating || 's').toUpperCase();
    const ratingColor = RATING_COLORS[rating] || RATING_COLORS.S;
    const postUrl = U.siteUrl(`/posts/${post.id}`);

    let svg = `  <g id="card-${post.id}">\n`;
    svg += `    <a href="${esc(postUrl)}" target="_blank">\n`;
    svg += `      <rect class="tree-card-bg" x="${x}" y="${y}" width="${w}" height="${h}" rx="4" />\n`;
    if (imageHref) {
      svg += `      <image href="${esc(imageHref)}" x="${x}" y="${y}" width="${w}" height="${imgH}" preserveAspectRatio="${preserveAspect}" />\n`;
    }
    svg += `      <rect class="tree-desc-bg" x="${x}" y="${y + imgH}" width="${w}" height="${DESC_HEIGHT}" />\n`;
    svg += `      <text class="tree-text" x="${x + 8}" y="${y + imgH + 18}" font-size="11">▲ ${score}  ★ ${post.fav_count || 0}</text>\n`;
    svg += `      <rect x="${x + w - 22}" y="${y + imgH + 6}" width="16" height="16" rx="2" fill="${ratingColor}" />\n`;
    svg += `      <text x="${x + w - 14}" y="${y + imgH + 18}" font-size="10" font-weight="bold" fill="#000" text-anchor="middle">${esc(rating)}</text>\n`;
    svg += `    </a>\n`;
    if (hasParent) {
      svg += `    <circle class="tree-pin-bg" cx="${x + w / 2}" cy="${y - 7}" r="9" />\n`;
      svg += `    <text class="tree-pin-text" x="${x + w / 2}" y="${y - 7}">${gen}</text>\n`;
    }
    if (hasChildren) {
      svg += `    <circle class="tree-pin-bg" cx="${x + w / 2}" cy="${y + h + 7}" r="9" />\n`;
      svg += `    <text class="tree-pin-text" x="${x + w / 2}" y="${y + h + 7}">${gen}</text>\n`;
    }
    return svg + `  </g>\n`;
  }

  const SVG_STYLE = `<style>
      .tree-card-bg { fill: #152f56; stroke: #2a4c7e; stroke-width: 1; }
      .tree-desc-bg { fill: #0a1b32; }
      .tree-text { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; fill: #ffffff; }
      .tree-line { stroke: rgba(255, 255, 255, 0.4); stroke-width: 1.5; fill: none; }
      .tree-pin-bg { fill: #152f56; stroke: #3b6aa0; stroke-width: 2; }
      .tree-pin-text { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; font-size: 10px; font-weight: bold; fill: #ffffff; text-anchor: middle; dominant-baseline: central; }
    </style>\n`;

  async function exportTreeToSvg({ treeContainer, renderedCards, lineConnections, rootId, isContain }) {
    U.showToast('Embedding images into SVG...');
    const images = await embedImages(renderedCards);

    const containerRect = treeContainer.getBoundingClientRect();
    const rects = new Map(renderedCards.map(c => [c.card, relativeRect(c.card, containerRect)]));

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const r of rects.values()) {
      minX = Math.min(minX, r.x);
      minY = Math.min(minY, r.y - 18);
      maxX = Math.max(maxX, r.x + r.w);
      maxY = Math.max(maxY, r.y + r.h + 18);
    }
    const vbX = Math.floor(minX - PADDING);
    const vbY = Math.floor(minY - PADDING);
    const vbW = Math.ceil(maxX - minX + PADDING * 2);
    const vbH = Math.ceil(maxY - minY + PADDING * 2);

    let svg = `<?xml version="1.0" encoding="UTF-8"?>\n`;
    svg += `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vbX} ${vbY} ${vbW} ${vbH}" width="${vbW}" height="${vbH}">\n`;
    svg += SVG_STYLE;
    svg += `<rect x="${vbX}" y="${vbY}" width="${vbW}" height="${vbH}" fill="#0a1322" />\n`;

    svg += `<g id="connections">\n`;
    for (const { fromEl, toEl } of lineConnections) {
      svg += renderConnection(rects.get(fromEl) || relativeRect(fromEl, containerRect), rects.get(toEl) || relativeRect(toEl, containerRect));
    }
    svg += `</g>\n<g id="cards">\n`;

    const preserveAspect = isContain ? 'xMidYMid meet' : 'xMidYMid slice';
    for (const entry of renderedCards) {
      const href = images.get(entry.post.id) || entry.card.dataset.previewUrl || '';
      svg += renderCard(entry, rects.get(entry.card), href, preserveAspect);
    }
    svg += `</g>\n</svg>`;

    U.downloadBlob(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }), `e621_post_tree_${rootId}.svg`);
    U.showToast(`Exported SVG for Tree #${rootId}`);
  }

  return { exportTreeToJson, exportTreeToSvg };
});