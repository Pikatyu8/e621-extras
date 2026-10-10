if (false) {
  E621X.define('tagScriptLogger', ['utils'], (U) => {
    'use strict';

    const LOG_LIMIT = 1000;
    const logs = [];

    function formatLogTime(d = new Date()) {
      const pad = (n, len = 2) => String(n).padStart(len, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
             `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
    }

    function add(type, event, reaction, details = {}) {
      const entry = {
        time: formatLogTime(),
        type,       // 'KEYBOARD' | 'CLICK' | 'STATE_CHANGE' | 'ACTION'
        event,
        reaction,
        ...details
      };
      logs.push(entry);
      if (logs.length > LOG_LIMIT) logs.shift();
      return entry;
    }

    function key(e, reaction, extra = {}) {
      const targetDesc = e.target ? `${e.target.tagName.toLowerCase()}${e.target.id ? '#' + e.target.id : ''}${e.target.className ? '.' + String(e.target.className).trim().split(/\s+/).join('.') : ''}` : 'none';
      const mods = [];
      if (e.ctrlKey) mods.push('Ctrl');
      if (e.altKey) mods.push('Alt');
      if (e.shiftKey) mods.push('Shift');
      if (e.metaKey) mods.push('Meta');
      const modStr = mods.length ? ` [${mods.join('+')}]` : '';

      return add('KEYBOARD', `Key '${e.key}'${modStr} on <${targetDesc}>`, reaction, {
        key: e.key,
        code: e.code,
        target: targetDesc,
        activeElement: document.activeElement ? document.activeElement.tagName : 'none',
        ...extra
      });
    }

    function click(e, reaction, extra = {}) {
      const target = e.target;
      const desc = target ? `${target.tagName.toLowerCase()}${target.id ? '#' + target.id : ''}${target.className ? '.' + String(target.className).trim().split(/\s+/).join('.') : ''}` : 'unknown';
      const text = target?.textContent ? target.textContent.trim().slice(0, 30) : '';

      return add('CLICK', `Click on <${desc}>${text ? ` ("${text}")` : ''}`, reaction, {
        target: desc,
        text,
        ...extra
      });
    }

    function valueChange(prop, oldValue, newValue, source, extra = {}) {
      return add('STATE_CHANGE', `${prop} changed`, `[${source}] ${JSON.stringify(oldValue)} ➔ ${JSON.stringify(newValue)}`, {
        property: prop,
        oldValue,
        newValue,
        source,
        ...extra
      });
    }

    function action(name, status, details = {}) {
      return add('ACTION', `fn: ${name}`, status, details);
    }

    function getFormattedLogText() {
      if (!logs.length) return '=== Tag Script Diagnostic Log is empty ===';
      const lines = ['=== Tag Script Diagnostic Log ==='];
      logs.forEach((l) => {
        lines.push(`[${l.time}] [${l.type}] ${l.event} => ${l.reaction}`);
        if (l.source) lines.push(`    Source: ${l.source}`);
        if (l.property) lines.push(`    Change: ${l.property} = ${JSON.stringify(l.oldValue)} -> ${JSON.stringify(l.newValue)}`);
      });
      return lines.join('\n');
    }

    function tagscriptLog() {
      if (!logs.length) {
        console.log('%c[e621 extras] Tag script log is empty.', 'color: #888');
        return [];
      }
      console.group(`%c[e621 extras] Tag Script Diagnostic Log (${logs.length} entries)`, 'color: #3b82f6; font-weight: bold;');
      console.table(logs.map(l => ({
        Time: l.time,
        Type: l.type,
        Event: l.event,
        Reaction: l.reaction,
        Source: l.source || l.property || ''
      })));
      console.groupEnd();
      return logs;
    }

    tagscriptLog.raw = () => logs;
    tagscriptLog.text = getFormattedLogText;
    tagscriptLog.clear = () => {
      logs.length = 0;
      console.log('[e621 extras] Tag script log cleared.');
    };
    tagscriptLog.export = () => {
      const blob = new Blob([JSON.stringify(logs, null, 2)], { type: 'application/json' });
      U.downloadBlob(blob, `tagscript_log_${Date.now()}.json`);
    };

    globalThis.tagscriptLog = tagscriptLog;
    if (typeof window !== 'undefined') window.tagscriptLog = tagscriptLog;

    setInterval(() => {tagscriptLog()},5000)

    return { add, key, click, valueChange, action, tagscriptLog };
  });
} else {
  E621X.define('tagScriptLogger', [], () => {
    'use strict';
    const noop = () => {};
    const disabledFn = () => {
      console.log('[e621 extras] Tag script logging is disabled.');
      return [];
    };
    disabledFn.raw = () => [];
    disabledFn.text = () => 'Logging is disabled.';
    disabledFn.clear = noop;
    disabledFn.export = noop;

    globalThis.tagscriptLog = disabledFn;
    if (typeof window !== 'undefined') window.tagscriptLog = disabledFn;

    return {
      add: noop,
      key: noop,
      click: noop,
      valueChange: noop,
      action: noop,
      tagscriptLog: disabledFn
    };
  });
}