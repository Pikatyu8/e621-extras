/* Staff AI Heuristics Analyzer (Port of e621ng AiMethods)
 * Analyzes image headers, EXIF, XMP, C2PA manifests, and PNG text chunks. */
E621X.define('aiHeuristics', ['utils', 'selectors', 'net', 'dom'], (U, SEL, Net, D) => {
  'use strict';
  const { STORAGE_KEYS: KEYS, ACTIONS } = E621_CONSTANTS;

  const AI_GENERATORS = [
    'novelai', 'nai', 'stable diffusion', 'sdxl', 'automatic1111', 'a1111',
    'comfyui', 'invokeai', 'midjourney', 'dall·e', 'dall-e', 'openai',
    'bing image creator', 'firefly', 'adobe generative fill', 'adobe firefly',
    'leonardo', 'playground', 'google generative ai', 'synthid'
  ];

  const SD_TOKENS = [
    'negative prompt:', 'steps:', 'sampler:', 'cfg scale:', 'model hash',
    'hires fix', 'denoising strength', 'clip skip', 'refiner:',
    '"sampler":', '"seed":', '"model":', '"workflow":', 'sd-metadata',
    'comfy', 'parameters:', 'seed:', 'sampler:', 'cfg:', 'hires:'
  ];

  const C2PA_TOKENS = ['c2pa.org', 'jumbf', 'manifeststore', 'c2pa'];
  const CAMERA_TOKENS = ['Make', 'Model', 'DateTimeOriginal', 'ExposureTime', 'FNumber', 'ISO'];

  function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function buildTokenRegex(tokens) {
    const patterns = tokens.map(token => {
      if (token.includes(' ') || /[^a-z0-9]/i.test(token)) {
        return escapeRegex(token);
      }
      return `\\b${escapeRegex(token)}\\b`;
    });
    return new RegExp(patterns.join('|'), 'i');
  }

  const AI_GENERATORS_REGEX = buildTokenRegex(AI_GENERATORS);
  const SD_TOKENS_REGEX = buildTokenRegex(SD_TOKENS);
  const C2PA_TOKENS_REGEX = buildTokenRegex(C2PA_TOKENS);
  const C2PA_AI_SOURCE_REGEX = /trainedalgorithmicmedia/i;

  function base64ToUint8Array(base64) {
    const binary = atob(base64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  async function inflateZlib(bytes) {
    if (typeof DecompressionStream === 'undefined') return '';
    try {
      const ds = new DecompressionStream('deflate');
      const writer = ds.writable.getWriter();
      writer.write(bytes);
      writer.close();
      const reader = ds.readable.getReader();
      const chunks = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
      const totalLen = chunks.reduce((acc, c) => acc + c.length, 0);
      const out = new Uint8Array(totalLen);
      let offset = 0;
      for (const c of chunks) {
        out.set(c, offset);
        offset += c.length;
      }
      return new TextDecoder('utf-8', { fatal: false }).decode(out);
    } catch (_) {
      return '';
    }
  }

  async function parseMetadata(bytes, fileExt) {
    let pngTextBlob = '';
    let exifData = '';
    let xmpData = '';
    let jpegComment = '';
    let c2paBlob = '';

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    if (fileExt === 'png') {
      let offset = 8;
      const textChunks = [];

      while (offset + 8 <= bytes.length) {
        const length = view.getUint32(offset, false);
        offset += 4;
        const type = String.fromCharCode(
          bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]
        );
        offset += 4;

        if (type === 'IEND' || type === 'IDAT') break;
        if (offset + length > bytes.length) break;

        const chunkData = bytes.subarray(offset, offset + length);

        if (type === 'tEXt') {
          const nullIdx = chunkData.indexOf(0);
          if (nullIdx !== -1) {
            const key = new TextDecoder('latin1').decode(chunkData.subarray(0, nullIdx));
            const val = new TextDecoder('latin1').decode(chunkData.subarray(nullIdx + 1));
            textChunks.push(`${key}: ${val}`);
          }
        } else if (type === 'zTXt') {
          const nullIdx = chunkData.indexOf(0);
          if (nullIdx !== -1 && nullIdx + 2 < chunkData.length) {
            const key = new TextDecoder('latin1').decode(chunkData.subarray(0, nullIdx));
            const inflated = await inflateZlib(chunkData.subarray(nullIdx + 2));
            if (inflated) textChunks.push(`${key}: ${inflated}`);
          }
        } else if (type === 'iTXt') {
          const nullIdx1 = chunkData.indexOf(0);
          if (nullIdx1 !== -1 && nullIdx1 + 3 < chunkData.length) {
            const key = new TextDecoder('utf-8').decode(chunkData.subarray(0, nullIdx1));
            const compFlag = chunkData[nullIdx1 + 1];
            const nullIdx2 = chunkData.indexOf(0, nullIdx1 + 3);
            if (nullIdx2 !== -1) {
              const nullIdx3 = chunkData.indexOf(0, nullIdx2 + 1);
              if (nullIdx3 !== -1) {
                const textBytes = chunkData.subarray(nullIdx3 + 1);
                if (compFlag === 1) {
                  const inflated = await inflateZlib(textBytes);
                  if (inflated) textChunks.push(`${key}: ${inflated}`);
                } else {
                  const text = new TextDecoder('utf-8').decode(textBytes);
                  textChunks.push(`${key}: ${text}`);
                }
              }
            }
          }
        } else if (type === 'caBX') {
          c2paBlob += new TextDecoder('latin1').decode(chunkData);
        } else if (type === 'eXIf') {
          exifData += new TextDecoder('latin1').decode(chunkData);
        }

        offset += length + 4;
      }
      pngTextBlob = textChunks.join('\n');
    } else if (fileExt === 'jpg' || fileExt === 'jpeg') {
      let offset = 2;
      const comments = [];

      while (offset + 4 <= bytes.length) {
        if (bytes[offset] !== 0xFF) {
          offset++;
          continue;
        }
        const marker = bytes[offset + 1];
        offset += 2;

        if (marker === 0xDA || marker === 0xD9) break;
        if (marker === 0xD8) continue;

        const length = view.getUint16(offset, false);
        if (length < 2 || offset + length > bytes.length) break;
        const payload = bytes.subarray(offset + 2, offset + length);

        if (marker === 0xFE) {
          comments.push(new TextDecoder('latin1').decode(payload));
        } else if (marker === 0xE1) {
          const head = new TextDecoder('latin1').decode(payload.subarray(0, 32));
          if (head.startsWith('Exif\0\0')) {
            exifData += new TextDecoder('latin1').decode(payload.subarray(6));
          } else if (head.startsWith('http://ns.adobe.com/xap/1.0/\0')) {
            xmpData += new TextDecoder('utf-8').decode(payload.subarray(29));
          }
        } else if (marker === 0xEB) {
          const str = new TextDecoder('latin1').decode(payload);
          if (str.startsWith('JP')) {
            c2paBlob += str;
          }
        }

        offset += length;
      }
      jpegComment = comments.join('\n');
    }

    return { pngTextBlob, exifData, xmpData, jpegComment, c2paBlob };
  }

  function calculateScore(meta, fileExt) {
    const isPng = fileExt === 'png';
    const isJpeg = fileExt === 'jpg' || fileExt === 'jpeg';
    const c2paText = meta.c2paBlob.toLowerCase();
    const xmpDataLower = meta.xmpData.toLowerCase();

    const combinedText = [
      meta.pngTextBlob,
      meta.exifData,
      meta.xmpData,
      meta.jpegComment,
      meta.c2paBlob
    ].join('\n').toLowerCase();

    let score = 0;
    const reasons = [];

    if (C2PA_TOKENS_REGEX.test(xmpDataLower) || C2PA_TOKENS_REGEX.test(c2paText)) {
      score += 80;
      reasons.push('c2pa manifest present');
    }

    if (C2PA_AI_SOURCE_REGEX.test(c2paText)) {
      score += 60;
      reasons.push('c2pa declares ai source');
    }

    const genMatch = combinedText.match(AI_GENERATORS_REGEX);
    if (genMatch) {
      score += 70;
      reasons.push(`ai generator: ${genMatch[0]}`);
    }

    if (SD_TOKENS_REGEX.test(combinedText)) {
      score += 60;
      reasons.push('ai parameter tokens found');
    }

    if (isPng && (/(^|[^a-z])parameters\s*:/i.test(meta.pngTextBlob) || /\bDream\b/i.test(meta.pngTextBlob))) {
      score += 20;
      reasons.push('png text markers');
    }

    if (isJpeg &&
        !AI_GENERATORS_REGEX.test(combinedText) &&
        !SD_TOKENS_REGEX.test(combinedText) &&
        CAMERA_TOKENS.some(t => meta.exifData.includes(t))) {
      score -= 30;
      reasons.push('camera exif present');
    }

    score = Math.max(0, Math.min(100, score));

    return {
      score,
      reason: score <= 0 ? 'no ai signals' : Array.from(new Set(reasons)).join('; '),
      rawText: meta.pngTextBlob || meta.jpegComment || meta.xmpData || ''
    };
  }

  async function applyAiGeneratedTag(postId, reason) {
    try {
      U.showToast('Adding ai_generated tag...');
      const res = await Net.sendForm(`/posts/${postId}.json`, 'PATCH', {
        'post[tag_string_diff]': 'ai_generated',
        'post[edit_reason]': `AI Heuristics: ${reason}`
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      U.showToast('Tag ai_generated added successfully!');
      setTimeout(() => location.reload(), 800);
    } catch (err) {
      U.showToast(`Failed to add tag: ${err.message}`, true);
    }
  }

  const findInfoItem = (prefix) =>
    Array.from(document.querySelectorAll(SEL.postInfoItems)).find(li =>
      li.textContent.trim().toLowerCase().startsWith(prefix));

  async function inspectPostPage() {
    if (document.getElementById('post-info-extra-ai')) return;

    const container = document.querySelector(SEL.imageContainer);
    const postId = container?.dataset?.id || U.getPostIdFromPage();

    let fileUrl = container?.dataset?.fileUrl || container?.dataset?.largeFileUrl;
    if (!fileUrl) {
      const dlLink = document.querySelector('#post-info-size a, #image-container a, a[href*="/data/"]');
      if (dlLink?.href) fileUrl = dlLink.href;
    }
    if (!fileUrl) {
      const img = document.querySelector('#image');
      if (img?.src) fileUrl = img.src;
    }

    // Insert loading row into post information list immediately
    const li = D.el('li', { id: 'post-info-extra-ai', class: 'e621x-ai-row' }, [
      D.el('span', { class: 'e621x-ai-label', text: 'AI Check: ' }),
      D.el('span', { class: 'e621x-ai-badge e621x-ai-badge--loading', text: 'Analyzing...' })
    ]);

    const targetLi = findInfoItem('uploader:') || findInfoItem('posted:');
    if (targetLi) {
      targetLi.insertAdjacentElement('afterend', li);
    } else {
      const lists = document.querySelectorAll(SEL.postInfoLists);
      if (lists.length) lists[lists.length - 1].appendChild(li);
      else document.querySelector('#post-information')?.appendChild(li);
    }

    if (!fileUrl || !postId) {
      li.replaceChildren(
        D.el('span', { class: 'e621x-ai-label', text: 'AI Check: ' }),
        D.el('span', { class: 'e621x-ai-badge e621x-ai-badge--error', text: 'No image source' })
      );
      return;
    }

    // Parse clean extension without query parameters or hash
    let fileExt = (container?.dataset?.fileExt || '').toLowerCase();
    if (!fileExt) {
      const cleanUrl = fileUrl.split('#')[0].split('?')[0];
      const match = cleanUrl.match(/\.([a-z0-9]+)$/i);
      if (match) fileExt = match[1].toLowerCase();
    }

    if (!['png', 'jpg', 'jpeg', 'gif'].includes(fileExt)) {
      li.replaceChildren(
        D.el('span', { class: 'e621x-ai-label', text: 'AI Check: ' }),
        D.el('span', { class: 'e621x-ai-badge', text: `Unsupported (${fileExt || 'unknown'})` })
      );
      return;
    }

    try {
      const res = await chrome.runtime.sendMessage({
        action: ACTIONS.CHECK_AI_HEURISTICS,
        url: fileUrl
      });

      if (!res?.ok || !res.base64Data) {
        li.replaceChildren(
          D.el('span', { class: 'e621x-ai-label', text: 'AI Check: ' }),
          D.el('span', { class: 'e621x-ai-badge e621x-ai-badge--error', text: res?.error || 'Analysis failed' })
        );
        return;
      }

      const bytes = base64ToUint8Array(res.base64Data);
      const meta = await parseMetadata(bytes, fileExt);
      const result = calculateScore(meta, fileExt);

      const hasAiTag = (container?.dataset?.tags || '').split(/\s+/).includes('ai_generated') ||
                       document.querySelector('#tag-list .tag-type-general a[href*="ai_generated"]') !== null;

      li.replaceChildren();
      li.appendChild(D.el('span', { class: 'e621x-ai-label', text: 'AI Check: ' }));

      if (result.score >= 50) {
        const badgeClass = hasAiTag ? 'e621x-ai-badge--flagged' : 'e621x-ai-badge--danger';
        const badgeText = hasAiTag
          ? `AI Detected (${result.score}%) · Tagged`
          : `⚠️ AI Detected (${result.score}%) · UNTAGGED`;

        const badge = D.el('span', { class: `e621x-ai-badge ${badgeClass}`, text: badgeText });
        const reasonEl = D.el('div', { class: 'e621x-ai-reasons', text: result.reason });

        const actions = D.el('div', { class: 'e621x-ai-actions' });

        if (!hasAiTag) {
          const btnAddTag = D.button({
            text: '+ ai_generated',
            className: 'e621x-ai-btn',
            title: 'Tag this post as ai_generated immediately',
            onClick: () => applyAiGeneratedTag(postId, result.reason)
          });
          actions.appendChild(btnAddTag);
        }

        const btnCopy = D.button({
          text: 'Copy Reason',
          className: 'e621x-ai-btn',
          title: 'Copy AI detection note to clipboard',
          onClick: () => {
            navigator.clipboard.writeText(`AI score: ${result.score}%\n${result.reason}`);
            U.showToast('AI note copied to clipboard!');
          }
        });
        actions.appendChild(btnCopy);

        if (result.rawText) {
          const btnToggle = D.button({
            text: 'Prompt/Meta',
            className: 'e621x-ai-btn',
            onClick: () => {
              const box = li.querySelector('.e621x-ai-raw');
              if (box) box.classList.toggle('hidden');
            }
          });
          actions.appendChild(btnToggle);
        }

        li.append(badge, reasonEl, actions);

        if (result.rawText) {
          const rawBox = D.el('pre', {
            class: 'e621x-ai-raw hidden',
            text: result.rawText.slice(0, 4000)
          });
          li.appendChild(rawBox);
        }
      } else if (result.score > 0) {
        const badge = D.el('span', {
          class: 'e621x-ai-badge e621x-ai-badge--warning',
          text: `Possible AI (${result.score}%)`
        });
        const reasonEl = D.el('div', { class: 'e621x-ai-reasons', text: result.reason });
        li.append(badge, reasonEl);
      } else {
        const badge = D.el('span', { class: 'e621x-ai-badge e621x-ai-badge--clean', text: 'Clean (0%)' });
        li.appendChild(badge);
      }
    } catch (err) {
      U.logWarn('AI Heuristics check error', err);
    }
  }

  async function init() {
    const enabled = await U.storageGet(KEYS.AI_HEURISTICS_ENABLED, true);
    if (!enabled) return;

    if (/^\/posts\/\d+/i.test(location.pathname)) {
      inspectPostPage();
    }
  }

  return { init, calculateScore, parseMetadata };
});