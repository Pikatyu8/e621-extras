E621X.define('thumbnail', ['utils', 'dom', 'layout'], (U, D, Layout) => {
  'use strict';
  const { el, icon, formatCount, formatDate } = D;

  function createPin(position, gen) {
    return el('div', {
      class: `e621x-pin e621x-pin--${position}`,
      title: `Generation ${gen}`,
      text: gen
    });
  }

  function createStat(extraClass, iconName, value) {
    return el('span', { class: `thm-desc-m ${extraClass}` }, [icon(iconName, 16), ` ${value}`]);
  }

  /* Builds a card in the site's own thumbnail markup (so site CSS/JS treat it as native).
   * Card size and object-fit come from CSS variables set by the container (Layout.applyLayoutVars). */
  function createThumbnail(post, options = {}) {
    const {
      layout = Layout.getLayoutSettings(),
      gen = 1,
      hasParent = false,
      hasChildren = false,
      enablePins = true
    } = options;

    const rating = (post.rating || 's').toLowerCase();
    const ratingClass = rating === 's' ? 'rating-safe' : (rating === 'q' ? 'rating-questionable' : 'rating-explicit');
    const allTags = U.getPostTagString(post);
    let flagsStr = '';
    if (Array.isArray(post.flags)) {
      flagsStr = post.flags.join(' ');
    } else if (typeof post.flags === 'string') {
      flagsStr = post.flags;
    } else if (post.flags && typeof post.flags === 'object') {
      flagsStr = Object.entries(post.flags).filter(([, v]) => Boolean(v)).map(([k]) => k).join(' ');
    }

    const ext = post.file?.ext || post.file_ext || post.fileExt || 'jpg';
    const fallbackUrl = U.siteUrl('/images/download-preview.png');
    const rawPreviewUrl = post.preview?.url || post.preview_url || post.previewUrl || '';
    const hasPreview = Boolean(rawPreviewUrl && ext !== 'swf');
    const previewUrl = hasPreview ? rawPreviewUrl : fallbackUrl;
    const isDataUrl = previewUrl.startsWith('data:');
    const previewWebp = (hasPreview && !isDataUrl) ? previewUrl.replace(/\.[a-zA-Z0-9]+$/, '.webp') : null;

    const score = (typeof post.score === 'object' && post.score !== null)
      ? (post.score.total ?? 0)
      : (Number(post.score) || 0);
    const favCount = post.fav_count ?? post.favCount ?? 0;
    const commentCount = post.comment_count ?? post.commentCount ?? 0;

    const isDeleted = flagsStr.includes('deleted');
    const isFlagged = flagsStr.includes('flagged');
    const isPending = flagsStr.includes('pending');
    const statusStr = isDeleted ? 'deleted' : (isFlagged ? 'flagged' : (isPending ? 'pending' : 'active'));
    const vote = post.own_vote ?? post.vote ?? 0;

    const hasParentPost = hasParent || Boolean(post.relationships?.parent_id || post.has_parent || post.hasParent);
    const hasChildrenPost = hasChildren || Boolean(post.relationships?.has_children || post.has_children || post.hasChildren);

    const hoverText = `Rating: ${rating}\nID: ${post.id}\nDate: ${formatDate(post.created_at)}\nStatus: ${statusStr}\nScore: ${score}\n\n${allTags}`;

    const img = el('img', {
      class: 'thm-img-thumb',
      src: previewUrl,
      alt: `post #${post.id}`,
      fetchpriority: 'high'
    });
    img.addEventListener('error', () => {
      if (!img.src.startsWith('data:')) img.src = fallbackUrl;
    }, { once: true });

    const pictureChildren = [];
    if (previewWebp) {
      pictureChildren.push(el('source', { type: 'image/webp', srcset: previewWebp }));
    }
    if (!isDataUrl) {
      pictureChildren.push(el('source', { type: `image/${ext === 'png' ? 'png' : 'jpeg'}`, srcset: previewUrl }));
    }
    pictureChildren.push(img);

    const picture = el('picture', {}, pictureChildren);

    const link = el('a', {
      class: 'thm-link',
      href: `/posts/${post.id}`,
      target: '_blank',
      rel: 'noopener',
      title: hoverText,
      'data-hover-text': hoverText,
      'data-file-ext': ext
    }, [
      picture,
      layout.showRibbons && hasParentPost && el('div', { class: 'ribbon left', title: 'Has a parent post.' }),
      layout.showRibbons && hasChildrenPost && el('div', { class: 'ribbon right', title: 'Has children.' })
    ]);

    const isNegative = score < 0;
    const scoreClass = isNegative ? 'thm-score-negative' : (score > 0 ? 'thm-score-positive' : '');

    const desc = el('div', { class: `thm-desc thm-rating-${rating}` }, [
      el('span', { class: 'thm-desc-a' }, [
        createStat(`thm-score ${scoreClass}`, isNegative ? 'arrow_down_dash' : 'arrow_up_dash', formatCount(Math.abs(score))),
        createStat('thm-favorites', 'star', formatCount(favCount)),
        createStat('thm-comments', 'messages_square', formatCount(commentCount))
      ]),
      el('span', { class: 'thm-desc-b thm-rating', text: rating.toUpperCase() })
    ]);

    return el('article', {
      class: `thumbnail e621x-thumb ${ratingClass} filter-matches`,
      'data-id': post.id,
      'data-flags': flagsStr,
      'data-tags': allTags,
      'data-rating': rating,
      'data-file-ext': ext,
      'data-width': post.file?.width ?? post.width ?? 0,
      'data-height': post.file?.height ?? post.height ?? 0,
      'data-size': post.file?.size ?? post.size ?? 0,
      'data-created-at': JSON.stringify(post.created_at || ''),
      'data-uploader': post.uploader || '',
      'data-uploader-id': post.uploader_id ?? post.uploaderId ?? '',
      'data-score': score,
      'data-fav-count': favCount,
      'data-is-favorited': String(Boolean(post.is_favorited)),
      'data-vote': String(vote),
      'data-comment-count': commentCount,
      'data-pools': Array.isArray(post.pools) ? post.pools.join(' ') : (post.pools || ''),
      'data-md5': post.file?.md5 || post.md5 || '',
      'data-preview-url': previewUrl,
      'data-preview-webp': previewWebp || '',
      'data-sample-url': post.sample?.url || post.sample_url || '',
      'data-file-url': post.file?.url || post.file_url || '',
      'data-preview-width': post.preview?.width ?? 0,
      'data-preview-height': post.preview?.height ?? 0
    }, [
      enablePins && hasParentPost && createPin('top', gen),
      enablePins && hasChildrenPost && createPin('bottom', gen),
      link,
      desc
    ]);
  }

  return { createThumbnail };
});