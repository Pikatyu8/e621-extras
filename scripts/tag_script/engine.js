/* Tag script engine: pure functions, no DOM. Loaded as a content script and by Node tests. */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.E621X.define('tagScriptEngine', [], () => api);
})(globalThis, function () {
  'use strict';

  // ---------- parsing ----------
  function parseIfCommand(cmdStr) {
    if (!cmdStr.startsWith('[') || !cmdStr.endsWith(']')) return null;
    const inner = cmdStr.slice(1, -1).trim();
    if (!inner.startsWith('if')) return null;

    const afterIf = inner.slice(2).trim();
    const commaIdx = afterIf.indexOf(',');
    if (commaIdx === -1) return null;

    return {
      predicate: afterIf.slice(0, commaIdx).trim(),
      action: afterIf.slice(commaIdx + 1).trim()
    };
  }

  // ---------- predicates ----------
  function evaluateSimplePredicate(predicate, post) {
    return (predicate.match(/\S+/g) || []).every(x =>
      x.startsWith('-') ? !post.tagsSet.has(x.slice(1)) : post.tagsSet.has(x));
  }

  // ---------- execution ----------
  /* Returns the tag diff string ('' if nothing changes). */
  function runTagScript(post, scriptContent) {
    const tokens = scriptContent.match(/\[.+?\]|\S+/g) || [];
    let isReset = false;
    const diffs = [];

    for (const cmd of tokens) {
      if (cmd === '[reset]') {
        isReset = true;
        diffs.length = 0;
        continue;
      }

      if (cmd.startsWith('[if')) {
        const parsed = parseIfCommand(cmd);
        if (parsed && evaluateSimplePredicate(parsed.predicate, post)) {
          diffs.push(parsed.action);
        }
        continue;
      }

      diffs.push(cmd);
    }

    if (isReset) {
      return [...Array.from(post.tagsSet, t => `-${t}`), ...diffs].join(' ');
    }
    return diffs.join(' ');
  }

  /* Normalises an API post (/posts/:id.json) into the shape the predicates expect. */
  function postDataFromApi(post) {
    const tagString = typeof post.tag_string === 'string'
      ? post.tag_string
      : Object.values(post.tags || {}).flat().join(' ');

    return {
      id: Number(post.id),
      tagsSet: new Set(tagString.split(/\s+/).filter(Boolean))
    };
  }

  return { runTagScript, postDataFromApi };
});