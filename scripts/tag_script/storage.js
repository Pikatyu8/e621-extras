/* Storage & cookie persistence for tag script slots (1-9), presets, sticky keys and extended mode.
 * Tab-specific state (active slots 1-9, active preset, sticky/extended state) is isolated per-tab
 * via sessionStorage with automatic seeding, preventing cross-tab preset overwrites. */
E621X.define('tagScriptStorage', ['utils', 'tagScriptLogger'], (U, Log) => {
  'use strict';

  const LS = {
    CURRENT_ID: 'current_tag_script_id',
    scriptKey: (id) => `tag-script-${id}`,
    EXTENDED: 'e621_tag_script_extended',
    STICKY: 'e621_tag_script_sticky',
    ACTIVE_STICKY_SLOTS: 'e621_tag_script_active_sticky_slots',
    SLOT_BEFORE_STICKY: 'e621_tag_script_slot_before_sticky',
    PRESETS: 'e621_tag_script_presets',
    ACTIVE_PRESET: 'e621_tag_script_active_preset'
  };

  const TAB_SEEDED_KEY = 'e621_tag_script_tab_seeded';

  function getCookie(name) {
    const match = document.cookie.match(
      new RegExp('(?:^|;\\s*)' + name.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&') + '=([^;]*)')
    );
    return match ? decodeURIComponent(match[1]) : null;
  }

  function getStoredPresets() {
    try {
      const raw = localStorage.getItem(LS.PRESETS);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      U.logWarn('getStoredPresets', err);
      return [];
    }
  }

  function saveStoredPresets(presets, source = 'unknown') {
    try {
      const oldPresets = getStoredPresets();
      localStorage.setItem(LS.PRESETS, JSON.stringify(presets));
      Log.valueChange('presets_list', oldPresets.map(p => p.name), presets.map(p => p.name), source);
    } catch (err) {
      U.logWarn('saveStoredPresets', err);
    }
  }

  /* Ensures this browser tab has its own isolated copy of active scripts & state in sessionStorage. */
  function ensureTabStorageSeeded() {
    try {
      if (sessionStorage.getItem(TAB_SEEDED_KEY)) return;

      const activePreset = localStorage.getItem(LS.ACTIVE_PRESET) || '';
      sessionStorage.setItem(LS.ACTIVE_PRESET, activePreset);

      const presets = getStoredPresets();
      const matchedPreset = activePreset
        ? presets.find(p => p.name.toLowerCase() === activePreset.toLowerCase())
        : null;

      for (let i = 1; i <= 9; i++) {
        const key = LS.scriptKey(i);
        let script = '';
        if (matchedPreset && matchedPreset.scripts) {
          script = matchedPreset.scripts[i] || '';
        } else {
          script = localStorage.getItem(key) || getCookie(key) || '';
        }
        sessionStorage.setItem(key, script);
      }

      const sticky = (matchedPreset && typeof matchedPreset.sticky === 'boolean')
        ? String(matchedPreset.sticky)
        : (localStorage.getItem(LS.STICKY) || 'false');
      sessionStorage.setItem(LS.STICKY, sticky);

      const extended = (matchedPreset && typeof matchedPreset.extended === 'boolean')
        ? String(matchedPreset.extended)
        : (localStorage.getItem(LS.EXTENDED) || 'false');
      sessionStorage.setItem(LS.EXTENDED, extended);

      const activeStickySlots = localStorage.getItem(LS.ACTIVE_STICKY_SLOTS) || '[]';
      sessionStorage.setItem(LS.ACTIVE_STICKY_SLOTS, activeStickySlots);

      const curId = localStorage.getItem(LS.CURRENT_ID) || '1';
      sessionStorage.setItem(LS.CURRENT_ID, curId);

      const slotBeforeSticky = localStorage.getItem(LS.SLOT_BEFORE_STICKY) || '1';
      sessionStorage.setItem(LS.SLOT_BEFORE_STICKY, slotBeforeSticky);

      sessionStorage.setItem(TAB_SEEDED_KEY, 'true');
    } catch (err) {
      U.logWarn('ensureTabStorageSeeded', err);
    }
  }

  function tabGet(key, fallback = null) {
    ensureTabStorageSeeded();
    try {
      const sVal = sessionStorage.getItem(key);
      if (sVal !== null && sVal !== undefined) return sVal;
    } catch (_) {
      // sessionStorage unavailable
    }

    try {
      const lVal = localStorage.getItem(key);
      if (lVal !== null && lVal !== undefined) return lVal;
    } catch (_) {
      // localStorage unavailable
    }

    return fallback;
  }

  function tabSet(key, value, syncToLocal = false) {
    ensureTabStorageSeeded();
    const str = String(value ?? '');
    try {
      sessionStorage.setItem(key, str);
    } catch (_) {
      // sessionStorage unavailable
    }

    if (syncToLocal) {
      try {
        localStorage.setItem(key, str);
      } catch (_) {
        // localStorage unavailable
      }
    }
  }

  function tabRemove(key, removeFromLocal = false) {
    ensureTabStorageSeeded();
    try {
      sessionStorage.removeItem(key);
    } catch (_) {
      // sessionStorage unavailable
    }
    if (removeFromLocal) {
      try {
        localStorage.removeItem(key);
      } catch (_) {
        // localStorage unavailable
      }
    }
  }

  function getCurrentScriptId() {
    let id = parseInt(tabGet(LS.CURRENT_ID, '1'), 10);
    return (id >= 1 && id <= 10) ? id : 1;
  }

  function setCurrentScriptId(id, source = 'unknown') {
    const num = (id >= 1 && id <= 10) ? id : 1;
    const oldId = getCurrentScriptId();
    const str = String(num);
    tabSet(LS.CURRENT_ID, str, true);
    if (oldId !== num) {
      Log.valueChange('current_tag_script_id', oldId, num, source);
    }
  }

  function getStoredScript(id) {
    const num = (id >= 1 && id <= 9) ? id : null;
    if (!num) return ''; // Slot 10 has no script
    const key = LS.scriptKey(num);
    const val = tabGet(key);
    return val !== null && val !== undefined ? val : '';
  }

  function setStoredScript(id, content, source = 'unknown', shouldSyncPreset = false) {
    if (id < 1 || id > 9) return; // Slot 10 is virtual, never persist
    const key = LS.scriptKey(id);
    const oldVal = getStoredScript(id);
    const text = String(content ?? '');
    if (oldVal !== text) {
      const hasActivePreset = Boolean(getActivePresetName());
      tabSet(key, text, !hasActivePreset);
      Log.valueChange(`slot_${id} (${key})`, oldVal, text, source);
    }
    if (shouldSyncPreset) {
      syncActivePresetScript(id, text, source);
    }
  }

  function clearAllStoredScripts(source = 'unknown') {
    setActivePresetName('', source);
    for (let i = 1; i <= 9; i++) {
      setStoredScript(i, '', `${source} -> slot #${i}`, false);
    }
  }

  const getActivePresetName = () => tabGet(LS.ACTIVE_PRESET, '') || '';

  const setActivePresetName = (name, source = 'unknown') => {
    const oldName = getActivePresetName();
    const nextName = String(name || '');
    if (oldName !== nextName) {
      if (!nextName) tabRemove(LS.ACTIVE_PRESET, true);
      else tabSet(LS.ACTIVE_PRESET, nextName, true);
      Log.valueChange('active_preset', oldName, nextName, source);
    }
  };

  function syncActivePresetScript(id, content, source) {
    const activeName = getActivePresetName();
    if (!activeName) return;

    const presets = getStoredPresets();
    const preset = presets.find(p => p.name.toLowerCase() === activeName.toLowerCase());
    if (!preset) return;

    if (!preset.scripts) preset.scripts = {};
    const text = String(content || '').trim();
    if (text) {
      preset.scripts[id] = text;
    } else {
      delete preset.scripts[id];
    }

    saveStoredPresets(presets, `syncActivePresetScript("${activeName}" -> slot #${id} via ${source})`);
  }

  function syncActivePresetExtended(isExtended, source) {
    const activeName = getActivePresetName();
    if (!activeName) return;

    const presets = getStoredPresets();
    const preset = presets.find(p => p.name.toLowerCase() === activeName.toLowerCase());
    if (!preset) return;

    preset.extended = Boolean(isExtended);
    saveStoredPresets(presets, `syncActivePresetExtended("${activeName}" -> ${isExtended} via ${source})`);
  }

  const isExtendedMode = () => tabGet(LS.EXTENDED, 'false') === 'true';

  const setExtendedMode = (value, source = 'unknown') => {
    const oldVal = isExtendedMode();
    const nextVal = Boolean(value);
    if (oldVal !== nextVal) {
      tabSet(LS.EXTENDED, String(nextVal), true);
      Log.valueChange('extended_mode', oldVal, nextVal, source);
    }
  };

  /* Sticky keys mode helpers */
  const isStickyMode = () => tabGet(LS.STICKY, 'false') === 'true';

  const setStickyMode = (value, source = 'unknown') => {
    const oldVal = isStickyMode();
    const nextVal = Boolean(value);
    if (oldVal !== nextVal) {
      tabSet(LS.STICKY, String(nextVal), true);
      Log.valueChange('sticky_mode', oldVal, nextVal, source);
    }
  };

  function getActiveStickySlots() {
    try {
      const raw = tabGet(LS.ACTIVE_STICKY_SLOTS);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.map(Number).filter(n => n >= 1 && n <= 9) : [];
    } catch (_) {
      return [];
    }
  }

  function setActiveStickySlots(slots, source = 'unknown') {
    const valid = Array.from(new Set(slots.map(Number).filter(n => n >= 1 && n <= 9))).sort((a, b) => a - b);
    tabSet(LS.ACTIVE_STICKY_SLOTS, JSON.stringify(valid), false);
    Log.valueChange('active_sticky_slots', [], valid, source);
  }

  function getSlotBeforeSticky() {
    const val = parseInt(tabGet(LS.SLOT_BEFORE_STICKY, '1'), 10);
    return (val >= 1 && val <= 9) ? val : 1;
  }

  function setSlotBeforeSticky(slot) {
    const val = (slot >= 1 && slot <= 9) ? slot : 1;
    tabSet(LS.SLOT_BEFORE_STICKY, String(val), false);
  }

  function hasAnyScripts(activeFieldVal = '') {
    if (activeFieldVal && activeFieldVal.trim()) return true;
    for (let i = 1; i <= 9; i++) {
      if (getStoredScript(i).trim()) return true;
    }
    return false;
  }

  return {
    getCurrentScriptId,
    setCurrentScriptId,
    getStoredScript,
    setStoredScript,
    clearAllStoredScripts,
    getStoredPresets,
    saveStoredPresets,
    getActivePresetName,
    setActivePresetName,
    syncActivePresetScript,
    syncActivePresetExtended,
    isExtendedMode,
    setExtendedMode,
    isStickyMode,
    setStickyMode,
    getActiveStickySlots,
    setActiveStickySlots,
    getSlotBeforeSticky,
    setSlotBeforeSticky,
    hasAnyScripts
  };
});