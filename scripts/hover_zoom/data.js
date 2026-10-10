/* Data extraction and formatting helpers for Hover Zoom. */
E621X.define('hoverZoomData', [], () => {
  'use strict';

  const PLACEHOLDER_IMG = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';

  const clamp = (val, min, max) => Math.min(Math.max(val, min), max);

  function parsePostFromElement(el) {
    if (!el) return null;

    // Skip main post image/video on individual post pages
    if (el.classList?.contains('fit-window') || el.closest('.fit-window, #image-container')) {
      return null;
    }

    const thumb = el.closest('article.thumbnail, .post-preview, div.post-thumbnail, [data-id]');
    if (!thumb || thumb.id === 'image-container' || thumb.closest('#image-container, .fit-window')) {
      return null;
    }

    const d = thumb.dataset || {};
    const id = Number(d.id || thumb.getAttribute('data-id'));
    if (!id) return null;

    const fileUrl = d.fileUrl || '';
    const sampleUrl = d.sampleUrl || d.largeFileUrl || fileUrl;
    const previewUrl = d.previewUrl || d.previewFileUrl || thumb.querySelector('img')?.src || '';

    // Extract file extension from dataset or URL
    let ext = (d.fileExt || '').toLowerCase();
    if (!ext && sampleUrl) {
      const match = sampleUrl.match(/\.([a-z0-9]+)(?:\?|$)/i);
      if (match) ext = match[1].toLowerCase();
    }

    return {
      id,
      ext,
      isVideo: ext === 'webm' || ext === 'mp4',
      isDeleted: d.flags?.includes('deleted') || thumb.classList.contains('post-status-deleted'),
      sampleUrl,
      previewUrl,
      fileUrl,
      element: thumb
    };
  }

  return {
    PLACEHOLDER_IMG,
    clamp,
    parsePostFromElement
  };
});