E621X.define('dtext', ['dom'], (D) => {
  'use strict';
  const { escapeHtml } = D;

  /* Safe client-side DText parser (escapes before formatting to prevent XSS). */
  function parseDText(rawText) {
    if (!rawText) return '';

    let text = String(rawText).replace(/\r\n?/g, '\n');
    const blocks = [];
    const inlineCodes = [];

    const stashBlock = (html) => {
      blocks.push(html);
      return `\n\n\u0000B${blocks.length - 1}\u0000\n\n`;
    };

    // 1. [code] blocks
    text = text.replace(/\[code\]([\s\S]*?)\[\/code\]/gi, (_, code) =>
      stashBlock(`<pre class="dtext-code"><code>${escapeHtml(code.trim())}</code></pre>`));

    // 2. Inline `code`
    text = text.replace(/`([^`\n]+)`/g, (_, code) => {
      inlineCodes.push(`<code class="inline-code">${escapeHtml(code)}</code>`);
      return `\u0000C${inlineCodes.length - 1}\u0000`;
    });

    // 3. Escape everything remaining
    text = escapeHtml(text);

    // 4. [quote] tags -> structural markers
    text = text
      .replace(/\[quote(?:=[^\]]+)?\]/gi, '\n\u0000Q_OPEN\u0000\n')
      .replace(/\[\/quote\]/gi, '\n\u0000Q_CLOSE\u0000\n');

    // 5. Inline styles
    text = text
      .replace(/\[b\]([\s\S]*?)\[\/b\]/gi, '<strong>$1</strong>')
      .replace(/\[i\]([\s\S]*?)\[\/i\]/gi, '<em>$1</em>')
      .replace(/\[s\]([\s\S]*?)\[\/s\]/gi, '<s>$1</s>')
      .replace(/\[u\]([\s\S]*?)\[\/u\]/gi, '<u>$1</u>');

    // 6. Links (handles optional [brackets] for both full and relative URLs)
    text = text
      .replace(/&quot;((?:(?!&quot;).)+)&quot;:\[?(https?:\/\/[^\s\]<]+)\]?/g,
        (_, label, url) => `<a href="${url}" rel="nofollow noreferrer" target="_blank">${label}</a>`)
      .replace(/&quot;((?:(?!&quot;).)+)&quot;:\[?(\/(?!\/)[^\s\]<]*)\]?/g,
        (_, label, path) => `<a href="${path}">${label}</a>`)
      .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g,
        (_, title, label) => `<a href="/wiki_pages/show_or_new?title=${encodeURIComponent(title)}">${label}</a>`)
      .replace(/\[\[([^\]]+)\]\]/g,
        (_, title) => `<a href="/wiki_pages/show_or_new?title=${encodeURIComponent(title)}">${title}</a>`)
      .replace(/\bpost #(\d+)/gi, '<a href="/posts/$1">post #$1</a>')
      .replace(/\buser #(\d+)/gi, '<a href="/users/$1">user #$1</a>')
      .replace(/\btopic #(\d+)/gi, '<a href="/forum_topics/$1">topic #$1</a>');

    // 7. Structural line parsing: headers, lists, quotes, paragraphs
    const result = [];
    let listLevel = 0;
    let paragraph = [];

    const flushParagraph = () => {
      const content = paragraph.join('<br>').trim();
      if (content) result.push(`<p>${content}</p>`);
      paragraph = [];
    };
    const closeList = () => {
      while (listLevel > 0) { result.push('</ul>'); listLevel--; }
    };

    for (const line of text.split('\n')) {
      const trimmed = line.trim();

      if (!trimmed) {
        flushParagraph();
        continue;
      }

      if (trimmed === '\u0000Q_OPEN\u0000') {
        flushParagraph();
        closeList();
        result.push('<blockquote class="dtext-quote">');
        continue;
      }

      if (trimmed === '\u0000Q_CLOSE\u0000') {
        flushParagraph();
        closeList();
        result.push('</blockquote>');
        continue;
      }

      if (/^\u0000B\d+\u0000$/.test(trimmed)) {
        flushParagraph();
        closeList();
        result.push(trimmed);
        continue;
      }

      const header = trimmed.match(/^h([1-6])(?:#([a-zA-Z0-9_-]+))?\.\s+(.*)$/);
      if (header) {
        flushParagraph();
        closeList();
        result.push(`<h${header[1]}${header[2] ? ` id="${header[2]}"` : ''}>${header[3]}</h${header[1]}>`);
        continue;
      }

      const item = trimmed.match(/^(\*+)\s+(.*)$/);
      if (item) {
        flushParagraph();
        while (listLevel < item[1].length) { result.push('<ul>'); listLevel++; }
        while (listLevel > item[1].length) { result.push('</ul>'); listLevel--; }
        result.push(`<li>${item[2]}</li>`);
        continue;
      }

      closeList();
      paragraph.push(trimmed);
    }
    flushParagraph();
    closeList();

    // 8. Restore stashed blocks and inline codes
    return result.join('\n')
      .replace(/\u0000B(\d+)\u0000/g, (_, i) => blocks[Number(i)])
      .replace(/\u0000C(\d+)\u0000/g, (_, i) => inlineCodes[Number(i)]);
  }

  return { parseDText, renderDText: async (text) => parseDText(text) };
});