/* The only place that talks to the site API: one global throttle + bounded retries with backoff. */
E621X.define('net', ['utils'], (U) => {
  'use strict';

  const MIN_INTERVAL_MS = 550;      // spacing between ANY two requests from this tab
  const MAX_RETRIES = 4;
  const BASE_BACKOFF_MS = 2000;
  const MAX_BACKOFF_MS = 30000;
  const RETRY_STATUSES = new Set([429, 502, 503, 504]);

  class HttpError extends Error {
    constructor(status, url) {
      super(status ? `HTTP ${status}` : 'Network error');
      this.name = 'HttpError';
      this.status = status;
      this.url = url;
    }
  }

  let nextSlot = 0;
  function waitForSlot() {
    const now = Date.now();
    const slot = Math.max(now, nextSlot);
    nextSlot = slot + MIN_INTERVAL_MS;
    return U.sleep(slot - now);
  }

  function backoffDelay(attempt, res) {
    const retryAfter = Number(res?.headers.get('Retry-After'));
    if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.min(retryAfter * 1000, MAX_BACKOFF_MS);
    return Math.min(BASE_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS);
  }

  /* Resolves with any non-retryable response (including 4xx); throws HttpError when retries are exhausted. */
  async function request(url, init = {}, { retries = MAX_RETRIES } = {}) {
    for (let attempt = 0; ; attempt++) {
      await waitForSlot();
      let res = null;
      try {
        res = await fetch(url, init);
      } catch (err) {
        if (attempt >= retries) throw new HttpError(0, url);
      }
      if (res && !RETRY_STATUSES.has(res.status)) return res;
      if (attempt >= retries) throw new HttpError(res.status, url);
      await U.sleep(backoffDelay(attempt, res));
    }
  }

  async function fetchJson(url, init, opts) {
    const res = await request(url, init, opts);
    if (!res.ok) throw new HttpError(res.status, url);
    return res.json();
  }

  function sendForm(url, method, params, opts) {
    return request(url, {
      method,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-CSRF-Token': U.getCsrfToken()
      },
      body: new URLSearchParams(params).toString()
    }, opts);
  }

  return { request, fetchJson, sendForm, HttpError };
});