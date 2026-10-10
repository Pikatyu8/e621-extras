/* Tag script engine: pure functions, no DOM. Loaded as a content script and by Node tests. */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.E621X.define('tagScriptEngine', [], () => api);
})(globalThis, function () {
  'use strict';

  /* Thrown for syntax we cannot evaluate faithfully. The caller must abort rather than guess:
   * a silently wrong predicate means mass-editing the wrong posts. */
  class UnsupportedTermError extends Error {
    constructor(message) {
      super(message);
      this.name = 'UnsupportedTermError';
    }
  }

  // ---------- parsing ----------
  function tokenizeBracketCommands(str) {
    if (!str) return [];
    const tokens = [];
    let current = '';
    let depth = 0;

    for (const char of str) {
      if (char === '[') {
        if (depth === 0 && current.trim()) {
          tokens.push(...current.trim().split(/\s+/));
          current = '';
        }
        depth++;
        current += char;
      } else if (char === ']') {
        depth--;
        current += char;
        if (depth === 0) {
          tokens.push(current.trim());
          current = '';
        }
      } else if (/\s/.test(char) && depth === 0) {
        if (current.trim()) tokens.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    if (current.trim()) tokens.push(...current.trim().split(/\s+/));
    return tokens;
  }

  function parseIfCommand(cmdStr) {
    if (!cmdStr.startsWith('[') || !cmdStr.endsWith(']')) return null;
    const inner = cmdStr.slice(1, -1).trim();
    if (!inner.startsWith('if')) return null;

    const afterIf = inner.slice(2).trim();
    let depth = 0;
    for (let i = 0; i < afterIf.length; i++) {
      const c = afterIf[i];
      if (c === '[') depth++;
      else if (c === ']') depth--;
      else if (c === ',' && depth === 0) {
        return { predicate: afterIf.slice(0, i).trim(), action: afterIf.slice(i + 1).trim() };
      }
    }
    return null;
  }

  // ---------- predicates ----------
  function parseNumber(str) {
    const n = parseFloat(str);
    if (Number.isNaN(n)) throw new UnsupportedTermError(`Invalid number "${str}"`);
    return n;
  }

  function matchNumericRange(val, rangeStr) {
    if (val === undefined || val === null || Number.isNaN(val)) return false;
    const r = rangeStr.trim();
    if (r.startsWith('>=')) return val >= parseNumber(r.slice(2));
    if (r.startsWith('<=')) return val <= parseNumber(r.slice(2));
    if (r.startsWith('>')) return val > parseNumber(r.slice(1));
    if (r.startsWith('<')) return val < parseNumber(r.slice(1));
    if (r.startsWith('=')) return val === parseNumber(r.slice(1));
    if (r.includes('..')) {
      const [minStr, maxStr] = r.split('..');
      return val >= (minStr ? parseNumber(minStr) : -Infinity) && val <= (maxStr ? parseNumber(maxStr) : Infinity);
    }
    return val === parseNumber(r);
  }

  function testMetatag(meta, value, post) {
    switch (meta) {
      case 'rating': return post.rating === value[0];
      case 'score': return matchNumericRange(post.score, value);
      case 'favcount': return matchNumericRange(post.fav_count, value);
      case 'comment_count': return matchNumericRange(post.comment_count, value);
      case 'id': return matchNumericRange(post.id, value);
      case 'width': return matchNumericRange(post.width, value);
      case 'height': return matchNumericRange(post.height, value);
      case 'filesize': return matchNumericRange(post.size, value);
      case 'mpixels': return matchNumericRange((post.width * post.height) / 1000000, value);
      case 'ratio': return matchNumericRange(post.height ? post.width / post.height : 0, value);
      case 'user':
        if (!post.uploader) throw new UnsupportedTermError('Uploader name is unavailable for "user:"');
        return post.uploader === value;
      case 'user_id': return String(post.uploader_id) === value;
      case 'type':
      case 'filetype': return post.file_ext === value;
      case 'pool': return post.pools.includes(parseNumber(value));
      case 'inpool': return (post.pools.length > 0) === (value === 'true');
      case 'status': return post.status === value || post.flags.includes(value);
      case 'is':
      case 'has':
        if (value === 'parent') return post.has_parent;
        if (value === 'children') return post.has_children;
        throw new UnsupportedTermError(`${meta}:${value}`);
      case 'hasparent':
      case 'ischild': return post.has_parent === (value === 'true');
      case 'haschild':
      case 'haschildren':
      case 'isparent': return post.has_children === (value === 'true');
      default:
        throw new UnsupportedTermError(`${meta}:`);
    }
  }

  function evaluateTerm(term, post) {
    const meta = term.match(/^([a-z_]{2,}):(.+)$/i);
    if (meta) {
      const value = meta[2].toLowerCase().replace(/^["']|["']$/g, '');
      return testMetatag(meta[1].toLowerCase(), value, post);
    }
    if (term.includes('*')) {
      const pattern = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '.*');
      const regex = new RegExp(`^${pattern}$`, 'i');
      return Array.from(post.tagsSet).some(t => regex.test(t));
    }
    return post.tagsSet.has(term.toLowerCase());
  }

  function testSingleSearchTerm(term, post) {
    const negated = term.startsWith('-');
    const matches = evaluateTerm(negated ? term.slice(1) : term, post);
    return negated ? !matches : matches;
  }

  function evaluateExtendedPredicate(predicate, post) {
    const tokens = predicate.split(/\s+/).filter(Boolean);
    const orTokens = tokens.filter(t => t.startsWith('~')).map(t => t.slice(1));
    const andTokens = tokens.filter(t => !t.startsWith('~'));

    if (orTokens.length && !orTokens.some(t => testSingleSearchTerm(t, post))) return false;
    return andTokens.every(t => testSingleSearchTerm(t, post));
  }

  function evaluateSimplePredicate(predicate, post) {
    return (predicate.match(/\S+/g) || []).every(x =>
      x.startsWith('-') ? !post.tagsSet.has(x.slice(1)) : post.tagsSet.has(x));
  }

  // ---------- execution ----------
  function processCommand(post, cmd, isExtended) {
    if (cmd === '[reset]') return { isReset: true, diffs: [] };

    if (cmd.startsWith('[if')) {
      const parsed = parseIfCommand(cmd);
      if (!parsed) return { isReset: false, diffs: [] };

      const passed = isExtended
        ? evaluateExtendedPredicate(parsed.predicate, post)
        : evaluateSimplePredicate(parsed.predicate, post);
      if (!passed) return { isReset: false, diffs: [] };

      if (!isExtended) return { isReset: false, diffs: [parsed.action] };

      let isReset = false;
      let diffs = [];
      for (const sub of tokenizeBracketCommands(parsed.action)) {
        const res = processCommand(post, sub, true);
        if (res.isReset) { isReset = true; diffs = []; }
        diffs.push(...res.diffs);
      }
      return { isReset, diffs };
    }

    return { isReset: false, diffs: [cmd] };
  }

  /* Returns the tag diff string ('' if nothing changes). May throw UnsupportedTermError. */
  function runTagScript(post, scriptContent, isExtended) {
    const tokens = isExtended
      ? tokenizeBracketCommands(scriptContent)
      : (scriptContent.match(/\[.+?\]|\S+/g) || []);

    let isReset = false;
    const diffs = [];
    for (const cmd of tokens) {
      const res = processCommand(post, cmd, isExtended);
      if (res.isReset) { isReset = true; diffs.length = 0; }
      diffs.push(...res.diffs);
    }

    if (isReset) {
      return [...Array.from(post.tagsSet, t => `-${t}`), ...diffs].join(' ');
    }
    return diffs.join(' ');
  }

  /* Normalises a full API post (/posts/:id.json) into the shape the predicates expect. */
  function postDataFromApi(post) {
    const tagString = typeof post.tag_string === 'string'
      ? post.tag_string
      : Object.values(post.tags || {}).flat().join(' ');
    const flagsObj = post.flags || {};
    const file = post.file || {};
    const rel = post.relationships || {};

    return {
      id: Number(post.id),
      tagsSet: new Set(tagString.split(/\s+/).filter(Boolean)),
      rating: String(post.rating || 's').toLowerCase(),
      flags: Object.keys(flagsObj).filter(k => flagsObj[k]),
      status: flagsObj.deleted ? 'deleted' : (flagsObj.flagged ? 'flagged' : (flagsObj.pending ? 'pending' : 'active')),
      file_ext: String(file.ext || '').toLowerCase(),
      width: file.width || 0,
      height: file.height || 0,
      size: file.size || 0,
      score: post.score?.total ?? 0,
      fav_count: post.fav_count ?? 0,
      comment_count: post.comment_count ?? 0,
      uploader: String(post.uploader_name || post.uploader || '').toLowerCase(),
      uploader_id: Number(post.uploader_id) || 0,
      pools: (post.pools || []).map(Number),
      has_parent: Boolean(rel.parent_id),
      has_children: Boolean(rel.has_children)
    };
  }

  return { UnsupportedTermError, runTagScript, postDataFromApi, tokenizeBracketCommands };
});