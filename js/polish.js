/* Bunker Danmark · V11 · the polish layer (2026-09-08)
   Runs after app.js (Lenis, ScrollTrigger, the beat engine live there).
   Adds: per-element entrances, photographs moving inside their frames, the
   hero leaning with the pointer. Nothing here moves a section or a size. */
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;
  const gsap = window.gsap, ST = window.ScrollTrigger;
  const hasGsap = !!(gsap && ST);
  window.__polish = { reduce, hasGsap, reveals: 0 };

  /* ---------- entrances ----------
     Each group lists its elements in reading order; siblings arrive 0.16s
     apart (the hero's 90ms felt right for four lines in one block; across a
     section a slower beat reads as one element after another). The line is
     6% up from the bottom edge, the one round 2b settled on. */
  const groups = [
    ['#bunkeren .section-introduction .header'],
    /* the room (2026-09-17): headline, text, then the photograph, the page's order of arrival */
    ['.room11__title', '.room11__lead', '.room11__media'],
    ['#om .section-introduction .label', '#om .section-introduction .header', '#om .section-introduction .paragraph'],
    ['.roi-calculator__form .price-lead', '.roi-calculator__form .price-points li'],
    ['.big-image-content .quote-text', '.big-image-content .quote-author'],
    ['#faq .accordion-item'],
  ];
  if (!reduce && 'IntersectionObserver' in window) {
    const targets = [];
    groups.forEach((sels) => {
      const els = sels.flatMap((s) => $$(s));
      els.forEach((el, i) => { el.setAttribute('data-pol', ''); el.style.setProperty('--d', (i * 0.16).toFixed(2) + 's'); targets.push(el); });
    });
    document.documentElement.classList.add('js-polish');
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => { if (!en.isIntersecting) return; en.target.classList.add('is-in'); io.unobserve(en.target); window.__polish.reveals++; });
    }, { threshold: 0.01, rootMargin: '0px 0px -6% 0px' });
    targets.forEach((el) => {
      if (el.getBoundingClientRect().top < innerHeight) { el.classList.add('is-in'); window.__polish.reveals++; }
      else io.observe(el);
    });
    /* a group's later siblings should not wait for their own line if the
       first one has fired: observe the group's first element and release
       the rest with it, so the stagger reads as one arrival */
    groups.forEach((sels) => {
      const els = sels.flatMap((s) => $$(s));
      if (els.length < 2) return;
      const first = els[0];
      const rest = els.slice(1);
      const release = () => rest.forEach((el) => { if (!el.classList.contains('is-in')) { el.classList.add('is-in'); io.unobserve(el); window.__polish.reveals++; } });
      if (first.classList.contains('is-in')) release();
      else {
        const io2 = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) { release(); io2.disconnect(); } }, { threshold: 0.01, rootMargin: '0px 0px -6% 0px' });
        io2.observe(first);
      }
    });
  }

  /* ---------- photographs move inside their frames ----------
     The frame stays put; the picture inside drifts a little slower than the
     page (background slower than foreground), scaled up enough that no edge
     ever shows. Section 2's frames and the three card pictures. */
  if (hasGsap && !reduce) {
    /* section 2's panel does not drift: the pinned frame moving under the
       band that reads the beats felt off (Patrick); the picture only
       settles on each beat change (css). The cards keep their drift. */
    /* the card pictures: no zoom, no scroll drift (Patrick: a constant slow
       zoom does not match the culture). The picture leans a few pixels with
       the pointer while it is over the card, and settles back. */
    if (fine) {
      $$('#fordele .product-grid__card').forEach((card) => {
        const pic = $('.product-grid__card-media .media-el picture', card);
        if (!pic) return;
        gsap.set(pic, { scale: 1.06, transformOrigin: '50% 50%' });
        /* 2026-09-17, Patrick: too quick and too much movement; only a little, and never fast. The
           picture now travels 4px by 3px at most (was 12 by 8) and takes 2.6s to get there (was 1.2s).
           It still starts the moment the hand moves, so it answers; it just never hurries. */
        gsap.set(pic, { scale: 1.03 });
        const toX = gsap.quickTo(pic, 'x', { duration: 2.6, ease: 'power3.out' });
        const toY = gsap.quickTo(pic, 'y', { duration: 2.6, ease: 'power3.out' });
        card.addEventListener('pointermove', (e) => {
          const r = card.getBoundingClientRect();
          toX(((e.clientX - r.left) / r.width - 0.5) * 4);
          toY(((e.clientY - r.top) / r.height - 0.5) * 3);
        });
        card.addEventListener('pointerleave', () => { toX(0); toY(0); });
      });
    }
  }

  /* ---------- the room photograph leans with the pointer ----------
     The card pictures' own move (no zoom, no scroll drift), a little slower because the frame is
     four times the size: a heavy thing seen through an opening drifts. */
  const roomFig = $('.room11__media');
  if (roomFig && hasGsap && !reduce && fine) {
    const pic = $('img', roomFig);
    /* 2026-09-17, Patrick: calmer. 5px by 4px at most (was 14 by 10), 3s to arrive (was 1.6s). */
    gsap.set(pic, { scale: 1.03, transformOrigin: '50% 50%' });
    const toX = gsap.quickTo(pic, 'x', { duration: 3, ease: 'power3.out' });
    const toY = gsap.quickTo(pic, 'y', { duration: 3, ease: 'power3.out' });
    roomFig.addEventListener('pointermove', (e) => {
      const r = roomFig.getBoundingClientRect();
      toX(((e.clientX - r.left) / r.width - 0.5) * 5);
      toY(((e.clientY - r.top) / r.height - 0.5) * 4);
    });
    roomFig.addEventListener('pointerleave', () => { toX(0); toY(0); });
  }

  /* ---------- the spotlight on the cards ----------
     The 21st.dev spotlight card (jahed) reduced to what our page needs: the
     pointer's position in the card's own space, written as two custom
     properties; the CSS draws the lit rim and the spot from them. Nothing
     runs when the pointer is not over a card. */
  if (fine && !reduce) {
    $$('#fordele .product-grid__card').forEach((card) => {
      card.addEventListener('pointermove', (e) => {
        const r = card.getBoundingClientRect();
        card.style.setProperty('--mx', (e.clientX - r.left).toFixed(1) + 'px');
        card.style.setProperty('--my', (e.clientY - r.top).toFixed(1) + 'px');
      });
      card.addEventListener('pointerenter', () => card.style.setProperty('--spot', '1'));
      card.addEventListener('pointerleave', () => card.style.setProperty('--spot', '0'));
    });
  }

  /* ---------- the hero leans with the pointer ----------
     Fine pointers only. A few pixels, slow, the way a scene shifts when you
     lean. Composes with the tuned exit in app.js (GSAP owns both). */
  const heroPhoto = $('.video-carousel > .wrapper > span');
  const heroSection = $('.video-carousel');
  if (heroPhoto && heroSection && hasGsap && !reduce && fine) {
    const toX = gsap.quickTo(heroPhoto, 'x', { duration: 1.6, ease: 'power2.out' });
    const toY = gsap.quickTo(heroPhoto, 'y', { duration: 1.6, ease: 'power2.out' });
    heroSection.addEventListener('pointermove', (e) => {
      const r = heroSection.getBoundingClientRect();
      toX(((e.clientX - r.left) / r.width - 0.5) * 14);
      toY(((e.clientY - r.top) / r.height - 0.5) * 8);
    });
    heroSection.addEventListener('pointerleave', () => { toX(0); toY(0); });
  }

  /* ---------- text parallax ----------
     Patrick: the text feels plastered on the page. Each text block rides at
     1.05 of the page across its section's transit (viewport + section), so
     it lifts a little off the ground; nothing else moves. Eased by a short
     scrub; reverses exactly. Blocks that already have their own tuned
     entrance and sit inside a moving composition are left out: the Fordele
     heading (Patrick: the way it scrolls is weird, two motions on one
     element) and the Kontakt copy (that section is settled). The hero
     photograph's own rise lives in app.js. */
  if (hasGsap && !reduce && innerWidth >= 1024) {
    const layer = (sel, trigger, speed) => {
      $$(sel).forEach((el) => {
        el.classList.add('pol-layer');
        const trig = $(trigger) || el;
        const half = () => (speed - 1) * (innerHeight + trig.offsetHeight) / 2;
        gsap.fromTo(el, { '--py': () => half() + 'px' }, {
          '--py': () => -half() + 'px', ease: 'none', immediateRender: true,
          scrollTrigger: { trigger: trig, start: 'top bottom', end: 'bottom top', scrub: 0.7, invalidateOnRefresh: true },
        });
      });
    };
    layer('#bunkeren .section-content', '#bunkeren .section-introduction', 1.05);
    layer('.room11__text', '.room11', 1.05);
    layer('#om .section-content', '#om', 1.05);
    layer('.big-image-content .quote-block', '.big-image-content', 1.05);
    /* the FAQ moves on its own column, not on the section: opening an
       accordion grows the section, and a travel measured off the section
       then re-maps under a still page (Patrick: the whole side moves when I
       expand something). The left column's own height never changes. */
    layer('#faq .tabbed-accordion__richtext', '#faq .tabbed-accordion__richtext', 1.05);
    window.__polish.layers = $$('.pol-layer').length;
  }

  if (hasGsap) { addEventListener('load', () => ST.refresh()); if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => ST.refresh()); }
})();
