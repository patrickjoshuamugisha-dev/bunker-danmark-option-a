/* Bunker Danmark · V11 · the update layer (2026-09-16)
   The section 2 reader lives in js/app.js (stepsEngine, FILL). This file
   only carries the switch and a QA hook: set window.__v11Fill = false before
   app.js runs to get the old band back. */
(() => {
  'use strict';
  if (typeof window.__v11Fill === 'undefined') window.__v11Fill = true;
  window.__v11Update = { version: '2026-09-16', fill: window.__v11Fill };
})();
