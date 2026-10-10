/* Storage & cookie persistence for tag script slots (1-9), presets, sticky keys and extended mode. */
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

  function getCookie(name) {
    const match = document.cookie.match(
      new RegExp('(?:^|;\\s*)' + name.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&') + '=([^;]*)')
    );
    return match ? decodeURIComponent(match[1]) : null;
  }

  function setCookie(name, value) {
    try {
      if (value === '' || value === null || value === undefined) {
        document.cookie = `${name}=; path=/; max-age=0; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
      } else {
        document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=31536000; SameSite=Lax`;
      }
    } catch (err) {
      U.logWarn('setCookie', err);
    }
  }

  function getCurrentScriptId() {
    let id = parseInt(localStorage.getItem(LS.CURRENT_ID), 10);
    if (!id || id < 1 || id > 10) {
      id = parseInt(getCookie(LS.CURRENT_ID), 10);
    }
    return (id >= 1 && id <= 10) ? id : 1;
  }

  function setCurrentScriptId(id, source = 'unknown') {
    const num = (id >= 1 && id <= 10) ? id : 1;
    const oldId = getCurrentScriptId();
    const str = String(num);
    localStorage.setItem(LS.CURRENT_ID, str);
    setCookie(LS.CURRENT_ID, str);
    if (oldId !== num) {
      Log.valueChange('current_tag_script_id', oldId, num, source);
    }
  }

  function getStoredScript(id) {
    const num = (id >= 1 && id <= 9) ? id : null;
    if (!num) return ''; // Slot 10 has no script
    const key = LS.scriptKey(num);
    const lsVal = localStorage.getItem(key);
    if (lsVal !== null && lsVal !== undefined) return lsVal;
    const cookieVal = getCookie(key);
    if (cookieVal !== null && cookieVal !== undefined) return cookieVal;
    return '';
  }

  function setStoredScript(id, content, source = 'unknown', shouldSyncPreset = false) {
    if (id < 1 || id > 9) return; // Slot 10 is virtual, never persist
    const key = LS.scriptKey(id);
    const oldVal = getStoredScript(id);
    const text = String(content ?? '');
    if (oldVal !== text) {
      localStorage.setItem(key, text);
      setCookie(key, text);
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

  const getActivePresetName = () => localStorage.getItem(LS.ACTIVE_PRESET) || '';

  const setActivePresetName = (name, source = 'unknown') => {
    const oldName = getActivePresetName();
    const nextName = String(name || '');
    if (oldName !== nextName) {
      if (!nextName) localStorage.removeItem(LS.ACTIVE_PRESET);
      else localStorage.setItem(LS.ACTIVE_PRESET, nextName);
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

  const isExtendedMode = () => localStorage.getItem(LS.EXTENDED) === 'true';

  const setExtendedMode = (value, source = 'unknown') => {
    const oldVal = isExtendedMode();
    const nextVal = Boolean(value);
    if (oldVal !== nextVal) {
      localStorage.setItem(LS.EXTENDED, String(nextVal));
      Log.valueChange('extended_mode', oldVal, nextVal, source);
    }
  };

  /* Sticky keys mode helpers */
  const isStickyMode = () => localStorage.getItem(LS.STICKY) === 'true';

  const setStickyMode = (value, source = 'unknown') => {
    const oldVal = isStickyMode();
    const nextVal = Boolean(value);
    if (oldVal !== nextVal) {
      localStorage.setItem(LS.STICKY, String(nextVal));
      Log.valueChange('sticky_mode', oldVal, nextVal, source);
    }
  };

  function getActiveStickySlots() {
    try {
      const raw = localStorage.getItem(LS.ACTIVE_STICKY_SLOTS);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.map(Number).filter(n => n >= 1 && n <= 9) : [];
    } catch (_) {
      return [];
    }
  }

  function setActiveStickySlots(slots, source = 'unknown') {
    const valid = Array.from(new Set(slots.map(Number).filter(n => n >= 1 && n <= 9))).sort((a, b) => a - b);
    localStorage.setItem(LS.ACTIVE_STICKY_SLOTS, JSON.stringify(valid));
    Log.valueChange('active_sticky_slots', [], valid, source);
  }

  function getSlotBeforeSticky() {
    const val = parseInt(localStorage.getItem(LS.SLOT_BEFORE_STICKY), 10);
    return (val >= 1 && val <= 9) ? val : 1;
  }

  function setSlotBeforeSticky(slot) {
    const val = (slot >= 1 && slot <= 9) ? slot : 1;
    localStorage.setItem(LS.SLOT_BEFORE_STICKY, String(val));
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