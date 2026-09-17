/* Story lab (2026-09-17): the room block's entrance and the picture's slow drift. Additive. */
(() => {
  'use strict';
  const room = document.querySelector('.s11-room');
  if (!room) return;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const els = [room.querySelector('.s11-room__title'), room.querySelector('.s11-room__lead')].filter(Boolean);
  els.forEach((el, i) => { el.setAttribute('data-s11', ''); el.style.setProperty('--d', (i * 0.16).toFixed(2) + 's'); });
  if (reduce || !('IntersectionObserver' in window)) { els.forEach((el) => el.classList.add('is-in')); return; }
  const io = new IntersectionObserver((en) => { if (en.some((e) => e.isIntersecting)) { els.forEach((el) => el.classList.add('is-in')); io.disconnect(); } }, { threshold: 0.2 });
  io.observe(room);
  const gsap = window.gsap, ST = window.ScrollTrigger;
  if (gsap && ST) gsap.fromTo(room.querySelector('img'), { yPercent: -4 }, { yPercent: 4, ease: 'none', scrollTrigger: { trigger: room, start: 'top bottom', end: 'bottom top', scrub: true } });
})();
