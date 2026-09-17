/* js/stack.js — section 3 stack driver (walkthrough 2026-09-05, point 25).
   Reads the section's scroll progress and hands each card a --p (own travel
   0..1) and --depth (how many cards sit on top of it). Card 0 is already in
   place when the stage pins. The intro's height is measured so the stage
   can sit under it (--stack-intro-h) and the stack is centred in the room
   the intro leaves (--stack-shift). */
(() => {
  'use strict';
  if (!document.documentElement.hasAttribute('data-stack')) return;
  if (innerWidth < 1024) return;
  const sec = document.querySelector('#fordele');
  if (!sec) return;
  const intro = sec.querySelector('.product-grid__intro');
  const grid = sec.querySelector('.product-grid__grid');
  /* the heading rides inside the pinned stage, so the two leave the screen
     together when the section ends (as siblings, the taller stage was pushed
     up first and the last card slid under the heading) */
  if (intro && grid && intro.parentNode !== grid) grid.prepend(intro);
  const cards = [...sec.querySelectorAll('.product-grid__card')];
  const n = cards.length;
  if (n < 2) return;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  let progress = 0;

  const size = () => {
    const ih = intro ? intro.offsetHeight : 0;
    sec.style.setProperty('--stack-intro-h', ih + 'px');
    // the intro sits at top 112; the card is centred in what is left below it
    sec.style.setProperty('--stack-shift', Math.round((112 + ih) / 2) + 'px');
  };

  const paint = () => {
    const r = sec.getBoundingClientRect();
    const travel = r.height - innerHeight;
    progress = clamp(-r.top / (travel || 1), 0, 1);
    cards.forEach((c, i) => {
      const from = (i - 1) / (n - 1);
      const to = i / (n - 1);
      const p = i === 0 ? 1 : clamp((progress - from) / (to - from), 0, 1);
      const e = 1 - Math.pow(1 - p, 3); // eased: the card decelerates into place
      let depth = 0;
      for (let k = i + 1; k < n; k++) {
        const kf = (k - 1) / (n - 1), kt = k / (n - 1);
        depth += clamp((progress - kf) / (kt - kf), 0, 1);
      }
      c.style.setProperty('--p', e.toFixed(4));
      c.style.setProperty('--depth', depth.toFixed(4));
      c.style.zIndex = String(10 + i);
    });
  };
  window.__stackProgress = () => progress;
  size();
  paint();
  addEventListener('scroll', paint, { passive: true });
  addEventListener('resize', () => { size(); paint(); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { size(); paint(); });
})();
