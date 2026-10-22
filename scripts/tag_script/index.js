/* UI panel, presets management, sticky keys, hotkeys and lifecycle orchestration. */
E621X.define('tagScript',
  ['utils', 'selectors', 'tagScriptStorage', 'tagScriptRunner', 'tagScriptPreview', 'tagScriptQueue', 'tagScriptLogger'],
  (U, SEL, Storage, Runner, Preview, Queue, Log) => {
  'use strict';

  const IDS = {
    ui: 'e621x-tag-script-ui',
    ownField: 'e621x-tag-script-field',
    reason: 'e621x-tag-script-reason',
    all: 'e621x-tag-script-all',
    sticky: 'e621x-tag-script-sticky',
    presetSelect: 'e621x-tag-script-preset-select',
    presetName: 'e621x-tag-script-preset-name',
    presetSave: 'e621x-tag-script-preset-save',
    presetDelete: 'e621x-tag-script-preset-delete',
    queueLink: 'e621x-tag-script-queue-link'
  };

  const MODE_VALUE = 'tag-script-ext';

  let usesNative = false;
  let isProgrammaticInput = false;

  const getModeSelect = () => document.querySelector(SEL.modeSelect);
  const isTagScriptMode = () => getModeSelect()?.value === MODE_VALUE;

  function setFieldDisplayValue(val, source) {
    const field = Runner.getScriptField();
    if (!field) return;
    const oldVal = field.value;
    if (oldVal === val) return;
    isProgrammaticInput = true;
    try {
      field.value = val;
      Log.valueChange('field.value', oldVal, val, source);
      field.dispatchEvent(new Event('input', { bubbles: true }));
      field.dispatchEvent(new Event('change', { bubbles: true }));
    } finally {
      isProgrammaticInput = false;
    }
  }

  function syncStickyUi() {
    const field = Runner.getScriptField();
    if (!field) return;

    if (!Storage.isStickyMode()) {
      field.disabled = false;
      const currentId = Storage.getCurrentScriptId();
      const validId = (currentId >= 1 && currentId <= 9) ? currentId : (Storage.getSlotBeforeSticky() || 1);
      Storage.setCurrentScriptId(validId, 'syncStickyUi restore');
      setFieldDisplayValue(Storage.getStoredScript(validId), 'syncStickyUi restore');
      return;
    }

    const activeSlots = Storage.getActiveStickySlots();
    if (activeSlots.length > 0) {
      field.disabled = true;
      field.value = `[${activeSlots.sort((a, b) => a - b).join(', ')}] hold ctrl to view tags`;
      Storage.setCurrentScriptId(10, 'sticky active slots');
    } else {
      Storage.setCurrentScriptId(10, 'sticky empty slots');
      field.disabled = true;
      field.value = 'Use numbers on keyboard';
    }
  }

  function handleClearScripts(source = 'handleClearScripts') {
    Log.action('handleClearScripts', `Clearing all 9 slots (source: ${source})`);
    Storage.clearAllStoredScripts(source);
    Storage.setActiveStickySlots([]);

    const nameInput = document.getElementById(IDS.presetName);
    if (nameInput) nameInput.value = '';

    if (Storage.isStickyMode()) {
      Storage.setCurrentScriptId(10, 'cleared in sticky');
    } else {
      const restoreSlot = Storage.getSlotBeforeSticky() || 1;
      Storage.setCurrentScriptId(restoreSlot, 'cleared');
    }

    syncStickyUi();
    updatePresetDropdown('');
    Preview.syncPreview();
    U.showToast('Tag scripts cleared');
    Log.add('ACTION', 'handleClearScripts', 'Cleared all 9 tag script slots and active preset');
  }

  function updatePresetDropdown(selectedName = '') {
    const select = document.getElementById(IDS.presetSelect);
    if (!select) return;

    const presets = Storage.getStoredPresets();
    select.replaceChildren();

    const defaultOpt = document.createElement('option');
    defaultOpt.value = '';
    defaultOpt.textContent = 'Select preset...';
    select.appendChild(defaultOpt);

    const customOpt = document.createElement('option');
    customOpt.value = '__custom__';
    customOpt.textContent = 'Select preset...';
    customOpt.hidden = true;
    select.appendChild(customOpt);

    let matched = false;
    presets.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.name;
      opt.textContent = p.name;
      if (selectedName && p.name.toLowerCase() === selectedName.toLowerCase()) {
        opt.selected = true;
        matched = true;
      }
      select.appendChild(opt);
    });

    if (!matched) {
      if (selectedName === '__custom__' || (Storage.hasAnyScripts(Runner.getScriptField()?.value) && !selectedName)) {
        customOpt.selected = true;
        select.value = '__custom__';
      } else {
        defaultOpt.selected = true;
        select.value = '';
      }
    }
  }

  function handleLoadPreset(name) {
    Log.action('handleLoadPreset', `Loading preset "${name}"`);
    if (!name || name === '__clear__') {
      handleClearScripts('preset dropdown: Select preset...');
      return;
    }

    const presets = Storage.getStoredPresets();
    const preset = presets.find(p => p.name.toLowerCase() === name.toLowerCase());
    if (!preset) {
      Log.add('ACTION', 'handleLoadPreset', `Preset "${name}" not found in storage, clearing scripts`);
      handleClearScripts('preset not found');
      return;
    }

    Storage.setActivePresetName(preset.name, `handleLoadPreset("${preset.name}")`);
    Storage.setActiveStickySlots([]);
    for (let i = 1; i <= 9; i++) {
      const scriptContent = preset.scripts?.[i] || '';
      Storage.setStoredScript(i, scriptContent, `handleLoadPreset("${preset.name}") -> slot #${i}`, false);
    }

    let currentId = Storage.getCurrentScriptId();
    const hasCurrent = Boolean(preset.scripts?.[currentId]?.trim());
    if (!hasCurrent) {
      if (preset.scripts?.[1]?.trim()) {
        currentId = 1;
      } else {
        const firstSlot = [1, 2, 3, 4, 5, 6, 7, 8, 9].find(slot => Boolean(preset.scripts?.[slot]?.trim()));
        if (firstSlot) currentId = firstSlot;
      }
      Storage.setCurrentScriptId(currentId, `handleLoadPreset("${preset.name}"): auto-select populated slot`);
    }

    if (Storage.isStickyMode()) {
      Storage.setCurrentScriptId(10, 'preset loaded in sticky');
      syncStickyUi();
    } else {
      const scriptVal = Storage.getStoredScript(currentId);
      setFieldDisplayValue(scriptVal, `handleLoadPreset("${preset.name}") for slot #${currentId}`);
    }

    updatePresetDropdown(preset.name);
    Preview.syncPreview();
    U.showToast(`Preset "${preset.name}" loaded`);
    Log.add('ACTION', 'handleLoadPreset', `Successfully loaded preset "${preset.name}"`);
  }

  function handleSavePreset() {
    const nameInput = document.getElementById(IDS.presetName);
    const name = nameInput?.value.trim();

    if (!name) {
      U.showToast('Enter a preset name', true);
      nameInput?.focus();
      return;
    }

    const scripts = {};
    let hasAny = false;
    for (let i = 1; i <= 9; i++) {
      const val = Storage.getStoredScript(i).trim();
      if (val) {
        scripts[i] = val;
        hasAny = true;
      }
    }

    if (!hasAny) {
      U.showToast('No tag scripts to save in preset', true);
      return;
    }

    const presets = Storage.getStoredPresets();
    const existingIdx = presets.findIndex(p => p.name.toLowerCase() === name.toLowerCase());
    const presetData = {
      name,
      scripts
    };

    if (existingIdx >= 0) {
      presets[existingIdx] = presetData;
    } else {
      presets.push(presetData);
    }

    Storage.saveStoredPresets(presets, `handleSavePreset("${name}")`);
    Storage.setActivePresetName(name, `handleSavePreset("${name}")`);
    if (nameInput) nameInput.value = '';
    updatePresetDropdown(name);
    U.showToast(`Preset "${name}" saved`);
  }

  function handleDeletePreset() {
    Log.action('handleDeletePreset', 'Delete preset button clicked');
    const select = document.getElementById(IDS.presetSelect);
    const selectedVal = select?.value;
    const activeName = Storage.getActivePresetName();

    let targetName = '';
    if (selectedVal && selectedVal !== '__custom__' && selectedVal !== '__clear__') {
      targetName = selectedVal;
    } else if (activeName) {
      targetName = activeName;
    }

    if (!targetName) {
      U.showToast('Select a preset from dropdown to delete', true);
      Log.add('ACTION', 'handleDeletePreset', 'Failed: No preset selected in dropdown');
      return;
    }

    const presets = Storage.getStoredPresets();
    const idx = presets.findIndex(p => p.name.toLowerCase() === targetName.toLowerCase());
    if (idx === -1) {
      U.showToast(`Preset "${targetName}" not found`, true);
      Log.add('ACTION', 'handleDeletePreset', `Failed: Preset "${targetName}" not found in storage`);
      return;
    }

    const deletedName = presets[idx].name;
    presets.splice(idx, 1);
    Storage.saveStoredPresets(presets, `handleDeletePreset("${deletedName}")`);

    if (Storage.getActivePresetName().toLowerCase() === deletedName.toLowerCase()) {
      handleClearScripts(`deleted active preset "${deletedName}"`);
    } else {
      updatePresetDropdown(Storage.getActivePresetName());
      U.showToast(`Preset "${deletedName}" deleted`);
    }

    const nameInput = document.getElementById(IDS.presetName);
    if (nameInput && nameInput.value.trim().toLowerCase() === deletedName.toLowerCase()) {
      nameInput.value = '';
    }
    Log.add('ACTION', 'handleDeletePreset', `Successfully deleted preset "${deletedName}"`);
  }

  function buildUi(withOwnField) {
    const ui = document.createElement('div');
    ui.id = IDS.ui;
    ui.innerHTML = `
      ${withOwnField ? `<input id="${IDS.ownField}" data-autocomplete="tag-edit" placeholder="Enter tag script" class="st-input e621x-ts-input" />` : ''}
      <div class="e621x-ts-row">
        <button id="${IDS.all}" type="button" class="st-button e621x-ts-all">All</button>
        <input id="${IDS.reason}" placeholder="Reason" maxlength="250" class="st-input e621x-ts-input e621x-ts-grow" />
      </div>
      <div class="e621x-ts-row">
        <select id="${IDS.presetSelect}" class="st-select e621x-ts-input e621x-ts-grow">
          <option value="">Select preset...</option>
        </select>
      </div>
      <div class="e621x-ts-row">
        <input id="${IDS.presetName}" placeholder="Preset name" class="st-input e621x-ts-input e621x-ts-grow" />
        <button id="${IDS.presetSave}" type="button" class="st-button e621x-ts-btn">Save</button>
        <button id="${IDS.presetDelete}" type="button" class="st-button e621x-ts-btn">Delete</button>
      </div>
      <div class="e621x-ts-row e621x-ts-row--spread">
        <label class="e621x-ts-label" title="Combine multiple active tag scripts in a single request">
          <input type="checkbox" id="${IDS.sticky}" />
          <span>Sticky Keys</span>
        </label>
        <a id="${IDS.queueLink}" href="/posts/timeouted" target="_blank" class="e621x-ts-queue-link hidden">Queue (0)</a>
      </div>`;
    return ui;
  }

  function injectUI() {
    const modeBox = document.querySelector(SEL.modeBox);
    const select = getModeSelect();
    if (!modeBox || !select) return;

    usesNative = Boolean(document.querySelector(SEL.nativeTagScriptField));

    if (!Array.from(select.options).some(o => o.value === MODE_VALUE)) {
      select.append(new Option('Tag Script (extension)', MODE_VALUE));
    }
    if (document.getElementById(IDS.ui)) return;

    // Always create our dedicated field to keep extension mode isolated from native tag scripts
    const ui = buildUi(true);
    modeBox.appendChild(ui);

    const ownField = document.getElementById(IDS.ownField);
    const stickyCheckbox = document.getElementById(IDS.sticky);
    const presetSelect = document.getElementById(IDS.presetSelect);
    const presetNameInput = document.getElementById(IDS.presetName);
    const presetSaveBtn = document.getElementById(IDS.presetSave);
    const presetDeleteBtn = document.getElementById(IDS.presetDelete);
    const allBtn = document.getElementById(IDS.all);

    stickyCheckbox.checked = Storage.isStickyMode();
    stickyCheckbox.addEventListener('change', (e) => {
      const isSticky = stickyCheckbox.checked;
      Storage.setStickyMode(isSticky, 'checkbox change');
      if (isSticky) {
        const cur = Storage.getCurrentScriptId();
        const validCur = cur >= 1 && cur <= 9 ? cur : 1;
        Storage.setSlotBeforeSticky(validCur);

        const hasScript = Boolean(Storage.getStoredScript(validCur).trim());
        Storage.setActiveStickySlots(hasScript ? [validCur] : []);
      } else {
        Storage.setActiveStickySlots([]);
        const restoreSlot = Storage.getSlotBeforeSticky();
        Storage.setCurrentScriptId(restoreSlot, 'sticky disabled');
      }
      syncStickyUi();
      Preview.syncPreview();
      Log.click(e, `Sticky Keys toggled to ${isSticky ? 'ON' : 'OFF'}`);
      U.showToast(`Tag Scripts: Sticky Keys ${isSticky ? 'ON' : 'OFF'}`);
    });

    const activePreset = Storage.getActivePresetName();
    updatePresetDropdown(activePreset);
    if (activePreset) {
      const presets = Storage.getStoredPresets();
      const matched = presets.find(p => p.name.toLowerCase() === activePreset.toLowerCase());
      if (!matched) {
        Storage.setActivePresetName('', 'init unmatched');
      }
    }

    presetSelect.addEventListener('change', (e) => {
      const val = presetSelect.value;
      Log.click(e, `Preset dropdown selected: "${val}"`);
      if (!val || val === '__clear__') {
        handleClearScripts('preset dropdown: Select preset...');
      } else if (val !== '__custom__') {
        handleLoadPreset(val);
      }
      presetSelect.blur();
    });

    presetSaveBtn.addEventListener('click', (e) => {
      e.preventDefault();
      Log.click(e, 'Save preset button clicked');
      handleSavePreset();
    });

    presetDeleteBtn.addEventListener('click', (e) => {
      e.preventDefault();
      Log.click(e, 'Delete preset button clicked');
      handleDeletePreset();
    });

    presetNameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        Log.key(e, 'Enter pressed in preset name input -> triggering handleSavePreset');
        handleSavePreset();
      }
    });

    const handleFieldInput = (field, source) => {
      if (isProgrammaticInput) return;
      if (Storage.isStickyMode()) return;
      const val = field.value;
      if (val.includes('hold ctrl to view tags') || val.includes('Use numbers on')) return;

      const currentId = Storage.getCurrentScriptId();
      if (currentId >= 1 && currentId <= 9) {
        Storage.setStoredScript(currentId, val, `user typing in ${source} (slot #${currentId})`, true);
        Preview.syncPreview();
      }
    };

    const nativeField = document.querySelector(SEL.nativeTagScriptField);
    if (nativeField) {
      nativeField.addEventListener('input', () => handleFieldInput(nativeField, 'nativeField'));
    }

    if (ownField) {
      ownField.addEventListener('input', () => handleFieldInput(ownField, 'ownField'));
    }

    const syncMode = () => {
      const active = select.value === MODE_VALUE;
      ui.classList.toggle('is-visible', active);
      const page = document.getElementById('page');

      if (active) {
        if (page && page.getAttribute('data-mode-menu') !== MODE_VALUE) {
          page.setAttribute('data-mode-menu', MODE_VALUE);
        }

        const curPreset = Storage.getActivePresetName();
        updatePresetDropdown(curPreset);
        syncStickyUi();
        if (!Storage.isStickyMode()) {
          const id = Storage.getCurrentScriptId();
          const validId = (id >= 1 && id <= 9) ? id : 1;
          const scriptVal = Storage.getStoredScript(validId);
          setFieldDisplayValue(scriptVal, 'mode-box switch to tag-script');
          const field = Runner.getScriptField();
          if (field) field.focus();
          U.showToast(`Switched to tag script #${validId}. Use 1-9 keys to switch.`);
          Log.add('ACTION', 'syncMode', `Activated tag-script mode on slot #${validId}`);
        }
        Preview.syncPreview();
      } else {
        if (page && page.getAttribute('data-mode-menu') === MODE_VALUE) {
          page.setAttribute('data-mode-menu', select.value);
        }
        Preview.hideTooltip();
      }
    };
    select.addEventListener('change', (e) => {
      Log.click(e, `Mode dropdown changed to "${select.value}"`);
      syncMode();
    });
    if (select.value === MODE_VALUE) syncMode();

    allBtn.addEventListener('click', (e) => {
      e.preventDefault();
      Log.click(e, 'All button clicked');
      Runner.handleApplyAll();
    });

    Runner.syncQueuedOutlines();
  }

  function setupThumbnailClickListener() {
    document.addEventListener('click', (e) => {
      if (!isTagScriptMode()) return;

      const thumb = e.target.closest(SEL.thumbnail);
      if (!thumb) return;

      e.preventDefault();
      e.stopPropagation();
      Runner.handleThumbClick(thumb);
    }, true);
  }

  function setupHotkeys() {
    window.addEventListener('keydown', (e) => {
      if (!isTagScriptMode()) return;

      if (['TEXTAREA', 'INPUT', 'SELECT'].includes(document.activeElement?.tagName)) {
        return;
      }

      if (Storage.isStickyMode() && e.key === 'Escape' && !e.ctrlKey && !e.altKey && !e.metaKey) {
        if (document.querySelector('.e621x-tree-dialog, .e621x-stats-dialog')) return;

        const activeSlots = Storage.getActiveStickySlots();
        if (activeSlots.length > 0) {
          e.preventDefault();
          e.stopPropagation();

          Storage.setActiveStickySlots([], 'hotkey [Escape]');
          syncStickyUi();
          Preview.syncPreview();
          U.showToast('All slots deselected');
          Log.key(e, 'Escape pressed -> Deselected all active sticky slots');
          return;
        }
      }

      if (!/^[1-9]$/.test(e.key) || e.ctrlKey || e.altKey || e.metaKey) {
        return;
      }

      const newId = Number(e.key);
      e.preventDefault();
      e.stopPropagation();

      if (Storage.isStickyMode()) {
        let activeSlots = Storage.getActiveStickySlots();
        if (activeSlots.includes(newId)) {
          activeSlots = activeSlots.filter(id => id !== newId);
          U.showToast(`Slot #${newId} disabled`);
        } else {
          if (!Storage.getStoredScript(newId).trim()) return;
          activeSlots.push(newId);
          U.showToast(`Slot #${newId} enabled`);
        }
        Storage.setActiveStickySlots(activeSlots, `hotkey [${newId}] toggle`);
        syncStickyUi();
        Preview.syncPreview();
      } else {
        const prevId = Storage.getCurrentScriptId();
        Log.key(e, `Switched slot #${prevId} ➔ #${newId}`, { prevId, newId });

        Storage.setCurrentScriptId(newId, `hotkey [${newId}]`);
        const scriptVal = Storage.getStoredScript(newId);
        setFieldDisplayValue(scriptVal, `hotkey [${newId}]`);
        Preview.syncPreview();

        U.showToast(`Switched to tag script #${newId}. Use 1-9 keys to switch.`);
      }
    }, true);
  }

  function init() {
    [injectUI, setupThumbnailClickListener, setupHotkeys, Preview.init, Runner.syncQueuedOutlines].forEach(feature => {
      try {
        Promise.resolve(feature()).catch(err => U.logWarn(`tagScript.${feature.name}`, err));
      } catch (err) {
        U.logWarn(`tagScript.${feature.name}`, err);
      }
    });

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && (changes[E621_CONSTANTS.STORAGE_KEYS.TAG_SCRIPT_QUEUE] || changes[E621_CONSTANTS.STORAGE_KEYS.QUEUE_TAG_SCRIPTS_ENABLED])) {
        Runner.syncQueuedOutlines();
      }
    });
  }

  return { init, syncQueuedOutlines: Runner.syncQueuedOutlines };
});