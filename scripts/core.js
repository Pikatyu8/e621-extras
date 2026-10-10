/* Minimal module registry with explicit dependencies.
 * A wrong script order in manifest.json fails with a readable message instead of "undefined is not iterable". */
globalThis.E621X = (function () {
  'use strict';
  const modules = new Map();

  function get(name) {
    if (!modules.has(name)) {
      throw new Error(`[e621 extras] module "${name}" is not loaded — check script order in manifest.json`);
    }
    return modules.get(name);
  }

  function define(name, deps, factory) {
    if (modules.has(name)) throw new Error(`[e621 extras] module "${name}" is defined twice`);
    const resolved = deps.map(dep => {
      if (!modules.has(dep)) {
        throw new Error(`[e621 extras] module "${name}" requires "${dep}" — check script order in manifest.json`);
      }
      return modules.get(dep);
    });
    modules.set(name, Object.freeze(factory(...resolved)));
  }

  return { define, get };
})();