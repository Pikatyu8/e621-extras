/* Reads thumbnail layout preferences (card size, contain/cover, ribbons).
 * Uses third-party settings when present (see selectors.thirdParty), otherwise defaults. */
E621X.define('layout', ['selectors'], (SEL) => {
  'use strict';
  const TP = SEL.thirdParty;

  const CARD_SIZES = {
    s: { width: 120, height: 165 },
    m: { width: 160, height: 210 },
    l: { width: 220, height: 285 }
  };
  const getCardDimensions = (size = 'm') => CARD_SIZES[size] || CARD_SIZES.m;

  function getLayoutSettings() {
    const body = document.body;
    const ls = TP.localStorageKeys;

    const containInput = document.querySelector(TP.imageContainInput);
    const isContain = containInput
      ? containInput.checked
      : (body.getAttribute('data-st-contain') === 'true' || localStorage.getItem(ls.contain) === 'true');

    const checkedRadio = document.querySelector(`input[name="${TP.cardSizeRadioName}"]:checked`);
    const size = checkedRadio
      ? checkedRadio.value
      : (body.getAttribute('data-st-size') || localStorage.getItem(ls.size) || 'm');

    const ribbonsInput = document.querySelector(TP.cornerRibbonsInput);
    const showRibbons = ribbonsInput
      ? ribbonsInput.checked
      : (body.getAttribute('data-st-cornerribbons') !== 'false' && localStorage.getItem(ls.cornerRibbons) !== 'false');

    return { isContain, size, showRibbons };
  }

  /* Card size / fit are CSS variables consumed by .e621x-thumb (see styles/extras.css). */
  function applyLayoutVars(element, layout) {
    const dims = getCardDimensions(layout.size);
    element.style.setProperty('--e621x-w', `${dims.width}px`);
    element.style.setProperty('--e621x-h', `${dims.height}px`);
    element.style.setProperty('--e621x-fit', layout.isContain ? 'contain' : 'cover');
  }

  // One shared DOM listener + observer for all subscribers; fully detached when nobody listens.
  const listeners = new Set();
  let observer = null;

  const notify = () => {
    const settings = getLayoutSettings();
    listeners.forEach(cb => cb(settings));
  };

  const onDocumentChange = (e) => {
    const t = e.target;
    if (t && (t.matches?.(TP.imageContainInput) || t.name === TP.cardSizeRadioName || t.matches?.(TP.cornerRibbonsInput))) {
      notify();
    }
  };

  /* Returns an unsubscribe function. */
  function onLayoutSettingsChange(callback) {
    listeners.add(callback);
    if (listeners.size === 1) {
      document.addEventListener('change', onDocumentChange);
      observer = new MutationObserver(notify);
      observer.observe(document.body, { attributes: true, attributeFilter: TP.bodyAttrs });
    }
    return () => {
      listeners.delete(callback);
      if (listeners.size === 0) {
        document.removeEventListener('change', onDocumentChange);
        observer?.disconnect();
        observer = null;
      }
    };
  }

  return { getLayoutSettings, applyLayoutVars, onLayoutSettingsChange, getCardDimensions };
});