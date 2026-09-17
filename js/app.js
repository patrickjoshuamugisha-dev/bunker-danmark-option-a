/* ---------------------------------------------------------------------------
   app.js — behaviour rebuilt in plain JS to match Terminal's own app.

   Their site is Nuxt/Vue with GSAP + ScrollTrigger + Lenis bundled inside the
   app chunks. We can't run their bundle (it hydrates against their APIs and
   ships their tracking), so the behaviours are rebuilt here from what their CSS
   and DOM actually require, cross-checked against the reference study in
   projects/magnus-bunker/reference-map-terminal.md §4.

   The rule followed throughout: their CSS already contains the whole animation.
   JS only sets the state their Vue components would set — a class, a custom
   property, a transform. Nothing is re-styled here.
--------------------------------------------------------------------------- */
(() => {
  'use strict';

  const gsap = window.gsap;
  const ScrollTrigger = window.ScrollTrigger;
  if (gsap && ScrollTrigger) gsap.registerPlugin(ScrollTrigger);

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  /* =======================================================================
     1. splash
     The SSR markup ships a fixed z-999 .app-loader; their app removes it once
     mounted. Without that the page sits under a grey sheet.
     ======================================================================= */
  const dropLoader = () => $$('.app-loader').forEach((el) => el.remove());
  if (document.readyState === 'complete') dropLoader();
  else addEventListener('load', dropLoader);

  /* =======================================================================
     2. measured layout vars
     Their CSS reserves room for the logo-wall intro with
       padding-top: calc(var(--lw-intro-h, 10rem) + min(3.854vw, 98.667px))
     and their JS sets --lw-intro-h to the intro's measured height. Without it
     the 10rem fallback applies and the section runs 20px tall (live: 140px).
     ======================================================================= */
  const setIntroHeight = () => {
    $$('.has-intro').forEach((section) => {
      const intro = $('.logo-wall-intro', section);
      if (intro) section.style.setProperty('--lw-intro-h', `${Math.round(intro.getBoundingClientRect().height)}px`);
    });
  };

  /* =======================================================================
     3. the notch clip paths
     Every notched panel on the site is an inline SVG clipPath with
     clipPathUnits="userSpaceOnUse" and a viewBox equal to the panel's measured
     size. The SSR markup ships a DEGENERATE path — every coordinate 0 — and a
     Vue component rewrites it once mounted. Copy the markup without the JS and
     each notched panel clips to nothing: the features media panel, the section
     separators and the quote panel all render empty.

     Their generator's parameters (depth, corner radius, shoulder angle) vary per
     panel and can't be recovered reliably from the output, so instead we carry
     their OWN generated geometry: qa/t10-notch.mjs reads every clipPath off the
     live page at 390 / 768 / 1440 and writes media/notches.json. The clipPath ids
     are SSR-stable and every panel box matches ours exactly (verified: 14/14 ids,
     14/14 boxes), so applying them by id is exact, not an approximation.

     Limitation, stated plainly: geometry is exact at the three captured widths
     and uses the nearest one in between. Re-run t10-notch.mjs to add widths.
     ======================================================================= */
  /* The clip-path is gated behind :not(.ssr):
       .slot:not(.ssr).use-clip { clip-path: var(--d27fb6da) }
       .slot:not(.ssr):not(.use-clip) { mask-image: var(--b18bdda2) }
     The SSR markup ships class="ssr use-clip slot" and their component drops the
     `ssr` marker on mount, which is what switches the clip on. Until that happens
     no notch renders at all, real path or not. */
  const unsetSsr = () => $$('.slot.ssr, .ssr.use-clip').forEach((el) => el.classList.remove('ssr'));

  let NOTCHES = null;

  /* The geometry is carried at eight viewport widths — 390, 768, 1024, 1280,
     1440, 1728, 1990, 2560 — because their generator's parameters are genuinely
     responsive and not a formula you can derive from a few samples. Measured on
     the live page, the notch inset drifts from 0.134w to 0.158w and its depth
     steps 20 -> 29 -> 40 -> 43 across that range: no single equation fits it.

     Snapping to the nearest capture is what shipped before, with only three
     widths, and it was the bug behind "the white panel is off-centre and the
     right side of the page is cut off". On a 1990px window every full-bleed
     panel was clipped by 1441px-wide geometry, so 549px of it was cut away and
     the notch sat left of centre. Verified with qa/t10-notchwidths.mjs: 11 of
     14 panels mismatched.

     So: interpolate between the two captures that bracket the current width,
     then pin the result to the panel's own measured box. Both halves matter —
     interpolation gets the notch right between captures, and the box correction
     means a panel can never be clipped smaller than it actually is, whatever
     the width or however tall our Danish copy makes it. */

  // numbers in a path, in order — the command letters are what we key on to
  // know two paths are the same shape and therefore safe to interpolate
  const pathShape = (d) => d.replace(/[-\d.,\s]+/g, ' ').trim();
  const pathNums = (d) => (d.match(/-?[\d.]+/g) || []).map(Number);
  const withNums = (d, nums) => {
    let i = 0;
    return d.replace(/-?[\d.]+/g, () => {
      const v = nums[i++];
      return Math.abs(v % 1) < 0.005 ? String(Math.round(v)) : v.toFixed(2);
    });
  };

  const interpolate = (a, b, t) => {
    // only when the two captures describe the same shape; across a breakpoint
    // (mobile vs desktop) the node count changes and blending would be nonsense
    if (pathShape(a.d) !== pathShape(b.d)) return t < 0.5 ? a : b;
    const na = pathNums(a.d);
    const nb = pathNums(b.d);
    if (na.length !== nb.length) return t < 0.5 ? a : b;
    return {
      d: withNums(a.d, na.map((v, i) => v + (nb[i] - v) * t)),
      box: [a.box[0] + (b.box[0] - a.box[0]) * t, a.box[1] + (b.box[1] - a.box[1]) * t],
    };
  };

  /* -----------------------------------------------------------------------
     3b. the notch GENERATOR — their own maths, for the two panels that need it

     Carrying captured geometry (above) is exact for a fixed shape at a fixed
     size, and wrong the moment a panel has to change size or the notch has to
     move. Two panels do both: the quote panel (which needs a notch on the top
     edge as well as the bottom) and the footer (whose notch inverts as the
     footer arrives). Both are rebuilt from their generator instead.

     Reimplemented from their chunk Ce9y8GUk.js, function m(b): four points per
     notch, C = (1 - notchWidth) * width * 0.25 as the shoulder inset, corner
     radius (40 / size) * radius * 0.01, polyline rounded with tangent arcs.
     ----------------------------------------------------------------------- */
  const FOOTER_NOTCH = { offset: 30 };

  const notchPoints = (w, h, b) => {
    const C = (1 - (b.notchWidth ?? 0.9)) * w * 0.25;
    const x0 = w * (b.position - b.size / 2) - C;
    const x1 = w * (b.position - b.size / 2) + C;
    const x2 = w * (b.position + b.size / 2) - C;
    const x3 = w * (b.position + b.size / 2) + C;
    // `radius` is a real pixel radius, handed in by the caller. It used to go
    // through a formula that produced ~49px for every panel; their live clips
    // carry 63.9px on the quote and 83.9px on the footer, and that gap is what
    // made ours read as a spiky chevron next to their soft shelf.
    const r = b.radius ?? 20;
    const t = b.backoff;
    if (b.direction === 'top')
      return [
        { x: x0, y: 0, r, t }, { x: x1, y: b.offset, r, t },
        { x: x2, y: b.offset, r, t }, { x: x3, y: 0, r, t },
      ];
    return [
      { x: x3, y: h, r, t }, { x: x2, y: h - b.offset, r, t },
      { x: x1, y: h - b.offset, r, t }, { x: x0, y: h, r, t },
    ];
  };

  /* Round a polyline with tangent arcs (their Qc()): at each interior point,
     replace the corner with a circular arc of radius r that touches both
     segments. Circles stay circles at any panel size, which is why this exists
     rather than a carried path.

     The back-off along each segment is NOT the radius — it is r * tan(θ/2),
     where θ is how far the line actually turns. Treating them as the same
     number is only correct at a right angle, and every notch shoulder here
     turns about 8°. Rendered and looked at: at 8° it backed off 30px and then
     asked for a 30-radius arc between two points 59px apart, so SVG inflated
     the radius to fit and drew a near-semicircle. The result was a round nub
     hanging off each shoulder instead of a soft shallow tray. */
  const roundedPath = (pts) => {
    let d = `M ${pts[0].x.toFixed(2)},${pts[0].y.toFixed(2)}`;
    for (let i = 1; i < pts.length - 1; i++) {
      const p = pts[i];
      const a = pts[i - 1];
      const b = pts[i + 1];
      const la = Math.hypot(p.x - a.x, p.y - a.y);
      const lb = Math.hypot(b.x - p.x, b.y - p.y);
      const corner = () => (d += ` L ${p.x.toFixed(2)},${p.y.toFixed(2)}`);
      if ((!p.r && p.t == null) || !la || !lb) { corner(); continue; }

      // turn angle between the incoming and outgoing directions
      const dot = clamp(((p.x - a.x) * (b.x - p.x) + (p.y - a.y) * (b.y - p.y)) / (la * lb), -1, 1);
      const theta = Math.acos(dot);
      if (theta < 0.001) { corner(); continue; }        // straight through

      const half = Math.tan(theta / 2);
      /* A point may carry a BACK-OFF (t, in px along each segment) instead of a
         radius. Their seam folds keep t at 12.34px whatever the depth, so the
         radius GROWS as the fold flattens: 27.7 at depth 40, 43.6 at 22, 102 at
         9, 342 at 2.7 - every one of those measured off the live clip and every
         one reproduced by t / tan(theta/2). That is why a flattening fold reads
         as paper relaxing rather than as a bump shrinking. */
      let t = p.t != null ? p.t : p.r * half;
      let r = p.t != null ? t / half : p.r;
      const maxT = Math.min(la / 2, lb / 2);
      if (t > maxT) { t = maxT; r = t / half; }         // shrink to fit, keep it tangent

      const ax = p.x - ((p.x - a.x) / la) * t;
      const ay = p.y - ((p.y - a.y) / la) * t;
      const bx = p.x + ((b.x - p.x) / lb) * t;
      const by = p.y + ((b.y - p.y) / lb) * t;
      const cross = (p.x - a.x) * (b.y - p.y) - (p.y - a.y) * (b.x - p.x);
      d += ` L ${ax.toFixed(2)},${ay.toFixed(2)}` +
           ` A ${r.toFixed(2)},${r.toFixed(2)} 0 0 ${cross > 0 ? 1 : 0} ${bx.toFixed(2)},${by.toFixed(2)}`;
    }
    const last = pts[pts.length - 1];
    return `${d} L ${last.x.toFixed(2)},${last.y.toFixed(2)}`;
  };

  /* A whole panel: across the top (with an optional top notch), down the right
     side, back across the bottom (with an optional bottom notch), up the left. */
  const panelPath = (w, h, notches) => {
    const top = notches.find((n) => n.direction === 'top');
    const bottom = notches.find((n) => n.direction === 'bottom');
    const pts = [{ x: -0.5, y: -0.5, r: 0 }];
    if (top) pts.push(...notchPoints(w, h, top));
    pts.push({ x: w + 0.5, y: -0.5, r: 0 }, { x: w + 0.5, y: h + 0.5, r: 0 });
    if (bottom) pts.push(...notchPoints(w, h, bottom));
    pts.push({ x: -0.5, y: h + 0.5, r: 0 });
    return `${roundedPath(pts)} Z`;
  };

  /* The two panels driven by the generator instead of by notches.json. The ids
     are SSR-stable; both verified against the built index.html. */
  /* THE SEAM FOLDS SCRUB WITH THE SCROLL.

     Measured on terminal-industries.com (qa/_term3.mjs, 1440x900, seven scroll
     positions): the fold between two sections is 40px deep when the seam is at
     the bottom of the screen and 2.7px when it reaches the top - linear in the
     seam's viewport y. Ours was the captured clip, frozen at depth 40 wherever
     the seam sat, which is why the corners never looked right on Patrick's
     screen: he was seeing a 40px tab at the top of the window where theirs is
     already flat.

     The geometry underneath is one shape at every width in notches.json
     (derived in this session from all eight captures): vertices at
     0.1625w / 0.1875w / 0.8125w / 0.8375w, i.e. size 0.65, notchWidth 0.95,
     a 12.34px back-off at every corner, depth 40 at 1024 and up, 20 below.
     So the captures are no longer used for the seams; the shape is generated
     per frame from the seam's own position. */
  const SEAM = { size: 0.65, position: 0.5, notchWidth: 0.95, backoff: 12.34 };
  const seamDepthMax = () => (innerWidth < 1024 ? 20 : 40);
  /* Round three. Terminal's fold really does flatten as the seam rises -
     re-measured 2026-09-04: 35.6px deep at viewport y 800, 17.8 at 400, 5.3 at
     120 (qa/r3-term2.mjs) - and that is what shipped in round two. Patrick,
     seeing it: "starts off rounded and becomes flat... I don't think I like
     it." So the fold holds its full depth wherever the seam sits. One flag
     brings their behaviour back. */
  const SEAM_SCRUB = false;
  const edgeDepth = (y) => (SEAM_SCRUB ? seamDepthMax() * clamp(y / innerHeight, 0, 1) : seamDepthMax());
  const holderRect = (cp) => {
    const svg = cp && cp.closest('svg');
    const el = svg && svg.parentElement;
    return el ? el.getBoundingClientRect() : null;
  };
  const seamNotch = (direction, offset) => ({
    direction, offset,
    size: SEAM.size, position: SEAM.position, notchWidth: SEAM.notchWidth, backoff: SEAM.backoff,
  });
  const seamPath = (w, h, cp) => {
    const r = holderRect(cp);
    return panelPath(w, h, [seamNotch('top', r ? edgeDepth(r.top) : seamDepthMax())]);
  };

  /* The panels driven by the generator instead of by notches.json. The ids
     are SSR-stable; all verified against the built index.html. Each generator
     gets the clipPath itself so it can read where its panel sits on screen. */
  const footerClipPath = (w, h) => {
    const s = w / 1470;
    const x = (v) => (v * s).toFixed(2);
    const r1 = (63.1 * s).toFixed(2);
    const r2 = (62.72 * s).toFixed(2);
    const W = (w + 0.5).toFixed(2);
    const H = (h + 0.5).toFixed(2);
    return `M -0.5,-0.5 L ${x(208.19)},-0.03 A ${r1},${r1} 0 0 1 ${x(231.9)},4.65 L ${x(282.6)},25.35 A ${r2},${r2} 0 0 0 ${x(306.31)},30 L ${x(1163.69)},30 A ${r2},${r2} 0 0 0 ${x(1187.4)},25.35 L ${x(1238.1)},4.65 A ${r1},${r1} 0 0 1 ${x(1261.81)},-0.03 L ${W},-0.5 L ${W},${H} L -0.5,${H} Z`;
  };

  const PARAMETRIC = {
    /* the two section seams: hero -> Bunkeren, Fordele -> Kontakt */
    'clip-v-0-0-0-0-1-0': seamPath,
    'clip-v-0-0-0-0-4-0': seamPath,
    /* THE QUOTE PANEL: the same fold on both edges, each scrubbed by where
       that edge is. Their own clip leaves the bottom flat - the fold under
       their quote comes from the next section overlapping onto it - but ours
       folds the panel itself on both edges, which is what Patrick asked for
       and approved ("spot on"). */
    'clip-v-0-0-0-0-12-0': (w, h, cp) => {
      const r = holderRect(cp);
      return panelPath(w, h, [
        seamNotch('top', r ? edgeDepth(r.top) : seamDepthMax()),
        seamNotch('bottom', r ? edgeDepth(r.bottom) : seamDepthMax()),
      ]);
    },
    /* The footer, matched to their live clip: depth 30, plateau x 410->1580,
       shoulder radius 83.94 (= 0.0422 x width). Its offset is animated 6 -> 30
       as the footer arrives, so the fold deepens — see footerReveal. */
    /* Round 2 (2026-09-07, point 16): their clip verbatim, read off the live
       footer at 1470 (qa/w2-terminal-footer.mjs): 30 deep at every scroll
       position, shoulders 208 -> 306 and 1164 -> 1262, radii 63. Only x is
       scaled to the width; the depth is a constant. */
    'clip-v-0-0-0-0': (w, h) => footerClipPath(w, h),
  };

  /* Move the outer rectangle onto the panel's real box.

     These paths are a notch cut into the top edge plus the four corners of the
     panel. The corners are the coordinates sitting at the captured width and
     height, so they can be identified by value and moved — no guessing which
     node is which. Anything below the notch (the side notch on the features
     panel, for instance) is a fraction of the panel's height, so it scales with
     it. */
  const fitToBox = (geo, w, h) => {
    const [cw, ch] = geo.box;
    if (Math.abs(cw - w) < 0.5 && Math.abs(ch - h) < 0.5) return geo.d;
    const NOTCH_MAX_Y = 60; // deepest a top notch goes at any captured width
    const sy = h / ch;
    const dx = w - cw;

    /* THE TOP NOTCH MOVES AS ONE PIECE.

       This used to be decided per point: `x > cw/2` rode the right edge,
       anything left of centre stayed put. That works for a notch that straddles
       the middle and breaks badly for one that does not. The results panel's
       notch runs x=297 to x=584 of 630 - it sits in the right half, but its
       left shoulder at 297 and 311 falls just under the 315 midline. So on a
       462px-wide panel the left shoulder stayed at 311 while the right shoulder
       moved to 150, and the path crossed over itself. A self-intersecting clip
       renders as a plain rectangle, which is exactly why our version lost the
       folder shape that Terminal's has and ours was drawn as a box.

       So the notch's own centre decides for the whole notch: sitting in the
       right half, every point in it shifts by the same delta and the cut keeps
       its width and its shape. */
    let nLo = Infinity, nHi = -Infinity;
    {
      const re = /([MLA])\s*([-\d.,\s]+)/g;
      let m;
      while ((m = re.exec(geo.d))) {
        const v = m[2].trim().split(/[\s,]+/).map(Number);
        const step = m[1] === 'A' ? 7 : 2;
        const off = m[1] === 'A' ? 5 : 0;
        for (let i = 0; i + step - 1 < v.length; i += step) {
          const x = v[i + off], y = v[i + off + 1];
          if (y > NOTCH_MAX_Y || x <= 31) continue;          // side notch or body
          if (Math.abs(x - cw) < 1.5 || Math.abs(x + 0.5) < 1.5) continue; // the corners
          if (x < nLo) nLo = x;
          if (x > nHi) nHi = x;
        }
      }
    }
    const notchRidesRight = nHi > -Infinity && (nLo + nHi) / 2 > cw / 2;

    const mapPt = (x, y) => {
      // right edge: any x at the captured width belongs to the outer rect
      if (Math.abs(x - cw) < 1.5 || Math.abs(x - (cw + 0.5)) < 1.5) x = w + 0.5;
      else if (notchRidesRight && y <= NOTCH_MAX_Y && x >= nLo - 0.5 && x <= nHi + 0.5)
        x = x + dx;                            // the whole top notch, one piece
      else if (x > cw / 2) x = w - (cw - x); // notch's right shoulder rides the edge
      // bottom edge likewise; the top notch keeps its depth, deeper geometry scales
      if (Math.abs(y - ch) < 1.5 || Math.abs(y - (ch + 0.5)) < 1.5) y = h + 0.5;
      // a node sitting inside the notch depth on the LEFT edge belongs to a side
      // notch, not a top one, so it scales with the panel however small its y is.
      // Without this the features panel's notch was stretched: its lower shoulder
      // scaled with the panel and its upper one did not.
      else if (y > NOTCH_MAX_Y || (x <= 31 && y > 5)) y *= sy;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    };

    /* Walk by COMMAND, not by "every pair of numbers in the string".
       An arc is `A rx,ry rot large-arc sweep x,y` — its first pair is a RADIUS,
       not a point. The old blanket regex ran the radius through the same
       mapping, so ry got multiplied by the height ratio and every rounded
       corner turned into an ellipse. That is what made the footer's notch
       angles look wrong at any width other than the captured one. */
    return geo.d.replace(/([MLA])\s*([-\d.,\s]+)/g, (_, cmd, nums) => {
      const v = nums.trim().split(/[\s,]+/).map(Number);
      if (cmd === 'A') {
        const out = [];
        for (let i = 0; i + 6 < v.length; i += 7)
          out.push(`${v[i]},${v[i + 1]} ${v[i + 2]} ${v[i + 3]} ${v[i + 4]} ${mapPt(v[i + 5], v[i + 6])}`);
        return `A ${out.join(' A ')} `;
      }
      const out = [];
      for (let i = 0; i + 1 < v.length; i += 2) out.push(mapPt(v[i], v[i + 1]));
      return `${cmd} ${out.join(' L ')} `;
    });
  };

  /* One notch on the page MOVES: the features media panel's, which travels down
     its left edge as you scroll the four beats. That is their behaviour, not an
     invention — their FeaturesSteps component holds the notch as a reactive
     object and scrubs `position` from 0.3 to 0.7 of the panel height (measured
     in their chunk B3ora7rO.js: `gsap.set(k, {position: Lerp(.3,.7,progress)})`).
     A notch frozen at 0.3 is the "gap that just stays in the middle" — the panel
     stops feeling connected to the text beside it.

     Rather than author a second path generator, their own captured geometry is
     shifted: every node of the notch sits at x < 31 (the notch is 30px deep) and
     away from the panel's corners, so the notch nodes can be picked out by value
     and moved down together. The travel is 0.4 of the panel height, which is
     exactly 0.3 -> 0.7. */
  let NOTCH_SHIFT = { id: null, dy: 0 };
  const shiftNotch = (d, h, dy) => {
    if (!dy) return d;
    // command-aware for the same reason fitToBox is: an arc's first pair is a
    // radius, and a small radius like `24,24` passes the x<=31 notch test.
    const move = (x, y) =>
      x > 31 || y < 5 || y > h - 5 ? `${x},${y}` : `${x},${(y + dy).toFixed(2)}`;
    return d.replace(/([MLA])\s*([-\d.,\s]+)/g, (_, cmd, nums) => {
      const v = nums.trim().split(/[\s,]+/).map(Number);
      if (cmd === 'A') {
        const out = [];
        for (let i = 0; i + 6 < v.length; i += 7)
          out.push(`${v[i]},${v[i + 1]} ${v[i + 2]} ${v[i + 3]} ${v[i + 4]} ${move(v[i + 5], v[i + 6])}`);
        return `A ${out.join(' A ')} `;
      }
      const out = [];
      for (let i = 0; i + 1 < v.length; i += 2) out.push(move(v[i], v[i + 1]));
      return `${cmd} ${out.join(' L ')} `;
    });
  };

  /* WIDEN THE FOLDER TAB.

     The top notch is a folder cut: the edge runs flat, dips down, runs along
     the floor and comes back up. The flat run on the left is the tab, and on
     the assessment card it was 227px of a 560px edge. Patrick wanted it a
     little bigger. Every point on the LEFT shoulder moves right by dx, which
     widens the tab and narrows the notch floor by the same amount; the right
     shoulder and both flat ends are left alone, so the silhouette is still
     their shape, just balanced differently.

     Left shoulder is decided by the notch's own midpoint, not by the card's -
     this notch sits right of centre, so half-the-card would have caught the
     wrong points. */
  const widenTab = (d, dx) => {
    if (!dx) return d;
    const MAXY = 60;
    // first pass: find the horizontal extent of the notch
    let lo = Infinity, hi = -Infinity;
    d.replace(/([MLA])\s*([-\d.,\s]+)/g, (_, cmd, nums) => {
      const v = nums.trim().split(/[\s,]+/).map(Number);
      const step = cmd === 'A' ? 7 : 2;
      for (let i = 0; i + step - 1 < v.length; i += step) {
        const x = v[i + step - 2], y = v[i + step - 1];
        if (y <= MAXY && y > -0.4 && x > 31) { lo = Math.min(lo, x); hi = Math.max(hi, x); }
      }
      return '';
    });
    if (!isFinite(lo)) return d;
    const mid = (lo + hi) / 2;
    const move = (x, y) =>
      y <= MAXY && y > -0.4 && x > 31 && x < mid ? `${(x + dx).toFixed(2)},${y}` : `${x},${y}`;
    return d.replace(/([MLA])\s*([-\d.,\s]+)/g, (_, cmd, nums) => {
      const v = nums.trim().split(/[\s,]+/).map(Number);
      if (cmd === 'A') {
        const out = [];
        for (let i = 0; i + 6 < v.length; i += 7)
          out.push(`${v[i]},${v[i + 1]} ${v[i + 2]} ${v[i + 3]} ${v[i + 4]} ${move(v[i + 5], v[i + 6])}`);
        return `A ${out.join(' A ')} `;
      }
      const out = [];
      for (let i = 0; i + 1 < v.length; i += 2) out.push(move(v[i], v[i + 1]));
      return `${cmd} ${out.join(' L ')} `;
    });
  };

  const notchWidths = () => Object.keys(NOTCHES).map(Number).sort((a, b) => a - b);

  /* The element a clip is actually applied to, so its real box can be read. */
  const notchTarget = (cp) => {
    const svg = cp.closest('svg');
    const holder = svg && svg.parentElement;
    const target = holder && (holder.querySelector('.slot, .use-clip') || holder);
    /* offsetWidth/offsetHeight, NOT getBoundingClientRect.

       getBoundingClientRect returns the element's box AFTER every ancestor
       transform. The assessment card's scroll entrance holds it at scale(0.985)
       until it lands, so any notch fitted while that transform was live was
       fitted to a 551.6px box and then painted onto a 560px card: the whole cut
       came out 6px narrow and, at whatever scale the entrance happened to be at
       when the ResizeObserver last fired, the top-left shoulder walked left by
       up to 90px. That is why the live card's folder tab kept coming out
       smaller than card-lab.html's, which has no entrance and therefore never
       measured a scaled box. offsetWidth is the layout size and ignores
       transforms entirely. */
    const box = target
      ? { width: target.offsetWidth, height: target.offsetHeight }
      : null;
    return { svg, box };
  };

  const paintNotch = (cp) => {
    // generated panels first: they do not appear in notches.json at all
    if (PARAMETRIC[cp.id]) {
      const path = $('path', cp);
      const { svg, box } = notchTarget(cp);
      if (!path || !box || !box.width) return;
      path.setAttribute('d', PARAMETRIC[cp.id](box.width, box.height, cp));
      if (svg) svg.setAttribute('viewBox', `-0.5 -0.5 ${(box.width + 1).toFixed(2)} ${(box.height + 1).toFixed(2)}`);
      return;
    }
    if (!NOTCHES) return;
    const widths = notchWidths();
    const vw = innerWidth;
    // the bracketing pair, clamped at both ends
    let lo = widths[0];
    let hi = widths[widths.length - 1];
    for (const w of widths) if (w <= vw) lo = w;
    for (const w of [...widths].reverse()) if (w >= vw) hi = w;
    const t = hi === lo ? 0 : (vw - lo) / (hi - lo);

    const a = NOTCHES[String(lo)][cp.id];
    const b = NOTCHES[String(hi)][cp.id];
    const path = $('path', cp);
    if (!a || !b || !path) return;
    const geo = lo === hi ? a : interpolate(a, b, t);

    // the element this clip is actually applied to, so we can read its real box
    const { svg, box: r } = notchTarget(cp);
    const w = r && r.width ? r.width : geo.box[0];
    const h = r && r.height ? r.height : geo.box[1];

    let d = fitToBox(geo, w, h);
    if (cp.id === NOTCH_SHIFT.id) d = shiftNotch(d, h, NOTCH_SHIFT.dy);
    // the assessment card only: its tab runs wider than the rest of the page's
    if (r && svg && svg.closest('.roi-calculator__results-notch')) d = widenTab(d, 58);
    path.setAttribute('d', d);
    if (svg) svg.setAttribute('viewBox', `-0.5 -0.5 ${(w + 1).toFixed(2)} ${(h + 1).toFixed(2)}`);
  };

  const applyNotches = () => {
    if (!NOTCHES) return;
    $$('clipPath').forEach(paintNotch);
  };
  /* the three scrubbed folds, repainted on every scroll frame: three
     getBoundingClientRect calls and three path strings, nothing else */
  const SCRUBBED = ['clip-v-0-0-0-0-1-0', 'clip-v-0-0-0-0-4-0', 'clip-v-0-0-0-0-12-0'];
  const paintSeams = () => {
    for (const id of SCRUBBED) {
      const cp = document.getElementById(id);
      if (cp) paintNotch(cp);
    }
  };
  const loadNotches = () =>
    fetch('media/notches.json')
      .then((r) => r.json())
      .then((j) => {
        NOTCHES = j;
        applyNotches();
        // only drop the ssr guard once the real geometry is in, so a panel is
        // never briefly clipped by the degenerate all-zero path
        unsetSsr();
      })
      .catch(() => console.warn('notches.json missing — notched panels will clip to nothing'));

  /* =======================================================================
     4. text splitting
     Their CSS animates per-character spans that the markup does not ship:
       .title .--char            { opacity: 0; transition: opacity .1s }
       .split__wrapper .split-chars { color: #ddd; transition: color .4s }
       .scroll-item.show ... .split-chars { animation-delay: var(--v-delay) }
     so the split has to happen in JS before any of it can run. Element
     structure (<strong>, <br>) is preserved — only text nodes are wrapped.
     ======================================================================= */
  const splitChars = (root, cls, perCharDelay) => {
    if (root.dataset.split) return $$(`.${cls}`, root);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const texts = [];
    while (walker.nextNode()) if (walker.currentNode.nodeValue.trim()) texts.push(walker.currentNode);

    let i = 0;
    for (const node of texts) {
      const frag = document.createDocumentFragment();
      for (const ch of node.nodeValue) {
        if (ch === ' ') {
          frag.appendChild(document.createTextNode(' '));
          continue;
        }
        const span = document.createElement('span');
        span.className = cls;
        span.textContent = ch;
        if (perCharDelay) span.style.setProperty('--v-delay', `${(i * perCharDelay).toFixed(3)}s`);
        frag.appendChild(span);
        i++;
      }
      node.parentNode.replaceChild(frag, node);
    }
    root.dataset.split = '1';
    return $$(`.${cls}`, root);
  };

  /* =======================================================================
     4. headline typing
     Chars flip on with a stagger; the CSS .1s opacity transition does the fade.
     Measured on the reference captures at roughly 15-25ms per char.
     ======================================================================= */
  /* v11: the per-character typing read as terminal, not as premium. The hero
     headline now arrives as one block: fade up 16px over 0.65s, power2.out,
     matching the reveal primitive used everywhere else on the page. */
  const typeOnEnter = (el) => {
    if (!el) return;
    if (!gsap) {
      el.style.opacity = '1';
      return;
    }
    gsap.fromTo(
      el,
      { autoAlpha: 0, y: 16 },
      { autoAlpha: 1, y: 0, duration: 0.65, ease: 'power2.out', delay: 0.15 }
    );
  };

  /* =======================================================================
     5. the reading resolve — bold headings darken letter by letter as you scroll

     Their CSS leaves the <strong> inside every section heading at #ddd. Nothing
     in CSS ever darkens it: their splitter wraps the text in .--char spans and
     paints them one at a time with an inline `color: var(--c-dark-green)`.
     Copy the stylesheet without that and every bold heading on the page —
     "Contact us and we will be in touch", "One Modular Platform", "What's your
     yard costing you?" — sits there permanently light grey.

     Two earlier passes here got this wrong in opposite directions, so the
     evidence is worth keeping:
       - the first drove a --split-progress gradient across every
         .section__wrapper. The live page never sets that property on any
         element, at any scroll position (qa/t10-fxcensus.mjs).
       - the second removed the effect altogether, because a census that looked
         only for a .show class found reveals in just the four features-steps
         paragraphs. Those use .split-chars + .show; the headings use .--char +
         an inline colour, so the census walked straight past them. 27 blocks
         resolve on the live page, not 4.
     Watch colour, not classes — that is what qa/t10-fxcensus.mjs now does.

     Trigger geometry measured on the live contact heading (qa/t10-curve.mjs),
     as a function of the heading top's distance from the top of the window:
       +300px   0%      0px   63%
       +200px  22%   -100px   81%
       +100px  44%   -200px  100%
     so: starts as the heading passes 300px below the top of the window, runs
     out at 200px above it, near enough linear in between.
     ======================================================================= */
  const DARK = 'var(--c-dark-green)';

  /* "Muted" is a light grey, not a fixed hex: their CSS uses #ddd for most of
     these and #eee for the carousel heading. Pure white is NOT muted — the
     final CTA sits white on dark and never resolves. */
  const lum = (c) => {
    const m = c.match(/[\d.]+/g);
    if (!m) return -1;
    const [r, g, b] = m.map(Number);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const isMuted = (el) => {
    const L = lum(getComputedStyle(el).color);
    return L >= 200 && L <= 245;
  };

  /* Their splitter wraps each word in a span and each letter in .--char inside
     it, keeping spaces as plain text between the word spans. */
  const splitWordsChars = (root) => {
    if (root.dataset.rsplit) return $$('.--char', root);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const texts = [];
    while (walker.nextNode()) if (walker.currentNode.nodeValue.trim()) texts.push(walker.currentNode);

    for (const node of texts) {
      const frag = document.createDocumentFragment();
      const parts = node.nodeValue.split(/(\s+)/);
      for (const part of parts) {
        if (!part) continue;
        if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(part)); continue; }
        const word = document.createElement('span');
        word.setAttribute('aria-hidden', 'true');
        for (const ch of part) {
          const s = document.createElement('span');
          s.className = '--char';
          s.setAttribute('aria-hidden', 'true');
          s.textContent = ch;
          word.appendChild(s);
        }
        frag.appendChild(word);
      }
      node.parentNode.replaceChild(frag, node);
    }
    root.dataset.rsplit = '1';
    return $$('.--char', root);
  };

  /* Which elements resolve is decided by colour, not by a list of selectors.
     Their markup puts the muted text in three different places depending on the
     section — a <strong> ("Contact us and we will be in touch"), a <span>
     inside a <strong> ("One Modular Platform", where the rest of the line stays
     dark), or the heading itself with no wrapper at all ("Built by logistics
     leaders..."). A selector list would have to guess all three and would rot
     the moment the copy changes; the muted grey is the reliable signal. */
  const hasOwnText = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());

  const resolveTargets = () => {
    const found = [];
    for (const el of $$('h1, h2, h3, h4, p, strong, b, span')) {
      if (el.closest('.features-steps')) continue;   // stepsEngine owns those
      if (el.closest('.split__wrapper')) continue;   // ditto, different mechanism
      if (el.closest('.form-title')) continue;       // limeSweep owns the kontakt heading
      if (!hasOwnText(el)) continue;
      if (!isMuted(el)) continue;
      found.push(el);
    }
    // outermost only, so a heading is split once rather than once per inner span
    const outer = found.filter((e) => !found.some((o) => o !== e && o.contains(e)));

    /* Group by the block they share. Their contact headline is two <h2>s and
       the resolve runs straight through from the end of the first into the
       second — one sequence, not two (qa/t10-words.mjs shows the handover). So
       elements under a common heading wrapper are collected into one run, in
       document order. */
    const groups = new Map();
    for (const el of outer) {
      const box = el.closest('header, .section-content, .content-wrapper') || el.parentElement;
      if (!groups.has(box)) groups.set(box, []);
      groups.get(box).push(el);
    }
    return [...groups.entries()].map(([box, els]) => ({ box, els }));
  };

  const readingResolve = ({ box, els }) => {
    if (!ScrollTrigger) return;
    const chars = [];
    for (const el of els) {
      // keep the accessible text, since the split hides the spans from readers
      if (!el.getAttribute('aria-label')) el.setAttribute('aria-label', el.textContent.replace(/\s+/g, ' ').trim());
      chars.push(...splitWordsChars(el));
    }
    if (!chars.length) return;

    /* Calibrated with a continuous wheel scroll on the live page — the only
       measurement that holds still, because their resolve lags the scroll and
       jumping to a position gives a different answer depending on where you
       jumped from (qa/t10-slowscroll.mjs). Their 43-character contact headline,
       by the top of its first line against the top of the window:
            +45px   starts
           -195px    19%      -1274px   95%
           -565px    48%      -1395px  100%
           -916px    71%
       so it begins as the line reaches the top of the window and runs about
       1,400px further — roughly 33px of scroll per character. Scaling by
       character count keeps a short heading from crawling and a long one from
       finishing before it has been read.

       The 0.6s scrub is theirs too: the resolve visibly trails the scroll and
       catches up when you stop. */
    let last = -1;
    ScrollTrigger.create({
      // anchored on the first line of the group, not the block wrapper: the
      // wrapper can start hundreds of px higher, which finishes the whole
      // resolve before the text is anywhere near the reader
      trigger: els[0],
      start: 'top top',
      end: `+=${Math.round(chars.length * 33)}`,
      scrub: 0.6,
      onUpdate: (self) => {
        const upto = Math.round(self.progress * chars.length);
        if (upto === last) return;
        if (upto > last) for (let i = Math.max(0, last); i < upto; i++) chars[i].style.color = DARK;
        else for (let i = upto; i < Math.min(chars.length, last); i++) chars[i].style.color = '';
        last = upto;
      },
    });
  };

  /* =======================================================================
     6. the features-steps engine
     Their markup ships every hook already:
       section  style="--314863dd:4"       (step count)
       .inner   style="--current-item:0"   (drives the progress bar translate)
       li.scroll-item style="--index:N"    (drives --distance-from-current)
     and .inner is position:sticky in CSS — the pin is CSS, not GSAP. So this
     only has to turn scroll progress into the current step index and set the
     same classes their component sets.
     ======================================================================= */
  const stepsEngine = (section) => {
    const inner = $('.inner', section);
    const items = $$('.scroll-item', section);
    const media = $$('.media-el', section);
    const mobileCounters = $$('.counter__mobile', section);
    const buttons = $$('.buttons .button', section);
    const digitStacks = $$('.odometer .digit-column .digit-stack', section);
    const n = items.length;
    if (!inner || !n) return;

    /* The character reveal, scroll-linked.

       Their CSS darkens a character through
         .split__wrapper .split-chars.show { color: var(--c-dark-green) }
       with a keyframe that flashes lime at 30% before settling. What drives it
       is a CURSOR, not a per-step switch: their component keeps a continuous
       float B over [0, itemCount] from a scrubbed ScrollTrigger and, per item,
       shows `clamp(B - index, 0, 1) * chars.length` characters
       (B3ora7rO.js: `Class.toggle(ch, "show", amount * chars.length > i)`).

       The previous version here revealed a whole step at once and never undid
       it, which is why the text looked dead: nothing on the page responded to
       the scroll wheel between one step and the next. This is per character,
       scrubbed, and reversible — scroll back up and the letters go grey again. */
    const shown = new Array(n).fill(-1);
    const painted = new Array(n).fill(false);
    const charsOf = (item) => {
      if (item.__chars && item.__chars.length) return item.__chars;
      const found = $$('.split-chars', item);
      if (found.length) item.__chars = found;
      return found;
    };

    /* THE SWEEP.

       Terminal runs each character grey -> a flash -> dark green over 0.5s,
       and the whole effect lives in one fact about their palette: the flash is
       BRIGHTER than the grey it starts from. Measured: grey #ddd is 72.3%
       luminance, their lime #abff02 is 80.2%, the dark green they settle on is
       1.4%. Light travels across the paragraph and the words drop into the
       dark behind it.

       Ours could not do that by swapping the hue. Blue at full chroma is a
       dark colour: #2b5fbf is 12.5% luminance against the same 72% grey, so
       the "flash" was 59 points darker than its own starting point and only 11
       points off the navy it ended on. Nothing travelled. The character just
       darkened, once. That is what Patrick was seeing as the blue having lost
       its potency, and no amount of glow on a 12% colour fixes it.

       So the band replaces the per-character flash. Instead of each letter
       running its own timeline, a run of about ten characters behind the
       cursor holds a lighter blue and fades back to navy behind it: a single
       continuous edge of light moving through the sentence at the speed of the
       wheel. It is what he described as a gradient light-to-dark in a flowing
       way, and it is scrubbable in both directions because the colour is a
       function of distance from the cursor and nothing else.

       Chosen off prototypes/v11-final/section2-options.html, option 02. */
    const SWEEP_BAND = 9;    // characters of colour trailing the cursor (was 6; walkthrough 2026-09-05, point 7)
    const SWEEP_PEAK = 0.22; // the light is brightest early in the band (was 0.28)
    const SWEEP_HOLD = 0.62; // ...and holds full blue until here before fading to navy (walkthrough point 7)

    const rgbOf = (v, fallback) => {
      const t = (v || '').trim() || fallback;
      if (t.startsWith('#')) {
        const h = t.length === 4
          ? '#' + [1, 2, 3].map((i) => t[i] + t[i]).join('')
          : t;
        return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
      }
      const m = t.match(/-?\d+(\.\d+)?/g) || [];
      return [+m[0] || 0, +m[1] || 0, +m[2] || 0];
    };
    const mix = (a, b, t) =>
      'rgb(' +
      Math.round(a[0] + (b[0] - a[0]) * t) + ',' +
      Math.round(a[1] + (b[1] - a[1]) * t) + ',' +
      Math.round(a[2] + (b[2] - a[2]) * t) + ')';

    let SW = null;
    const readSweep = () => {
      const cs = getComputedStyle(section);
      SW = {
        rest: rgbOf(cs.getPropertyValue('--sweep-rest'), '#d6dde3'),
        flash: rgbOf(cs.getPropertyValue('--sweep-flash'), '#2ea8ff'),
        done: rgbOf(cs.getPropertyValue('--sweep-done'), '#0d1c2e'),
      };
    };
    readSweep();
    section.classList.add('has-sweep');

    const colourAt = (d, rest) => {
      if (d <= 0) return 'rgb(' + rest.join(',') + ')';
      if (d >= SWEEP_BAND) return 'rgb(' + SW.done.join(',') + ')';
      const k = d / SWEEP_BAND;
      if (k < SWEEP_PEAK) return mix(rest, SW.flash, k / SWEEP_PEAK);
      if (k < SWEEP_HOLD) return 'rgb(' + SW.flash.join(',') + ')';
      return mix(SW.flash, SW.done, (k - SWEEP_HOLD) / (1 - SWEEP_HOLD));
    };
    const paintChar = (el, d, rest) => {
      const c = colourAt(d, rest);
      if (el.__c === c) return;
      el.__c = c;
      el.style.color = c;
    };

    const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
    /* WHERE A BEAT IS ON THE SCREEN WHEN IT FINISHES READING.

       This used to be a single cursor B walking [0, itemCount], the beat's own
       box mapped onto its unit interval, exactly as their component does it.
       Two things came out of that and Patrick caught both:

         - a beat's light could not leave until the NEXT beat's window opened,
           344px of gap later, because B was pinned at a whole number in
           between. Traced with qa/beat-endpoints.mjs: every beat finished with
           its top at about -215, i.e. the last words lit up after the
           paragraph had already left the top of the screen. Beat 4 never
           finished at all, because there is no fifth beat to release it.
         - the window ended at the beat's BOTTOM, so the taller the beat the
           higher it had climbed by the time it was done.

       So each beat now owns its own window in the column's own coordinates,
       and the window is expressed as where the beat sits on the screen rather
       than as a fraction of itself:

         starts  when its top is LEAD px below the midline
         ends    when its MIDDLE is TAIL px above the midline

       which is the same place for all four regardless of how many lines they
       run to, and it is where the eye actually is. */
    const LEAD = 220;
    const TAIL = 60;
    const LAST_TAIL = 40;
    const BEAT1_EARLY = 120;
    /* BEAT 1 IS DIFFERENT, and it is the one Patrick said had no animation.

       Measured on their live page (qa/r3-term2.mjs, list top at viewport y):
         1400  0 of 137 chars dark      900  53      650  107
         1100  9                         750  85      550  129     400  137
       So their first beat fills while the section is still ENTERING from the
       bottom: it starts before the paragraph is on screen, the fill front is
       visible sweeping the lower lines as they come up, and it is done by the
       time the paragraph reaches the middle of the screen. Beats 2-4 read at
       the midline. Ours rested dark and the band ran navy over navy, which is
       why there was nothing to see. Now beat 1 rests grey like the rest and
       its window is the approach: from the cursor's birth (0.8 screens below
       the midline) to 60px past it. */
    /* Walkthrough 2026-09-05 (point 6): beat 1 reads at the midline like the
       others again. It rests navy (rest = done, below), so the band is the only
       thing that moves through it: navy -> blue -> navy. */
    let pinC = 0; // the cursor's value at the moment the panel pins (measure())
    const windowOf = (i) => {
      const d = geo[i] || { y: 0, h: 1 };
      /* Round 2 (2026-09-07, point 5): beat 1's band used to run while the
         panel was still arriving (81% done at the pin, measured), so nothing
         moved once the reader was looking. It opens the moment the panel pins
         and closes 40px before beat 2's window opens. */
      /* Round 2b: the pin-based window for beat 1 read as "too late" (Patrick,
         against Terminal live: their first beat is 52% filled when the column's
         top is at 700 and done by 460, qa/w2-beat1.mjs). Beat 1 takes the same
         window as the others, so the band enters with the paragraph at 580 and
         is half done when the paragraph reaches the middle of the screen. */
      /* The LAST beat closes when its middle is 40px BELOW the midline instead
         of 60 above: the panel lets go with that middle 10px below the midline
         (stepsPanelSize), and the band must have walked off before it moves. */
      const tail = i === geo.length - 1 && geo.length > 1 ? -LAST_TAIL : TAIL;
      /* Beat 1 runs BEAT1_EARLY px ahead of the others' line: Terminal's first
         beat is 52% filled with the column's top at 700 and done at 460
         (qa/w2-beat1.mjs); ours is 45% at 500 and done at 250, before the pin,
         with the front still on screen the whole way. */
      const early = i === 0 ? BEAT1_EARLY : 0;
      return { from: d.y - LEAD - early, to: d.y + d.h / 2 + tail - early };
    };

    const setCursor = (c) => {
      if (REDUCED) return;   // the stylesheet leaves every character settled
      items.forEach((item, i) => {
        const chars = charsOf(item);
        if (!chars.length) return;
        /* The band has to be able to run PAST the last character, or the final
           ten letters sit inside it and stay lit blue for good. The window is
           sized for chars + one band, so the light has walked off the end
           exactly as the window closes. */
        const w = windowOf(i);
        const t = clamp((c - w.from) / (w.to - w.from || 1), 0, 1);
        const cursor = t * (chars.length + SWEEP_BAND + 1);
        const rest = i === 0 ? SW.done : SW.rest;
        if (!painted[i]) {
          painted[i] = true;
          for (let k = 0; k < chars.length; k++) paintChar(chars[k], cursor - k, rest);
          shown[i] = cursor;
          return;
        }
        if (cursor === shown[i]) return;
        // only the stretch the band can have crossed since the last frame
        const lo = Math.max(0, Math.floor(Math.min(shown[i], cursor)) - SWEEP_BAND - 1);
        const hi = Math.min(chars.length - 1, Math.ceil(Math.max(shown[i], cursor)));
        for (let k = lo; k <= hi; k++) paintChar(chars[k], cursor - k, rest);
        shown[i] = cursor;
      });
    };
    addEventListener('resize', () => { readSweep(); painted.fill(false); });

    /* The odometer rolls rather than snaps: their PaddedCounter tweens a proxy
       (`gsap.to(U, {value: n, duration: 1, ease: "expo.out"})`) and translates
       each digit column by the interpolated digit, so the numbers turn over like
       a mileage counter. */
    const odo = { from: 1, to: 1, p: 1 };
    const paintOdo = () => {
      const len = digitStacks.length || 1;
      const from = String(odo.from).padStart(len, '0');
      const to = String(odo.to).padStart(len, '0');
      digitStacks.forEach((stack, i) => {
        const a = Number(from[i] || 0);
        const b = Number(to[i] || 0);
        const v = a + (b - a) * odo.p;
        stack.style.transform = `translateY(calc(${(-v).toFixed(3)} * var(--digit-height)))`;
      });
    };
    const rollOdo = (value) => {
      if (value === odo.to) return;
      odo.from = Math.round(odo.from + (odo.to - odo.from) * odo.p);
      odo.to = value;
      odo.p = 0;
      if (gsap) gsap.to(odo, { p: 1, duration: 1, ease: 'expo.out', onUpdate: paintOdo, overwrite: true });
      else { odo.p = 1; paintOdo(); }
    };

    /* The moving notch. Their panel's notch travels 0.3 -> 0.7 down its left
       edge across the four beats; see shiftNotch above. */
    const maskCp = $('.svg-mask clipPath', section);
    const maskSlot = $('.svg-mask .slot', section);
    if (maskCp) NOTCH_SHIFT.id = maskCp.id;

    /* THE SIGNATURE MOVE: the hole measures itself.

       scroll-craft asks every page for one bespoke interaction that exists on
       this site alone. Ours: while the digging beat reads, the 20-foot
       container's real dimensions - 6,06 x 2,44 x 2,59 m, the standard box
       Magnus buries - draw themselves over the panel as thin dimension lines,
       stroke length driven by the scroll, labels landing as the lines close,
       and the whole drawing fades as the next beat opens. Real numbers only;
       the floor forbids invented ones. The planes are authored in a 1000x1000
       box stretched to the panel with non-scaling strokes, and the labels are
       HTML so nothing stretches but the geometry. */
    const buildDims = () => {
      if (!maskSlot) return null;
      const box = document.createElement('div');
      box.className = 'dims';
      box.setAttribute('aria-hidden', 'true');
      box.innerHTML =
        '<svg viewBox="0 0 1000 1000" preserveAspectRatio="none">' +
        '<path pathLength="1" d="M 100,850 L 100,880 M 100,865 L 900,865 M 900,850 L 900,880"/>' +
        '<path pathLength="1" d="M 905,200 L 935,200 M 920,200 L 920,850 M 905,850 L 935,850"/>' +
        '</svg>' +
        '<p class="dims__label" style="left:50%;top:89%;transform:translateX(-50%)">6,06 m</p>' +
        '<p class="dims__label" style="left:92%;top:15.5%;transform:translateX(-50%)">2,59 m</p>' +
        '<p class="dims__label" style="left:4%;top:4%">20 fod &middot; 6,06 &times; 2,44 &times; 2,59 m</p>';
      maskSlot.appendChild(box);
      return { box, paths: $$('path', box), labels: $$('.dims__label', box) };
    };
    const dims = buildDims();
    const drawDims = (c) => {
      if (!dims || geo.length < 3 || innerWidth < 1024) return;
      const w1 = windowOf(1);
      const w2 = windowOf(2);
      const draw = clamp((c - w1.from) / ((w1.to - w1.from) || 1), 0, 1);
      const out = clamp((c - w2.from) / 160, 0, 1);
      const vis = draw > 0 ? 1 - out : 0;
      const lines = clamp(draw / 0.65, 0, 1);
      const labels = clamp((draw - 0.45) / 0.3, 0, 1);
      dims.box.style.opacity = vis.toFixed(3);
      dims.paths.forEach((p) => { p.style.strokeDashoffset = (1 - lines).toFixed(3); });
      dims.labels.forEach((l) => { l.style.opacity = labels.toFixed(3); });
    };
    const driveNotch = (p) => {
      if (!maskCp || !maskSlot || innerWidth < 1024) return;
      const h = maskSlot.getBoundingClientRect().height;
      if (!h) return;
      NOTCH_SHIFT.dy = p * 0.4 * h;
      paintNotch(maskCp);
    };

    let current = -1;
    const setStep = (idx) => {
      idx = clamp(idx, 0, n - 1);
      if (idx === current) return;
      current = idx;

      inner.style.setProperty('--current-item', idx);
      items.forEach((el, i) => el.classList.toggle('show', i === idx));
      mobileCounters.forEach((el, i) => el.classList.toggle('show', i === idx));

      /* Their images STACK — `is-visible` is cumulative, so every frame up to
         the current one stays on and the new one crossfades in over the top
         (.image { transition: opacity .5s var(--ease-out) }). Ours hard-swapped
         one for one, which is the visible jump at the end of the last beat:
         nothing is behind the outgoing frame, so the panel blinks. */
      media.forEach((el, i) => {
        el.classList.toggle('is-visible', i <= idx);
        const v = $('video', el);
        if (!v) return;
        if (i === idx) v.play().catch(() => {});
        else v.pause();
      });

      rollOdo(idx + 1);

      // prev disabled on the first step, next on the last — same as theirs
      if (buttons.length === 2) {
        buttons[0].disabled = idx === 0;
        buttons[1].disabled = idx === n - 1;
      }
    };

    /* Where the reading actually happens.

       The old version mapped one linear progress over the WHOLE section onto
       the cursor. Two things were wrong with that, and both were visible:

         - the first beat started grey and filled while the section was already
           on screen. Terminal fills beat 1 during the APPROACH, so it is
           already dark by the time you are looking at it. That is a second
           trigger, on the section's approach, not a different curve.
         - the fill ran ahead of the reader. The text column is 2,577px of
           beats scrolling past a 1,160px window; a linear map over the section
           puts the filling character up under the header instead of in the
           middle of the screen where the eye is.

       Terminal reads at the VIEWPORT MIDLINE: the trigger is the text column
       itself, from its top crossing 50% to its bottom crossing 50%, and the
       cursor is placed by each item's own offset inside the column
       (B3ora7rO.js). Same maths here. */
    const list = $('.scroll-items-list', section) || inner;
    const scrollItems = $('.scroll-items', section) || inner;

    // each beat's box inside the column — their `g` array
    let geo = [];
    const panelEl = $('.svg-mask', section);
    const measure = () => {
      geo = items.map((el) => ({ y: el.offsetTop, h: el.offsetHeight }));
      /* c = midline minus the column's top; at the pin the column's top is
         the panel's sticky top plus the column's offset under the panel's
         static top (both children of .inner) */
      const panelTop = panelEl ? parseFloat(getComputedStyle(panelEl).top) || 104 : 104;
      const colOffset = panelEl ? list.offsetTop - panelEl.offsetTop : 112;
      pinC = innerHeight / 2 - panelTop - colOffset;
    };
    // QA hook (qa/w2-*.mjs): the windows and the pin cursor, read-only
    window.__stepsDebug = () => ({ pinC, geo, w: geo.map((_, i) => windowOf(i)), c: window.__stepsC });
    measure();
    addEventListener('resize', measure);

    /* 2026-09-16 (Patrick: section 2 reads the way V12 does now). The band is
       off. Each beat's letters turn from grey to ink as the beat rises through
       the reading window, from 82% of the screen up to the midline, the same
       reader as prototypes/v12-premium/js/v12.js. The picture and the counter
       change when the midpoint between two beats crosses the panel's centre,
       so the picture on screen always belongs to the beat nearest the panel.
       The sweep above stays for the record and runs when window.__v11Fill
       is false. */
    /* Wide screens only: the phone layout is Terminal's own (the beats side by
       side under the picture, arrows to page), and its engine stays as it was. */
    const FILL = window.__v11Fill !== false && innerWidth >= 1024;
    const lit = new Array(n).fill(-1);
    const fillRead = () => {
      const vh = innerHeight, narrow = innerWidth < 1024;
      const start = vh * (narrow ? 0.95 : 0.82), span = vh * (narrow ? 0.3 : 0.32);
      return items.map((item, i) => {
        const chars = charsOf(item);
        const p = clamp((start - item.getBoundingClientRect().top) / span, 0, 1);
        if (!chars.length) return p;
        const k = REDUCED ? chars.length : Math.round(p * chars.length);
        if (k !== lit[i]) {
          const from = Math.max(0, Math.min(k, lit[i])), to = Math.max(k, lit[i]);
          for (let m = from; m < to; m++) chars[m].classList.toggle('on', m < k);
          lit[i] = k;
        }
        return p;
      });
    };
    const centreOf = (el) => { const r = el.getBoundingClientRect(); return r.top + r.height / 2; };
    const readingLine = () => {
      const f = (panelEl || section).getBoundingClientRect();
      return innerWidth < 1024 ? (f.bottom + innerHeight) / 2 : f.top + f.height / 2;
    };
    /* The dimension drawing stays off in fill mode: it was drawn for a
       straight-on render of the box in the pit, and over the photographs
       (a marked lawn, a pit seen at an angle) a 6,06 m line measures nothing. */
    const fillDims = (ps) => {
      if (!dims) return;
      if (dims.box.style.opacity !== '0') dims.box.style.opacity = '0';
      return;
      // eslint-disable-next-line no-unreachable
      if (!dims || ps.length < 3 || innerWidth < 1024) return;
      const draw = ps[1], out = clamp(ps[2] / 0.3, 0, 1);
      const vis = draw > 0 ? 1 - out : 0;
      const lines = clamp(draw / 0.65, 0, 1), labels = clamp((draw - 0.45) / 0.3, 0, 1);
      dims.box.style.opacity = vis.toFixed(3);
      dims.paths.forEach((pth) => { pth.style.strokeDashoffset = (1 - lines).toFixed(3); });
      dims.labels.forEach((l) => { l.style.opacity = labels.toFixed(3); });
    };
    const fillUpdate = () => {
      const ps = fillRead();
      const line = readingLine();
      let o = 0;
      for (let i = 1; i < n; i++) if ((centreOf(items[i - 1]) + centreOf(items[i])) / 2 <= line) o = i;
      setStep(o);
      fillDims(ps);
      const L = list.offsetHeight || 1;
      driveNotch(clamp((innerHeight / 2 - list.getBoundingClientRect().top) / L, 0, 1));
      window.__stepsFill = ps;
    };
    if (FILL) {
      section.classList.add('has-fill');
      section.classList.remove('has-sweep');
      window.__stepsActive = () => current;
    }


    /* Beat 1's colour is owned by CSS now, not by a trigger — see replica.css.
       An approach trigger that filled it could always be caught halfway (fast
       scroll, a resize, a refresh mid-section), and half a grey paragraph is
       exactly what Patrick kept seeing. Painting it dark in the stylesheet
       means no scroll position can ever show it grey. The lime .show sweep
       still runs across it at the midline; it just goes dark-to-dark. */

    if (FILL && ScrollTrigger) {
      ScrollTrigger.create({ trigger: section, start: 'top bottom', end: 'bottom top', onUpdate: fillUpdate, onEnter: fillUpdate, onEnterBack: fillUpdate, onRefresh: fillUpdate });
    } else if (FILL) {
      addEventListener('scroll', fillUpdate, { passive: true });
    } else if (ScrollTrigger) {
      /* The range starts HALF A SCREEN EARLY.

         The cursor used to be born at c = 0 when the column's top reached the
         midline. Beat 1's window opens at c = -220, so at the moment the section
         arrived the cursor was already 220px into a 530px window and the band
         sat frozen a third of the way through the paragraph: "starts halfway
         through for some reason". Starting the trigger at the viewport bottom
         gives the cursor the half screen before the midline that every later
         beat gets by virtue of sitting lower in the column, and beat 1's band
         now enters from the first character and travels like the others. */
      ScrollTrigger.create({
        trigger: scrollItems,
        start: 'top 130%',
        end: 'bottom 50%',
        scrub: 0,
        onUpdate: (self) => {
          const L = list.offsetHeight;
          const pre = innerHeight * 0.8;
          const c = self.progress * (L + pre) - pre;
          window.__stepsC = c;

          /* The active beat is the last one whose window has opened, so the
             counter and the image change over on the same event that starts
             the light, rather than on a threshold of their own. */
          let o = 0;
          /* Polish (2026-09-08, Patrick: the picture changed too early against
             the band): the change comes when the band is 40% through the beat,
             so the reader is mid-sentence when the picture settles in. */
          for (let i = 0; i < geo.length; i++) { const w = windowOf(i); if (c >= w.from + (w.to - w.from) * 0.4) o = i; }
          setStep(o);

          setCursor(c);
          drawDims(c);

          driveNotch(clamp(c / (L || 1), 0, 1));
        },
      });
    }

    // arrow buttons page through the steps by scrolling to that step's slice
    buttons.forEach((btn, i) => {
      btn.addEventListener('click', () => {
        const target = clamp(current + (i === 0 ? -1 : 1), 0, n - 1);
        const rect = section.getBoundingClientRect();
        const top = rect.top + scrollY;
        const y = top + ((target + 0.5) / n) * (section.offsetHeight - innerHeight);
        if (window.__lenis) window.__lenis.scrollTo(y);
        else scrollTo({ top: y, behavior: 'smooth' });
      });
    });

    /* Their frozen line boxes, applied before the character split.

       Their splitter measures each bold lead-in and freezes its rendered lines
       into separate display:inline-block <strong>s. That measurement runs before
       the webfont settles, so the frozen breaks are not the ones a browser picks
       from the same text: step 3 keeps "Eliminates" alone on the first line even
       though "Eliminates Unnecessary" fits the 435px column. Left to itself our
       copy breaks where the browser wants, one word later, and the heading reads
       differently from theirs.

       The breaks cannot be derived — they are an artifact of their timing — so
       they are carried, the same way media/notches.json carries their clip-path
       geometry: qa/t10-lines.mjs reads them off the live page. */
    const applyLines = (byIndex) => {
      items.forEach((item, i) => {
        const spec = byIndex[String(i)];
        const strong = spec && $('strong', item);
        if (!strong || spec.lines.length < 2) {
          if (strong) strong.style.display = 'inline-block';
          return;
        }
        /* Their frozen breaks belong to their words. Once a beat carries our
           Danish copy, replacing the heading with their remembered lines puts
           their English text straight back on the page — step 3 came back as
           "Eliminates Unnecessary Labor" under a Danish paragraph. So the
           carried breaks only apply while the heading still says what it said
           when they were captured. */
        if (spec.lines.join(" ").replace(/\s+/g, " ").trim() !==
            strong.textContent.replace(/\s+/g, " ").trim()) {
          strong.style.display = 'inline-block';
          return;
        }
        const frag = document.createDocumentFragment();
        for (const line of spec.lines) {
          const s = document.createElement('strong');
          for (const a of strong.attributes) s.setAttribute(a.name, a.value);
          s.style.display = 'inline-block';
          s.textContent = line;
          frag.appendChild(s);
        }
        strong.replaceWith(frag);
      });
    };

    const splitAll = () =>
      // Per-char delays so the active step's text resolves left to right.
      // 0.014s/char measured off the live page: 137 chars in step 1, last char
      // --v-delay = 1.9s (qa/t10-delay.mjs). Our split produces the same 137.
      items.forEach((item) => splitChars($('.split__wrapper', item) || item, 'split-chars', 0.014));

    fetch('media/lines.json')
      .then((r) => r.json())
      .then((j) => {
        const widths = Object.keys(j).map(Number).sort((a, b) => a - b);
        const pick = widths.reduce((best, w) => (Math.abs(w - innerWidth) < Math.abs(best - innerWidth) ? w : best), widths[0]);
        applyLines(j[String(pick)] || {});
      })
      .catch(() => console.warn('lines.json missing — bold lead-ins will break where the browser chooses'))
      .finally(() => {
        splitAll();
        // the split changes where every beat sits in the column, so the offsets
        // the cursor is placed by have to be taken again
        measure();
        if (FILL) fillUpdate();
        if (ScrollTrigger) ScrollTrigger.refresh();
      });

    setStep(0);
    paintOdo();
  };

  /* =======================================================================
     7. hero exit

     Measured off the live page rather than guessed (qa/t10-herotree.mjs). The
     element that moves is their INNER sticky stage — .sequence-background-wrapper,
     which our SSR `span` stands in for — and it moves only across the section's
     last viewport:

       heroBottom 900px (exit begins)  translateY 0
       heroBottom 313px                translateY 293.5px   <- (900-313)/900 * 450
       heroBottom   0px (exit ends)    translateY 450px     <- 50% of a 900px stage

     So: yPercent 50, linear, scrubbed from 'bottom bottom' to 'bottom top'. The
     stage is bottom-constrained sticky, so its natural travel over that range is
     -900px; +450 of transform halves it. The image leaves at half speed and the
     white panel below slides up over it. Nothing moves during the hold.

     What this replaces, and why it was visibly wrong: the previous version put
     yPercent 50 on `.wrapper` and scrubbed it across the WHOLE section from
     'top top'. That pushed the stage DOWN the screen from the first pixel of
     scroll — at 400px scrolled the stage sat 133px below the viewport top — and
     the section's own background filled the gap, growing as you scrolled. Two
     separate mistakes: the wrong element, and the wrong range.
     ======================================================================= */
  const heroExit = () => {
    const section = $('.video-carousel');
    const stage = section && $(':scope > .wrapper', section);
    const img = section && $(':scope > .wrapper > span', section);
    const copy = section && $('.homepage-scroll-content', section);
    if (!section || !stage || !gsap || !ScrollTrigger) return;

    /* Three tweens, all opening on the first pixel of scroll, all ending at
       different times. Patrick's description of the target, which is what these
       numbers are built from: "it zooms in quick, then stays static and then
       scrolls up slow", and the rise should be "very slowly and very subtly".

       1. THE RISE. 0.25 speed: while the page scrolls a screen, the photo
          drifts up a quarter of one. Countering 75% of the section's own travel
          is what produces that.

          Terminal's measured number is 0.50 and I shipped exactly that. His
          verdict was that it "goes up a little bit too fast and too rigidly".
          Copying their ratio was the same mistake as copying their hold: their
          hero is three screens of scrubbing sequence, so half speed reads as
          slow in that context. In a one-screen still photograph it does not.

          scrub TRUE, and this is the part I got backwards twice.

          A numeric scrub is a lag: GSAP eases the animation toward where the
          scroll actually is, over that many seconds. I read "rigid" as "needs
          more smoothing" and raised it to 1.1, which made it worse in the other
          direction. Measured: after a wheel flick the scroll settled at 1425ms
          and the photo was still crawling toward its final position at 1775ms,
          350ms of drift with the wheel already still. That trailing catch-up is
          exactly what Patrick means by "bouncing in and bouncing out".

          Lenis is already smoothing the scroll position itself (lerp 0.1), so
          scrollY arrives as a smooth continuous value, not in wheel-sized
          jumps. Mapping straight onto it with scrub:true gives motion that is
          smooth AND stops the instant the scroll stops. Adding a second layer
          of easing on top of an already-eased input is what produced both
          complaints. All three tweens below use true, so the photo's position
          and its scale can never drift out of step with each other either. */
    gsap.to([stage, copy], {
      y: () => section.offsetHeight * 0.62, /* 2026-09-08 polish: Patrick saw the photo as still after the push-in; 0.38 speed instead of 0.25, still slow */
      ease: 'none',
      scrollTrigger: {
        trigger: section,
        start: 'top top',
        end: 'bottom top',
        scrub: true,
        invalidateOnRefresh: true,
      },
    });

    /* 2. THE ZOOM. Done inside the first 110px of scroll, then flat for the
          rest. Twice now the note has been that it arrives late and keeps
          going: first at 1.04 across 450px, then at 1.025 across 225px. The
          amount was never the problem, the duration was. 110px is roughly one
          flick of a trackpad, so it lands as a single quick push-in while the
          panel below is just appearing, and then the photo is static.

          Same scrub:true as the rise, so the scale and the position are driven
          by the identical value. Two different lags on one photograph is the
          other way to make it look like it is bouncing. */
    gsap.fromTo(
      img,
      { scale: 1 },
      {
        scale: 1.035,
        ease: 'power2.out',
        transformOrigin: '50% 55%',
        scrollTrigger: {
          trigger: section,
          start: 'top top',
          end: '+=110',
          scrub: true,
          invalidateOnRefresh: true,
        },
      }
    );

    /* 3. THE COPY leaves before the folded edge climbs into it, so the fold
          never cuts a sentence in half.

          The deadline is arithmetic, not taste. The last line of copy sits at
          y=724 and rides up at 0.25, so at scroll s its bottom is 724-0.25s.
          The fold is the top of the next panel, at 900-s. They meet when
          900-s = 724-0.25s, i.e. s=235, and the copy has to be gone by then or
          the fold visibly slices through it.

          Patrick wants it to hold "a little bit longer". The end cannot move,
          so the START does: it waits until 70px of scroll instead of 20, and
          then fades over 145px, finishing at 215 with 20px of margin before
          the fold arrives at 235.

          THE FAST-SCROLL FIX. Patrick: "it looks very good if you do it slow,
          but most people scroll quickly... it just feels like it disappears
          abruptly." Two causes, both fixed here.

          First the ease. power1.in is slow-then-fast, so the copy held at full
          opacity for most of the range and then dropped off a cliff in the last
          third of it. Linear spreads the same fade evenly across the distance.

          Second, and this is the real one: a pure scroll-scrubbed fade has no
          duration of its own. This range is 145px, which is most of a second
          when you are reading and about 60ms when you flick a trackpad - so at
          flick speed the copy did not fade, it cut. A numeric scrub gives the
          fade a floor: however fast the scroll jumps, the opacity still eases
          over its own time. Measured with a 320px wheel flick (qa/herofade.mjs),
          opacity per 35ms sample:

            scrub true   1  0     - one sample, a cut
            scrub 0.4    1  0.46  0.08  0.01  0        - ~150ms, still a cut
            scrub 0.9    1  0.69  0.32  0.15  0.09  0.05  0.03  0.02  0.01  0

          0.9 it is. At reading speed the same number is invisible - the slow
          pass still walks 1 / 0.96 / 0.81 / 0.59 / 0.35 / 0.16 down to zero.

          Note this is the opposite call to the two tweens above, which are
          scrub:true precisely because a lag on them read as drift. The
          difference is that position and scale are things you can see arriving
          late; opacity is not - it has nowhere to be out of step with. */
    if (copy) {
      gsap.fromTo(copy, { autoAlpha: 1 }, {
        autoAlpha: 0,
        ease: 'none',
        scrollTrigger: {
          trigger: section,
          start: 'top top-=70',
          end: '+=145',
          scrub: 0.9,
          invalidateOnRefresh: true,
        },
      });
    }
  };


  /* =======================================================================
     7c. text reveal — headings resolve character by character on entry

     Ported from their `useTextReveal` composable (9BKRpoAQ.js):
       split into chars, take only the ones inside <strong>,
       tl.to(chars, {color: start, duration:.4, stagger:.05, ease:'power2.inOut'}, 0)
         .to(chars, {color: end,   duration:.5, stagger:.05, ease:'power2.inOut'}, .25)
       trigger: 'top 40%', not scrubbed.

     Their FAQ heading uses it (lime -> dark green) and so does the footer
     headline (lime -> white). Both ship the `animated-strong` hook in the markup
     already; without this they just sit there.
     ======================================================================= */
  const textReveal = (el, { start = 'var(--c-lime)', end = 'var(--c-dark-green)' } = {}) => {
    if (!el || !gsap || !ScrollTrigger) return;
    const strong = $('strong', el);
    if (!strong) return;
    const chars = splitChars(strong, '--char');
    if (!chars.length) return;
    /* v11: the colour-flip through the accent read as a terminal effect. The
       heading keeps its final colour and simply resolves in place, letter by
       letter, from faint to solid. */
    gsap.set(chars, { color: end, opacity: 0.22 });
    gsap
      .timeline({ scrollTrigger: { trigger: el, start: 'top 70%' } })
      .to(chars, { opacity: 1, duration: 0.5, stagger: 0.03, ease: 'power2.out' }, 0);
  };

  /* =======================================================================
     7d. the footer

     It shipped inert: the markup carries `--static` on all three parts, and
     their CSS then pins the whole reveal off (`transform:none!important`). So
     the last thing on the page was a flat block, right after a section that
     moves — which is exactly where a page most needs to not stop dead.

     Two behaviours, both measured from their SiteFooter chunk (BHv_ulqk.js):

       heightHolder.style.height = footer.offsetHeight * 0.8
       ScrollTrigger { trigger: heightHolder, start:'top bottom',
                       end:'bottom bottom', scrub: true }
         footer.transform = translate3d(0, Lerp(100,1,progress)%, 0)
         overlay.opacity  = Lerp(0, 0.4, progress)

     so the footer is a fixed panel sliding up from below while a black scrim
     darkens the page above it. Desktop only — their own CSS puts the footer back
     in normal flow under 1024px.
     ======================================================================= */
  const footerReveal = () => {
    const holder = $('.footer__height-holder');
    if (!holder) return;
    const wrapper = $('.footer__wrapper', holder);
    const overlay = $('.overlay-sticky__wrapper', holder);
    const footer = wrapper && $('.footer', wrapper);
    if (!wrapper || !footer) return;

    [holder, wrapper, overlay].forEach((el) => el && el.classList.remove('--static'));
    let cpPainted = false;

    const size = () => {
      if (innerWidth < 1024) {
        holder.style.height = '';
        wrapper.style.transform = '';
        if (overlay) overlay.style.opacity = '';
        return;
      }
      /* The holder's height IS the reveal distance. Terminal's footer is tall,
         so 0.8 of it is most of a screen; ours is short, and 0.8 of a short
         footer is a blink — the last thing on the page snapped up instead of
         arriving. Floor it at 70% of the window so the reveal always has room
         to be a movement rather than a jump. */
      /* walkthrough 2026-09-05 (point 21): the runway equals the footer, so the
         footer rises exactly as fast as the page scrolls: no white gap under
         the FAQ (a longer runway) and no curtain over the last answers (a
         shorter one; measured at 450: the footer covered two open questions).
         The white Patrick saw was the FAQ's own 30vh + 100vh floor, gone in 34f. */
      holder.style.height = `${footer.offsetHeight}px`;
      cpPainted = false; // the footer's box may have changed: paint the fold again
      if (ScrollTrigger) ScrollTrigger.refresh();
    };
    size();
    addEventListener('resize', size);

    /* LIVE GEOMETRY, EVERY FRAME.

       This used to be two ScrollTriggers scrubbing the holder. A ScrollTrigger
       caches where the holder is, and the holder moves whenever an answer in
       the FAQ opens: the page grows above it, the footer stays where the cache
       says, and then jumps down when the cache is refreshed - "the way it
       pushes down the footer looks off... too mechanical". So the footer's
       position is read off the holder's real rect on every scroll frame AND
       on every frame the FAQ list changes height (faqAccordion's
       ResizeObserver calls layoutFooter). It slides with the page instead of
       catching up to it. */
    const cp = document.getElementById('clip-v-0-0-0-0');
    let lastP = -1;
    const layoutFooter = () => {
      if (innerWidth < 1024) return;
      const r = holder.getBoundingClientRect();
      const range = r.height || 1;
      const p = clamp((innerHeight - r.top) / range, 0, 1);
      if (p === lastP) return;
      lastP = p;
      /* Round 2c (2026-09-07): this read 100 + (1 - 100) * p = 100 - 99p, so the
         wrapper trailed the holder by up to 1% of its height (11px at the end)
         and the strip above its top edge showed the dimming overlay through:
         the grey line Patrick saw at the fold. Exact now: the wrapper's top is
         the holder's top at every p (qa/w2-edge.mjs). The overlay only ever
         sat under the wrapper, so it did nothing but this; it stays at 0. */
      wrapper.style.transform = `translate3d(0, ${((1 - p) * 100).toFixed(3)}%, 0)`;
      if (overlay) overlay.style.opacity = '0';
      /* The notch DEEPENS as the footer arrives, so the top edge visibly folds
         over the section above. Their SiteFooter scrubs the offset +30 -> -30;
         a clip-path cannot draw the negative half, so the movement is kept in
         the range that can: 6px on approach, opening to their full 30. */
      /* Round 2: the fold is their constant 30; painted once per layout, not
         per frame (it used to open 6 -> 30 on approach and read as straight) */
      if (cp && !cpPainted) { paintNotch(cp); cpPainted = true; }
    };
    window.__layoutFooter = layoutFooter;
    addEventListener('scroll', layoutFooter, { passive: true });
    addEventListener('resize', () => { lastP = -1; cpPainted = false; layoutFooter(); });
    layoutFooter();
  };

  /* =======================================================================
     7e. the footer's circuit traces

     Their PathBackground draws four rounded polylines and runs a light pulse
     along each, with a blurred blob riding the same path. The markup is in our
     footer already — but every path ships as `M 0,0 L 0,0`, because their
     component generates the geometry at runtime, and the animation itself uses
     DrawSVGPlugin and MotionPathPlugin, which are paid GSAP plugins we do not
     have.

     So the geometry is generated here and the pulse is done with
     stroke-dasharray/stroke-dashoffset — the standard way to draw an SVG line,
     and visually the same thing their DrawSVG does. Same for the glow: a CSS
     `offset-path` on the blob instead of MotionPath.
     ======================================================================= */
  /* Put the glow ON the line instead of beside it.

     Their blob is authored centred at (77.5, 44.5) inside its own 155x89 blur
     box, and their MotionPath plugin moves the whole node so that centre lands
     on the path. CSS `offset-path` does something different: it drags the
     element's coordinate ORIGIN along the path, so our glow travelled ~77px
     right and ~44px below the line it was supposed to ride — "it's not
     surrounding it, it's offset, I can't follow it". A transform composes AFTER
     offset positioning, so shifting the shape back by half its own box puts the
     centre exactly on the path. */
  const discOnPath = (blob) => {
    let bb;
    try { bb = blob.getBBox(); } catch { return; }
    if (!bb || !bb.width) return;
    blob.style.transform = `translate(${(-(bb.x + bb.width / 2)).toFixed(1)}px, ${(-(bb.y + bb.height / 2)).toFixed(1)}px)`;
  };
  const headOnPath = (blob) => {
    let bb;
    try { bb = blob.getBBox(); } catch { return; }
    if (!bb || !bb.width) return;
    const r = bb.height / 2; // the round head's radius: the shape is as tall as its head
    blob.style.transform = `translate(${(-(bb.x + r)).toFixed(1)}px, ${(-(bb.y + r)).toFixed(1)}px)`;
  };
  const centreOnPath = (blob) => {
    let bb;
    try { bb = blob.getBBox(); } catch { return; }
    if (!bb || !bb.width) return;
    blob.style.transform =
      `translate(${(-(bb.x + bb.width / 2)).toFixed(1)}px, ${(-(bb.y + bb.height / 2)).toFixed(1)}px)`;
  };

  /* =======================================================================
     the FAQ answers actually open

     Their accordion is a native <details>, but the open state is NOT driven by
     the [open] attribute: their component toggles a class,
     `.accordion-item__content--open { grid-template-rows: 1fr }`, and the 0fr
     -> 1fr transition is what animates the answer down. Nothing in our build
     ever added that class, so every answer stayed at zero height - the summary
     toggled, the arrow turned, and no text appeared. Found by qa/parity.mjs
     (their content box measures 653px wide, ours measured 0).

     Native <details> also hides its own content the instant `open` is removed,
     which would cut the closing animation off at the first frame, so the
     attribute is held on until the transition has run. */
  const faqAccordion = () => {
    /* Opening answers makes the page taller, and every ScrollTrigger below
       the FAQ was still holding the closed-page positions - so the footer
       began its slide up to 400px early and covered the last answers, which
       is the "hides the FAQ" Patrick saw. Any change in the list's height
       refreshes the triggers once it settles. */
    const list = $('.tabbed-accordion__accordion');
    if (list && window.ResizeObserver) {
      let t = 0;
      new ResizeObserver(() => {
        // the footer moves with the page on the same frame the list grows
        if (window.__layoutFooter) window.__layoutFooter();
        clearTimeout(t);
        t = setTimeout(() => {
          if (ScrollTrigger) ScrollTrigger.refresh();
          paintSeams();
        }, 140);
      }).observe(list);
    }
    $$('.accordion-item').forEach((item) => {
      const content = $('.accordion-item__content', item);
      const summary = $('.accordion-item__summary', item);
      if (!content || !summary) return;
      const OPEN = 'accordion-item__content--open';
      let closing = 0;
      summary.addEventListener('click', (e) => {
        e.preventDefault();
        if (item.hasAttribute('open')) {
          content.classList.remove(OPEN);
          clearTimeout(closing);
          closing = setTimeout(() => item.removeAttribute('open'), 480);
        } else {
          clearTimeout(closing);
          item.setAttribute('open', '');
          requestAnimationFrame(() => content.classList.add(OPEN));
        }
      });
    });
  };

  const pathTraces = () => {
    /* The FOOTER's background only. There is a second .path-background inside
       the mid-page CTA panel, and that one already ships real geometry in the
       markup (their component only leaves the footer's degenerate). Running the
       footer's lanes through it drew a footer-sized trace across an 866px
       panel. */
    $$('.footer__wrapper .path-background').forEach((bg) => {
      const svg = $('svg', bg);
      if (!svg) return;
      const box = bg.getBoundingClientRect();
      const w = Math.round(box.width);
      const h = Math.round(box.height);
      if (!w || !h) return;
      svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
      svg.setAttribute('width', w);
      svg.setAttribute('height', h);
      svg.style.position = 'absolute';
      svg.style.inset = '0';

      /* Their actual footer geometry, read out of CjfG5oqe.js (`case "footer"`):
         four polylines given as fractions of the panel, with a corner radius per
         node, rounded by the same Qc() the notches use.

         What was here before was invented — four lanes crossing the panel edge
         to edge — and it showed: the lines ran straight through the headline and
         the button. Theirs stay out of the middle by construction. Nothing
         crosses 0.4w-0.6w below 0.15h, which is exactly where the copy sits. */
      /* THEIR four lanes, verbatim off the live site's hydrated svg
         (qa/ref-paths.mjs, 2026-08-18), authored in their 1440x1106 viewBox.
         What was here before was our own approximation of the shape. Patrick:
         "copy theirs exactly, frame by frame" - so the box below is stretched
         to whatever our footer measures and the paths are used unchanged. */
      /* THE LANES, AUTHORED FOR THIS FOOTER.

         Their four lanes were carried verbatim in their 1440x1106 box and
         stretched onto ours. Ours is 780 tall (section 32i), so the stretch
         squashed every 50px arc into an ellipse and dragged the right-hand
         lane's corner down onto the button - Patrick: "the grid lines near
         the buttons don't look nice". A uniform scale instead cut the two
         lower lanes into fragments.

         So the lanes are generated for the box they sit in, in their
         vocabulary: x as a fraction of the width, y in pixels against the
         footer's real layout (title 150-198, button 246-316, columns 436-760,
         copyright 685+), 50px corners rounded by the same roundedPath the
         notches use. Every lane enters one edge and leaves another. The two
         top lanes emerge from under the paper tab and turn ABOVE the title;
         the right one leaves the edge at 250, before the columns; the two
         lower ones live in the gaps the type leaves - the bottom-right
         between the contact column and the credit, the bottom-left down the
         channel between the wordmark and the link columns. */
      /* Round 2 (2026-09-07, point 18): THEIR five lanes, verbatim off the
         live footer at 1470x1083 (qa/w2-terminal-footer.mjs, footer-info.json),
         x scaled to our width and y to our height. Our footer is laid out to
         their numbers (title at 230, columns at 721), so every lane lands
         where theirs does: the accent one above the title, two from the top
         edge down the sides, two into the bottom corners. */
      const sx = w / 1470;
      const sy = 1; // round 2h: the box is content-tall; the lanes keep their own shape and the bottom edge crops them (a circle stays a circle)
      const scaleLane = (d) => d
        .replace(/([ML]) ([\d.]+),([\d.]+)/g, (m, c, x, y) => `${c} ${(x * sx).toFixed(2)},${(y * sy).toFixed(2)}`)
        /* an affine scale of a circular arc is an ellipse with rx = r*sx and
           ry = r*sy, so the corners follow the box exactly when our footer is
           shorter than their 1083 (round 2d: the footer is content-tall) */
        .replace(/A ([\d.]+),([\d.]+) (\d) (\d) (\d) ([\d.]+),([\d.]+)/g,
          (m, rx, ry, f1, f2, f3, x, y) => `A ${(rx * sx).toFixed(2)},${(ry * sy).toFixed(2)} ${f1} ${f2} ${f3} ${(x * sx).toFixed(2)},${(y * sy).toFixed(2)}`);
      /* Round 2c: FOUR lanes, not five. The fifth ("M 0,253 ... L 645,221")
         was their ROI card's lane: the capture took every .path-background on
         their page, and the stray one ran under our title as an extra line
         (Patrick: "your own extra lines"). qa/w2-lanes.mjs now reads only
         .footer__wrapper .path-background and overlays theirs on ours. */
      /* Round 2e: the lanes follow OUR wireframe, not their coordinates. The
         two upper lanes are anchored to the title and the button, which sit
         where theirs do, so they stay. The two lower lanes ride 17px above
         the columns' top (theirs: 704 over columns at 721); our columns are
         centred lower in the box, so those two shift by the difference,
         measured off the live layout every time the footer is sized. */
      /* the columns' own top (wordmark, Siden, Kontakt), not the wrapper's
         padding box, since round 2h puts the room to the button inside it */
      const contentTop = (() => {
        const cw = $('.content-wrapper', bg); if (!cw) return 721;
        const tops = [...cw.children].map((el) => el.getBoundingClientRect().top).filter((t) => Number.isFinite(t));
        return (tops.length ? Math.min(...tops) : cw.getBoundingClientRect().top) - box.top;
      })();
      const dy = Math.round(contentTop / sy - 721) - 30; // in their 1083 units, applied before scaling; 30 higher than their 17 over the columns (round 2e: the lines ran into our text)
      const lower = (d) => d.replace(/([ML]) ([\d.]+),([\d.]+)/g, (m, c, x, y) => `${c} ${x},${(+y + dy).toFixed(2)}`)
        .replace(/A ([\d.]+),([\d.]+) (\d) (\d) (\d) ([\d.]+),([\d.]+)/g, (m, rx, ry, f1, f2, f3, x, y) => `A ${rx},${ry} ${f1} ${f2} ${f3} ${x},${(+y + dy).toFixed(2)}`)
        .replace(/,(\d+(?:\.\d+)?)(?=\s*$)/, (m, y) => `,${Math.max(+y, h)}`); // the run to the bottom edge still ends on (or past) the bottom edge
      /* the top-right lane lifted 90 and moved 40 right, so its bend and
         run sit above the title's first line instead of through its end */
      const shift = (d, dx, dyy) => d.replace(/([ML]) ([\d.]+),([\d.]+)/g, (m, c, x, y) => `${c} ${Math.min(1470, +x + dx).toFixed(2)},${Math.max(0, +y + dyy).toFixed(2)}`)
        .replace(/A ([\d.]+),([\d.]+) (\d) (\d) (\d) ([\d.]+),([\d.]+)/g, (m, rx, ry, f1, f2, f3, x, y) => `A ${rx},${ry} ${f1} ${f2} ${f3} ${Math.min(1470, +x + dx).toFixed(2)},${Math.max(0, +y + dyy).toFixed(2)}`);
      const FOOTER_LANES = [
        /* round 2h: the box is 802 tall, not 1083, so this lane's drop is 150
           shorter (520 -> 370) and its tail to the left edge rides up with it;
           otherwise the lower-left lane, now at ~493, would cut through it */
        'M 588,0 L 588,80.45 A 50,50 0 0 1 538,130.45 L 417.5,130.45 L 197,130.45 A 50,50 0 0 0 147,180.45 L 147,370.65 A 25.11,25.11 0 0 1 101.84,385.77 L 0,250.71',
        shift('M 882,0 L 882,199.09 A 50,50 0 0 0 932,249.09 L 1273,249.09 A 50,50 0 0 1 1323,299.09 L 1323,437.35 A 50,50 0 0 0 1373,487.35 L 1470,487.35', 40, -120), // round 2j: the title box starts at 172 now; both upper lanes ride 30 higher and stay 40 above it
        /* right lane 60 further right, so its drop and diagonal sit beside the
           Kontakt column (1068-1385) rather than through its top line */
        lower('M 1470,866.4 L 1396.42,718.78 A 45.07,45.07 0 0 0 1363,703.95 L 1065.5,703.95 A 50,50 0 0 0 1015.5,753.95 L 1015.5,1083'),
        /* left lane's corner past the copyright line (ends ~560) and the
           diagonal down the gap before the Siden column (624) */
        lower('M 0,703.95 L 500,703.95 A 58.79,58.79 0 0 1 546.45,798.77 L 326,1083'),
      ].map(scaleLane);
      // one unit per pixel: nothing is scaled, so a circle stays a circle
      svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
      svg.setAttribute('preserveAspectRatio', 'none');

      /* Their footer runs FOUR lanes; the markup we captured ships three trios
         of [blob, rail, live]. Clone one trio up to four so the fourth lane
         exists at all - without this the bottom-left diagonal simply never
         appeared, and "copy theirs exactly" includes how many there are. */
      let groups = $$('path', svg);
      while (groups.length < FOOTER_LANES.length * 3 && groups.length >= 3) {
        for (let k = 0; k < 3; k++) svg.appendChild(groups[k].cloneNode(true));
        groups = $$('path', svg);
      }
      // their markup repeats [blob, static line, animated line] per trace
      for (let i = 0; i * 3 + 2 < groups.length && i < FOOTER_LANES.length; i++) {
        const blob = groups[i * 3];
        const base = groups[i * 3 + 1];
        const live = groups[i * 3 + 2];
        const d = FOOTER_LANES[i];
        /* Colour and opacity are left exactly as the markup ships them — a grey
           rail at stroke-opacity 0.15 and a full-strength pulse over it.
           Overriding the rail to solid grey is what made ours read as three
           drawn boxes in the footer; on the live site the rails are barely
           there and the pulse is the only thing you notice. */
        base.setAttribute('d', d);
        live.setAttribute('d', d);
        // their 0.15 sits on #052424; on our lighter navy the same value read
        // as drawn lines, so a step down
        /* walkthrough 2026-09-05 (point 23): Patrick wants the lines to show.
           0.22 on the rails, a lighter pulse; the fifth lane in the accent. */
        /* Round 2c: their values, no exceptions. Rails #A2A2A2 at 0.15, the
           pulse #A2A2A2; their first lane is their accent (lime) at 0.15 with
           a lime pulse, so ours is the brand blue at 0.15 with a blue pulse. */
        base.setAttribute('stroke-opacity', '0.15');
        base.setAttribute('stroke', '#A2A2A2');
        live.setAttribute('stroke', '#A2A2A2'); // their footer pulses are grey; the lime one belonged to the ROI card

        /* The pulse is a DOT, not a streak. Their DrawSVG runs `0% 1%` to
           `99% 100%` — one per cent of the path length, travelling the whole
           way. Ours was 12%, which at this width is a 200px dash: it read as a
           bar sliding along a rail rather than a signal running through one. */
        const len = live.getTotalLength ? live.getTotalLength() : w;
        const dash = Math.max(8, len * 0.01);
        /* round 2i: the dot's HEAD sits exactly at f*len for f in 0..1, the
           same point the blob is driven to (offset-distance f), so the glow
           is on the dot. Offset runs from +dash (dot parked just before the
           start) to dash-len (head on the end point); the gap is longer than
           the path, so the pattern never wraps a second dot onto the start. */
        live.style.strokeDasharray = `${dash.toFixed(1)} ${Math.ceil(len + dash) + 2}`;
        live.style.setProperty('--trace-from', `${dash.toFixed(1)}`);
        live.style.setProperty('--trace-to', `${(dash - len).toFixed(1)}`);
        live.style.strokeDashoffset = `${dash.toFixed(1)}`;
        base.setAttribute('vector-effect', 'non-scaling-stroke');
        live.setAttribute('vector-effect', 'non-scaling-stroke');
        /* Their timing, measured frame by frame off the live site over four
           cycles (qa/ref-trace-time.mjs, 2026-08-18): the dot does NOT run at a
           constant speed. It creeps out, accelerates through the middle and
           eases to a stop - a plain power2.inOut, which at half the cycle has
           covered 50.6% of the path and at a quarter only 12.9%. Ours ran
           linear, which is what read as "not as cool as theirs".
           Their cycle is 3s; ours stays at 4.5s because Patrick prefers the
           slower read. The curve is what is being copied, not the speed. */
        /* Round 2g: one lane at a time (qa/w2-pulse.mjs against Terminal live):
           an 18s cycle, each lane's travel in its own 4.5s quarter, the
           easing carried inside the keyframes (final.css 35f). */
        /* round 2h: two pulses on screen at any moment (Patrick: one at a
           time left the grid empty most of the time). Each lane runs for
           half the cycle and the next lane starts halfway through. */
        const STEP = 3;
        const CYCLE = STEP * FOOTER_LANES.length;
        const delay = `${(i * STEP).toFixed(1)}s`;
        live.style.animation =
          `trace-run-2 ${CYCLE}s linear ${delay} infinite backwards, trace-fade-2 ${CYCLE}s linear ${delay} infinite backwards`; // backwards: hidden and parked during its wait, not a static dot
        if (blob) {
          /* round 2i: anchored on the glow's round head, not the bbox centre
             (the shape is 87 long with a 21 head, so centring it put the
             bright part 33px behind the dot: "the glow is not on the dot") */
          /* round 2k, measured in a real GPU Chrome (qa/w2-glow-headed.mjs):
             their teardrop is 87 long, so its blurred mass sat ~30px behind
             the dot however it was anchored ("the glow is not on the dot").
             The glow is now a disc centred on the dot, blurred by their own
             filter, whose region is widened so the blur is not clipped. */
          blob.setAttribute('d', 'M 77.5,32.5 a 9,9 0 1 0 0.001,0 Z'); /* polish: 12 -> 9, the halo was too strong (Patrick) */
          /* their blur (17) on their grey left the halo invisible on our navy
             in a real Chrome (qa/w2-glow-variants.mjs: with and without the
             blob the frames were the same). Our own softer blur on a lighter
             disc reads as a halo around the dot. */
          const svgEl = blob.ownerSVGElement;
          if (svgEl && !svgEl.querySelector('#bd-glow')) {
            const ns = 'http://www.w3.org/2000/svg';
            const defs = svgEl.querySelector('defs') || svgEl.insertBefore(document.createElementNS(ns, 'defs'), svgEl.firstChild);
            const f = document.createElementNS(ns, 'filter');
            f.setAttribute('id', 'bd-glow'); f.setAttribute('x', '-100%'); f.setAttribute('y', '-100%'); f.setAttribute('width', '300%'); f.setAttribute('height', '300%');
            const g = document.createElementNS(ns, 'feGaussianBlur'); g.setAttribute('stdDeviation', '6');
            f.appendChild(g); defs.appendChild(f);
          }
          blob.style.filter = 'url(#bd-glow)';
          blob.setAttribute('fill', '#dfe6ee');
          blob.setAttribute('fill-opacity', '0.2');
          discOnPath(blob);
          blob.style.offsetPath = `path("${d}")`;
          /* rotates with the path direction so the glow leans into every
             corner; turned 180 so the round head leads and the tail streams
             behind the dot */
          blob.style.offsetRotate = 'auto 180deg';
          blob.style.animation =
            `trace-blob-2 ${CYCLE}s linear ${delay} infinite backwards, trace-fade-2 ${CYCLE}s linear ${delay} infinite backwards`;
        }
      }
    });
  };

  /* =======================================================================
     7f. the mid-page CTA panel's own circuit trace

     Unlike the footer's, this panel's markup ships REAL path geometry (a small
     elbow, lime #ABFF02, with its own blurred blob) — their component only
     leaves the svg at viewBox="0 0 0 0" because it sizes it on mount. So
     nothing rendered at all: the panel was a flat dark box.

     Sizing the svg to the panel also fixes the soft, fuzzy stroke edges, which
     were a degenerate coordinate space being scaled up rather than a real 1:1
     viewBox.
     ======================================================================= */
  const panelTraces = () => {
    const bg = $('.roi-calculator__results .path-background');
    const svg = bg && $('svg', bg);
    if (!bg || !svg) return;
    if (!bg.getBoundingClientRect().width) return;

    /* The card is a declared 560 x 666, so the lanes are authored in that box
       and stretched with preserveAspectRatio="none". Their sizes-to-the-panel
       version drew a fuzzy stroke because the coordinate space was degenerate;
       a fixed authoring box plus non-scaling-stroke keeps the hairline at 1px
       in both axes however the card is scaled. */
    svg.setAttribute('viewBox', '0 0 560 666');
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.removeAttribute('width');
    svg.removeAttribute('height');
    svg.style.position = 'absolute';
    svg.style.inset = '0';

    /* THE TWO LANES.

       Read back off our own footer and Terminal's ROI panel (qa/ourfooter.mjs):
       a lane ENTERS one edge of the box and EXITS another, turns two or three
       times at a 30-40px radius, and never stops in mid-air. Four earlier
       attempts here were single bends that gave up halfway across the card;
       Patrick, correctly: "it's not a straight line; it's not a bent line that
       stops halfway through the whole card."

       The big lane comes in through the left edge at 59% of the height, runs up
       the empty left column, turns above the three points and leaves through
       the right edge. The small one drops in from the top edge left of the
       notch and leaves through the left edge. They never come within 54px of
       each other, and neither comes within 22px of a word. */
    const LANES = [
      'M 0,390 L 110,390 A 40 40 0 0 0 150,350 L 150,204 A 40 40 0 0 1 190,164 L 560,164',
      'M 130,0 L 130,6 A 30 30 0 0 1 100,36 L 0,36',
    ];

    /* SPEED IS CONSTANT, THE PERIOD IS NOT.

       Their system runs every lane on one shared cycle, which works when the
       lanes are all roughly the same length. Ours are 786px and 153px, and on a
       shared 6s cycle the small dot crawled at a fifth of the big one's speed -
       "the small one is a little bit too much of a difference, kind of
       distracting that they're so different."

       So both dots travel at the same 230px/s and each lane rests afterwards.
       The periods are 6s and 3s, which is a deliberate 2:1 - the small dot
       fires exactly twice per lap of the big one, so the difference reads as
       rhythm rather than as two unrelated animations.

       Travel keeps their measured curve (power2.inOut: creeps out, accelerates
       through the middle, eases to a stop). The fade is the sharp envelope, not
       the soft one - on their site the dot is simply there at the start and
       gone at the end. */
    /* SPEED.

       First attempt: one shared 6s cycle. The 786px lane ran at 131px/s and the
       153px lane at 26px/s - "the small one is a little bit too much of a
       difference, kind of distracting that they're so different."

       Second: one shared speed, 230px/s. That fixed the ratio and broke the
       feel - the small lane was over in 0.67s, "way too fast", and the big one
       was still "a little bit too fast".

       Neither constant works, because the lanes are 5x apart in length. Travel
       time is set on the SQUARE ROOT of the length instead, which splits the
       difference: the big lane takes 5.0s at 157px/s, the small one 2.2s at
       69px/s. Both are slower than before, and the speed ratio drops from 5x
       to 2.3x, so they still read as one system.

       The periods stay a clean 2:1, so the small dot fires exactly twice per
       lap of the big one. */
    const TRAVEL = (len) => 200 * Math.sqrt(len);
    /* Both lanes now share a 9s period and alternate, staggered half a lap
       apart. The small lane used to run every 3.75s, which on a 153px path is
       a dot that blinks on, crosses and dies about every three seconds - it
       read as flickering rather than travelling. Once per 9s, it is an event.

       The curve is flattened too. power2.inOut is their measured travel curve
       and it is right on a 1154px footer lane, but on our 786px card lane the
       middle of the cycle was covering a third of the path per second while
       both ends crawled, which is the "moves very terribly" - a crawl, a flick,
       a crawl. This curve keeps soft ends without the mid-run rush. */
    const PERIODS = [6800, 6800];
    const EASE = 'cubic-bezier(0.33, 0.12, 0.67, 0.88)';
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const NS = 'http://www.w3.org/2000/svg';
    // their markup ships one trio (blob / rail / live); rebuild it per lane
    $$('path', svg).forEach((p) => p.remove());

    LANES.forEach((d, i) => {
      const rail = document.createElementNS(NS, 'path');
      rail.setAttribute('d', d);
      rail.setAttribute('data-rail', '');
      rail.setAttribute('fill', 'none');
      rail.setAttribute('stroke', '#2B5FBF');
      rail.setAttribute('stroke-width', '1');
      rail.setAttribute('vector-effect', 'non-scaling-stroke');
      svg.appendChild(rail);

      /* THE PIN IS A CIRCLE, NOT A DASH.

         Their mechanism is a 1%-length dash driven by stroke-dashoffset, with a
         blurred blob following on a CSS offset-path. Those are two different
         parameterisations of the same curve: the dash's position maps over
         (length + dash) while offset-distance maps over length, so the dash
         runs ahead of its own glow by up to the dash's own width. On a 786px
         lane that is 8px - invisible on their 1154px footer, obvious here
         against a 30px glow. Patrick: "the highlight doesn't really follow
         exactly on the pin itself."

         Pin and glow are now two circles on the SAME offset-path with the same
         keyframes, so they cannot drift by construction. At this size their
         dash was an 8px mark anyway. */
      /* A SHORT LINE, NOT A DOT. Theirs is a dash - 1% of the path length,
         which on the footer's 1154px lane is an 11px mark that leans into
         every corner. A round dot loses that. This is a 12px rounded bar on
         the same offset-path with offset-rotate:auto, so it follows the
         curve's direction exactly like their dash does, and because it shares
         the path and the keyframes with its glow the two cannot drift. */
      const live = document.createElementNS(NS, 'rect');
      live.setAttribute('x', '-6');
      live.setAttribute('y', '-0.6');
      live.setAttribute('width', '12');
      live.setAttribute('height', '1.2');
      live.setAttribute('rx', '0.6');
      live.setAttribute('fill', '#CFE1FF');
      live.setAttribute('data-live', '');
      svg.appendChild(live);

      const blob = document.createElementNS(NS, 'circle');
      blob.setAttribute('r', '7');
      blob.setAttribute('fill', '#4D8BEF');
      blob.setAttribute('data-live', '');
      blob.style.filter = 'blur(9px)';
      svg.appendChild(blob);

      if (reduce) return;

      const len = rail.getTotalLength();
      const period = PERIODS[i];
      // the fraction of the cycle the dot is actually moving; the rest is rest
      const run = Math.min(0.95, TRAVEL(len) / period);
      const delay = -i * 3400;

      const move = [
        { offsetDistance: '0%', offset: 0, easing: EASE },
        { offsetDistance: '100%', offset: run },
        { offsetDistance: '100%', offset: 1 },
      ];
      const fade = (peak) => [
        { opacity: 0, offset: 0 },
        { opacity: peak, offset: run * 0.04 },
        { opacity: peak, offset: run * 0.94 },
        { opacity: 0, offset: run },
        { opacity: 0, offset: 1 },
      ];
      const timing = { duration: period, iterations: Infinity, delay };

      [[live, 1], [blob, 0.9]].forEach(([el, peak]) => {
        centreOnPath(el);
        el.style.offsetPath = `path("${d}")`;
        el.style.offsetRotate = 'auto';
        el.animate(move, timing);
        el.animate(fade(peak), timing);
      });
    });
  };

  /* =======================================================================
     7g. the quote panel is a photograph, not a plate

     Ported verbatim from their Quote component (ByoCQaq9.js):
       gsap.set(imageWrapper, {yPercent:-15})
       gsap.to(imageWrapper, {yPercent:15, ease:"none",
         scrollTrigger:{trigger:n.value, start:"top bottom", end:"bottom top", scrub:!0}})
     A -6/6 guess shipped here before this was grepped instead of measured. The
     drift rides on an overscale so the frame stays full at both ends of the travel.
     ======================================================================= */
  const quoteLife = () => {
    const panel = $('.big-image-content');
    const img = panel && $('.image-wrapper', panel);
    if (!panel || !img || !gsap || !ScrollTrigger) return;
    gsap.set(img, { scale: 1.15, yPercent: -15 });
    gsap.to(img, {
      yPercent: 15,
      ease: 'none',
      scrollTrigger: { trigger: panel, start: 'top bottom', end: 'bottom top', scrub: true },
    });
  };

  /* =======================================================================
     7h-pre. the kontakt fields rise in, and never did

     Ported verbatim from the same chunk as the heading sweep (KAt1aMJ3.js):
       tl = gsap.timeline({ scrollTrigger: { trigger: I.value, start: "top 85%", once: true } })
       tl.from(I.value, { autoAlpha: 0, y: 24, duration: .7, ease: "power3.out" })
         .from(fields,   { autoAlpha: 0, y: 12, duration: .5, stagger: .06, ease: "power2.out" }, "-=0.4")
     I.value is the step container that holds both the field grid and the submit
     button (`.field-wrapper, .navigation-buttons` — both class names ship
     verbatim in our markup already). Never wired; the fields just sat there.
     ======================================================================= */
  const formFieldsReveal = () => {
    const box = $('.form-section');
    if (!box || !gsap || !ScrollTrigger) return;
    const fields = $$('.field-wrapper, .navigation-buttons', box);
    if (!fields.length) return;
    gsap
      .timeline({ scrollTrigger: { trigger: box, start: 'top 85%', once: true } })
      .from(box, { autoAlpha: 0, y: 24, duration: 0.7, ease: 'power3.out' })
      .from(fields, { autoAlpha: 0, y: 12, duration: 0.5, stagger: 0.06, ease: 'power2.out' }, '-=0.4');
  };

  /* =======================================================================
     8. boot — the three beats of the opening

     Beat 1  wordmark wipes in on the field       0    -> 500ms
     Beat 2  hold                                  500  -> 700ms
     Beat 3  mark clears                           700  -> 950ms
     Beat 4  lens opens to full bleed              920  -> 1670ms
             photo develops 1150-1650, bar 1250-1650

     1.8s end to end. The first cut ran 2.1s plus load, which put the page past
     three seconds before it would take a click: too long for something Patrick
     reloads all day, and long enough that the interaction suite was testing a
     page still behind the veil.

     The mark is centred, so it has to be gone before the opening appears in the
     same place. Its fade is 250ms and the clip is held back 220ms, so they
     cross for 30ms and never fight.

     The shapes and easings are in final.css section 17; this only flips the
     classes, so the two can never disagree about timing.

     It starts on window load, or after 1300ms if the photograph is slow,
     whichever comes first. Waiting unconditionally would mean a visitor on a
     bad connection staring at a blank field; not waiting at all would mean the
     slit opening onto an image that has not arrived. The safety timer is the
     point: every path out of here ends with the veil gone.
     ======================================================================= */
  const boot = () => {
    const root = document.documentElement;
    if (!root.classList.contains('booting')) return; // reduced motion, or no JS
    const veil = $('.boot');
    if (!veil || typeof BOOT_DATA === 'undefined') { root.classList.remove('booting'); return; }

    /* THE INTRO ONLY BELONGS AT THE TOP.

       Patrick asked whether this should run on every reload. Measured
       (qa/boot-midpage.mjs): scroll to the FAQ, hit reload, and the browser
       restores you to scrollY 4200 while the doors open over the top of it -
       a reveal onto a hero the visitor was not looking at and did not ask to
       see again. Landing on a deep link does the same thing: index.html
       #fordele plays the whole opening before dropping you three sections
       down.

       So the gate is position, not visit count. Loading at the top, by any
       route, plays it. Loading anywhere else skips straight to the page.

       Deliberately NOT gated per session: the real terminal-industries.com
       replays its loader on every load and keeps no storage key that could
       suppress it (qa/terminal-boot2.mjs), and at ~1.1s this is the brand's
       one authored moment. Someone who reloads at the top has asked for the
       page from the beginning. */
    const restored = window.scrollY > 40 ||
      (location.hash && location.hash !== '#top');
    if (restored) {
      root.classList.remove('booting', 'boot-roll', 'boot-icon');
      veil.remove();
      dropLoader();
      return;
    }

    const D = BOOT_DATA;
    const top = veil.querySelector('.boot__half--top');
    const bot = veil.querySelector('.boot__half--bot');
    const clipTop = veil.querySelector('#bclip-top path');
    const clipBot = veil.querySelector('#bclip-bot path');
    const grids = veil.querySelectorAll('.boot__grid');
    const stageTop = top.querySelector('.boot__stage');
    const stageBot = bot.querySelector('.boot__stage');
    const overlay = veil.querySelector('.boot__overlay');
    let started = false;

    // linear interpolation into a [[t, v...]] sample table
    const lerpAt = (arr, t, col) => {
      if (t <= arr[0][0]) return arr[0][col];
      for (let i = 1; i < arr.length; i++) {
        if (arr[i][0] >= t) {
          const a = arr[i - 1], b = arr[i];
          const f = (t - a[0]) / (b[0] - a[0] || 1);
          return a[col] + (b[col] - a[col]) * f;
        }
      }
      return arr[arr.length - 1][col];
    };

    // last clip sample at or before t (no interpolation across arc-flag flips)
    const clipAt = (t) => {
      let last = null;
      for (const c of D.clips) { if (c[0] <= t) last = c; else break; }
      return last;
    };

    // rescale a baked 1440x900 path to the current viewport
    const NUM = /[MLAZ]|-?\d*\.?\d+/g;
    const scaleD = (d, sx, sy) => {
      const tk = d.match(NUM);
      let out = '';
      for (let i = 0; i < tk.length;) {
        const c = tk[i];
        if (c === 'M' || c === 'L') {
          out += c + ' ' + (tk[i + 1] * sx).toFixed(2) + ',' + (tk[i + 2] * sy).toFixed(2) + ' ';
          i += 3;
        } else if (c === 'A') {
          out += 'A ' + (tk[i + 1] * sx).toFixed(2) + ',' + (tk[i + 2] * sy).toFixed(2) + ' ' +
            tk[i + 3] + ' ' + tk[i + 4] + ' ' + tk[i + 5] + ' ' +
            (tk[i + 6] * sx).toFixed(2) + ',' + (tk[i + 7] * sy).toFixed(2) + ' ';
          i += 8;
        } else if (c === 'Z') { out += 'Z '; i++; }
        else i++;
      }
      return out.trim();
    };

    /* THE PAGE IS HELD, NOT HIDDEN.

       The old lock was `html.booting body { overflow: hidden }`, and it is what
       Patrick saw as the scrollbar "popping up" a beat after the hero: the
       scrollbar does not exist while overflow is hidden, and it appears the
       instant the class comes off. scrollbar-gutter reserved the width, so the
       page did not shift - but the bar itself still arrived out of nowhere.

       So the document keeps its overflow from the first paint and the
       scrollbar is simply there the whole time. What stops the visitor moving
       during the intro is Lenis, which owns wheel and touch anyway
       (lenis.stop() swallows both), plus the handful of keys that scroll. */
    const SCROLL_KEYS = new Set([' ', 'PageDown', 'PageUp', 'ArrowDown', 'ArrowUp', 'Home', 'End']);
    const holdKeys = (e) => { if (SCROLL_KEYS.has(e.key)) e.preventDefault(); };
    // wheel and touch are Lenis's to refuse while it is stopped; this is the
    // same refusal without it, for the visitor whose CDN request for Lenis
    // never came back
    const holdWheel = (e) => e.preventDefault();
    if (window.__lenis) window.__lenis.stop();
    addEventListener('keydown', holdKeys);
    addEventListener('wheel', holdWheel, { passive: false });
    addEventListener('touchmove', holdWheel, { passive: false });

    const finish = () => {
      root.classList.remove('booting', 'boot-roll', 'boot-icon');
      if (veil) veil.remove();
      removeEventListener('keydown', holdKeys);
      removeEventListener('wheel', holdWheel);
      removeEventListener('touchmove', holdWheel);
      if (window.__lenis) window.__lenis.start();
      if (ScrollTrigger) ScrollTrigger.refresh();
    };

    const start = () => {
      if (started) return;
      started = true;
      scrollTo(0, 0);
      const sx = innerWidth / D.W, sy = innerHeight / D.H;
      // doors closed: clip is the full half, no notch
      const flat = `M -0.5,-0.5 L ${innerWidth + 0.5},-0.5 L ${innerWidth + 0.5},${innerHeight / 2 + 0.5} L -0.5,${innerHeight / 2 + 0.5} Z`;
      clipTop.setAttribute('d', flat);
      clipBot.setAttribute('d', flat);
      // Terminal holds a bare field for 745ms before the entrance starts. On
      // their light field that reads as a beat; on ours it read as a stall, so
      // the playback clock starts part-way in. Only the lead-in is shortened -
      // every beat AFTER the entrance keeps its exact relative timing.
      const LEAD_TRIM = 390;
      const t0 = performance.now() - LEAD_TRIM;
      let rolled = false, iconed = false, lastClipT = -1;
      const tick = () => {
        const t = performance.now() - t0;
        // entrance: the field swings in (scale 2 / rotate 20deg / opacity 0 -> identity)
        if (t >= D.beats.entrance - 20) {
          const sc = lerpAt(D.entrance, t, 1);
          const rot = lerpAt(D.entrance, t, 2);
          const op = lerpAt(D.entrance, t, 3);
          for (const g of grids) {
            g.style.transform = `rotate(${rot}deg) scale(${sc})`;
            g.style.opacity = op;
          }
        }
        // the lockup, on Terminal's own beats: their icon starts drawing at
        // ~1.48s (our BUNKER wipes in), their text rolls in at 2.34s (our
        // DANMARK rolls down right-to-left)
        if (!iconed && t >= 1475) { iconed = true; root.classList.add('boot-icon'); }
        if (!rolled && t >= 2340) { rolled = true; root.classList.add('boot-roll'); }
        /* The copy is NOT released here. Patrick, after seeing it rise into the
           opening slit: the overlay has to clear completely first, and only
           then does the copy come in - a shade quicker than the 383ms of dead
           air the very first cut had, not a shade slower.

           So the gate is finish() itself: the veil is removed, .booting comes
           off, and the paused entrance starts counting its delay from that
           instant. The beat is the first element's 0.10s delay, which measured
           ~320ms after the doors are fully open (they open ~215ms before the
           veil is dropped). css/final.css section 22 owns the rest. */
        // doors + clip morph + overlay fade
        if (t >= D.beats.doorStart - 60) {
          const y = lerpAt(D.door, t, 1) * sy;
          top.style.transform = `translateY(${y}px)`;
          bot.style.transform = `translateY(${-y}px)`;
          // The doors move; the artwork does not. Terminal counter-translates
          // the stage inside each half by exactly the door's travel
          // (qa/tstatic.mjs: door goes to -450 while the line art's and logo's
          // client rects stay pinned at 0). So the lines and the lockup hold
          // still and the clip window rises past them - the lockup is erased
          // rather than carried off. Without this the two copies of the art
          // slide in opposite directions and the shapes double up.
          stageTop.style.transform = `translateY(${-y}px)`;
          stageBot.style.transform = `translateY(${y}px)`;
          const c = clipAt(t);
          if (c && c[0] !== lastClipT) {
            lastClipT = c[0];
            clipTop.setAttribute('d', scaleD(c[1], sx, sy));
            clipBot.setAttribute('d', scaleD(c[2], sx, sy));
          }
          overlay.style.opacity = lerpAt(D.overlay, t, 1);
        }
        if (t >= D.beats.end) { finish(); return; }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    };

    if (document.readyState === 'complete') start();
    else addEventListener('load', start, { once: true });
    // a visitor on a bad connection should not stare at a still field forever
    setTimeout(start, 2500);
  };
  /* =======================================================================
     7b. nav anchors

     The menu is anchors on a one-scroll page, so a click has to glide rather
     than jump — Lenis (the smooth-scroll library) owns the scroll position, and
     the browser's native anchor jump fights it. Offset by the header so a
     section's heading is not parked underneath the bar.
     ======================================================================= */
  const anchors = () => {
    const headerH = () => {
      /* 2026-09-16: the bar itself, not the whole <header>. On a phone the
         header's box also holds the closed menu panel (755px tall, slid off
         to the right), so a menu tap used to land the section 800px down,
         out of sight. Measured in qa/v11-update-menu.mjs. */
      const bar = $('.site-header .inner') || $('header');
      const r = bar ? bar.getBoundingClientRect() : null;
      return r ? r.bottom + 24 : 100;
    };
    document.addEventListener('click', (e) => {
      const a = e.target.closest && e.target.closest('a[href^="#"]');
      if (!a) return;
      const id = a.getAttribute('href').slice(1);
      if (!id) return;
      // the logo and the footer's first link point at #top, which is the page
      // itself rather than a section
      if (id === 'top') {
        e.preventDefault();
        if (window.__lenis) window.__lenis.scrollTo(0, { duration: 1.1 });
        else scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }
      const target = document.getElementById(id);
      if (!target) return;
      e.preventDefault();
      const y = target.getBoundingClientRect().top + scrollY - headerH();
      if (window.__lenis) window.__lenis.scrollTo(y, { duration: 1.1 });
      else scrollTo({ top: y, behavior: 'smooth' });
    });
  };

  /* =======================================================================
     8c. headline lines

     The headline enters one line at a time, each one rising out from behind
     its own edge, so give every line a box that can clip it. Done here rather
     than in the markup because the markup is generated (personalise.py) and
     the copy still changes; the split reads the <br> that is already there.

     If this never runs the headline keeps replica.css's plain rise, so the
     copy can never be stranded invisible.
     ======================================================================= */
  const splitHeadline = () => {
    const h1 = $('.hero-copy h1');
    if (!h1 || h1.classList.contains('is-split')) return;
    const lines = h1.innerHTML.split(/<br\s*\/?>/i).map((s) => s.trim()).filter(Boolean);
    if (lines.length < 2) return;
    h1.innerHTML = lines
      .map((l) => `<span class="hl"><span class="hl__i">${l}</span></span>`)
      .join('');
    h1.classList.add('is-split');
  };

  /* =======================================================================
     9. the Fordele cards
     Two behaviours, one loop.

     THE LIT EDGE. Every card carries a 1px ring in accent blue (CSS section
     25) that is masked by a soft radial gradient, so only the part of the ring
     near the light is visible. This sets where that light is. The one thing
     that matters here is that the light does NOT sit on the cursor: it is
     eased toward it a fraction of the remaining distance per frame, so it
     trails, overshoots nothing, and settles. Patrick's note on the first build
     was that the blue moved "too static", and that was exactly this - the
     light was assigned the pointer position directly, which gives it no mass.

     THE PARALLAX. The same loop shifts the picture inside its frame against
     the cursor. The frame itself never moves.

     Everything is smoothed here rather than in CSS transitions, so the ring,
     the lift and the picture share one easing and arrive together instead of
     running four timings against each other.
     ======================================================================= */
  const fordeleCards = () => {
    const cards = $$('#fordele .product-grid__card');
    if (!cards.length) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    // a finger has no hover, and a sticky lit state after a tap looks broken
    if (!matchMedia('(hover: hover) and (pointer: fine)').matches) return;

    /* per frame, the fraction of the remaining distance covered. IN is slower
       than OUT on purpose: an entrance is allowed to take its time, an exit
       that lingers reads as lag. 0.12 settles in ~24 frames (~400ms). */
    /* SOFTENED, second pass. Patrick: "everything just moves too fast and too
       rigidly... it doesn't have that premium, award-winning, high-end feel".

       Every number here is roughly a third slower and a third smaller than the
       first build. The reason a hover reads as cheap is almost never that it
       does too little - it is that it arrives too fast and travels too far, so
       the eye reads mechanism instead of material.

                    was     now
         light     0.12    0.075   settles in ~0.6s instead of ~0.35s
         exit      0.2     0.11    still faster than the entrance
         picture   0.045   0.028   about a third of the light, as before
         travel    8px     5px
         lift      4px     3px */
    const EASE_IN = 0.075;
    const EASE_OUT = 0.11;

    /* The picture is deliberately SLOWER than the light, and travels less far.
       Patrick: the middle card's picture felt "too quick to respond... almost a
       little bit sporadic", and he is describing two different things at one
       speed. The light is a reflection and should answer immediately; a heavy
       object seen through an opening should drift. Running both at 0.12 made
       the picture twitch with every small movement of the hand.

       0.045 per frame is roughly a third of the light's rate: the picture takes
       about a second to arrive where the cursor already is, which reads as
       weight rather than lag because nothing is waiting on it. The travel drops
       from 12px to 8px for the same reason - less distance to cover, less
       apparent speed.

       Why the middle card and not the other two: same numbers on all three, but
       card two's photograph is dark with strong vertical ribs, and vertical
       lines against a dark ground make horizontal movement far more readable
       than a pale interior or a sky does. The motion was identical; only the
       picture made it visible. Slowing it fixes all three. */
    const EASE_PIC = 0.028;
    const SHIFT = 5;    // px the picture travels at the frame's edge
    const lerp = (a, b, t) => a + (b - a) * t;

    const state = cards.map((el) => ({
      el,
      // live: what is painted. want: where the pointer is. pic: the picture,
      // which trails further behind than the light does.
      live: { x: 0.5, y: 0.5, lit: 0 },
      pic: { x: 0.5, y: 0.5 },
      want: { x: 0.5, y: 0.5, lit: 0 },
      w: 1,
      h: 1,
    }));

    let running = false;
    const frame = () => {
      let busy = false;
      for (const s of state) {
        const t = s.want.lit > s.live.lit ? EASE_IN : EASE_OUT;
        s.live.x = lerp(s.live.x, s.want.x, EASE_IN);
        s.live.y = lerp(s.live.y, s.want.y, EASE_IN);
        s.pic.x = lerp(s.pic.x, s.want.x, EASE_PIC);
        s.pic.y = lerp(s.pic.y, s.want.y, EASE_PIC);
        s.live.lit = lerp(s.live.lit, s.want.lit, t);
        // close enough that another frame would change nothing visible
        if (Math.abs(s.live.lit - s.want.lit) < 0.002 && s.want.lit === 0) {
          s.pic.x = s.want.x; s.pic.y = s.want.y;
          s.live.lit = 0;
          s.el.style.setProperty('--lit', '0');
          s.el.style.setProperty('--tx', '0px');
          s.el.style.setProperty('--ty', '0px');
          s.el.style.willChange = '';
          continue;
        }
        busy = true;
        s.el.style.setProperty('--lx', (s.live.x * s.w).toFixed(1) + 'px');
        s.el.style.setProperty('--ly', (s.live.y * s.h).toFixed(1) + 'px');
        s.el.style.setProperty('--lit', s.live.lit.toFixed(3));
        s.el.style.setProperty(
          '--tx', ((0.5 - s.pic.x) * SHIFT * s.live.lit).toFixed(2) + 'px');
        s.el.style.setProperty(
          '--ty', ((0.5 - s.pic.y) * SHIFT * s.live.lit).toFixed(2) + 'px');
      }
      if (busy) requestAnimationFrame(frame);
      else running = false;
    };
    const start = () => { if (!running) { running = true; requestAnimationFrame(frame); } };

    state.forEach((s) => {
      s.el.addEventListener('pointerenter', (e) => {
        const r = s.el.getBoundingClientRect();
        s.w = r.width; s.h = r.height;
        // the light starts where the cursor came in, not from the middle
        s.live.x = s.want.x = s.pic.x = (e.clientX - r.left) / r.width;
        s.live.y = s.want.y = s.pic.y = (e.clientY - r.top) / r.height;
        s.want.lit = 1;
        s.el.style.willChange = 'transform';
        start();
      });
      s.el.addEventListener('pointermove', (e) => {
        const r = s.el.getBoundingClientRect();
        s.w = r.width; s.h = r.height;
        s.want.x = (e.clientX - r.left) / r.width;
        s.want.y = (e.clientY - r.top) / r.height;
        start();
      });
      s.el.addEventListener('pointerleave', () => { s.want.lit = 0; start(); });
    });
  };

  /* =======================================================================
     9b. Fordele: the section arrives
     The heading and the row of cards get their own observers, so they cross
     their thresholds at two different points on the scroll rather than firing
     together. The hidden state is added here, never in the stylesheet, so a
     failed script leaves the section visible instead of blank.
     ======================================================================= */
  const fordeleReveal = () => {
    const targets = $$('#fordele .product-grid__intro, #fordele .product-grid__grid, ' +
      '.roi-calculator__form, .contact-card');
    if (!targets.length) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (!window.IntersectionObserver) return;

    document.documentElement.classList.add('js-reveal');
    // already past it on load (a deep link, a restored scroll): show it now
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        en.target.classList.add('is-in');
        io.unobserve(en.target);
      });
      /* The trigger line, not the viewport bottom.

       It has moved twice. It started at the viewport bottom, which Patrick said
       was "a little bit too early... you don't really get to enjoy that
       animation", so it went to -26% (the line at 74% of the viewport). With
       the entrance now running 1.05s and 1.45s instead of 0.85s, that same line
       made it "a little bit too late" - a slower entrance started later was
       finishing after the section had already gone by. -12% put the line at
       88% and overshot the other way - "it happens way too quickly, almost in
       an instant, and happens too early", which is one fault, not two: fired
       that low, the entrance is over before the section is comfortably on
       screen, so all that is left to see is the tail. -20% splits the two
       readings at 80%, and the durations go up again (1.3s and 1.9s). */
    /* Round 2b: -20% left the reader on a white screen ("you're already
       there while nothing is there"); the line is 6% up from the bottom edge
       now, so a block starts arriving as soon as it shows. */
    }, { threshold: 0.01, rootMargin: '0px 0px -6% 0px' });
    targets.forEach((el) => {
      if (el.getBoundingClientRect().top < innerHeight) el.classList.add('is-in');
      else io.observe(el);
    });

    /* The contact card used to be watched on its own line, 8% lower than the
       text, because a 666px card crossing the same line as a 200px paragraph
       always arrived last. The card is 520 wide and content-tall now and
       Patrick asked for it to come in later, not earlier: same line as the
       text, same observer. */
  };

  /* THE PANEL'S SIZE COMES FROM TWO PLACES.

     Its width is the grid's, exactly as Terminal sets it (six columns plus
     35px into the margin, so its right edge sits 18px from the screen's).
     Round two derived the width from the height instead, which on Patrick's
     short, wide window (about 1477 x 702) made a 462px panel sitting near the
     middle of the page: "too narrow... too close to the middle".

     Its height is the room under the nav, 130px short of the screen, but
     never less than 0.88 of its width, so a short window gets a panel that
     runs a little past the bottom rather than a small one. The sticky top
     centres it in the room under the nav (nav bottom 96) and never comes
     closer than 8px to the nav. */
  const stepsPanelSize = () => {
    const section = $('.features-steps');
    const panel = section && $('.svg-mask', section);
    if (!section || !panel) return;
    if (innerWidth < 1024) {
      section.style.removeProperty('--panel-h');
      section.style.removeProperty('--panel-top');
      return;
    }
    /* Round 2 (2026-09-07, points 4 and 6): Terminal's rule. The panel is
       centred in the window and never taller than 640; on a 721 window that
       is 593 tall with 104 above (under the nav) and 24 below, so the frame
       shows its bottom corners while pinned instead of running off the edge
       (measured: bottom = 721 = the edge). At 900 it is their 640 / 130. */
    const h = Math.min(640, innerHeight - 128);
    const top = Math.max(104, Math.round((innerHeight - h) / 2));
    section.style.setProperty('--panel-h', h + 'px');
    section.style.setProperty('--panel-top', top + 'px');
    /* The room after the last beat goes in the CONTENT column. The sticky
       range is the parent's content box, so round 1's padding on .inner
       extended nothing and only opened 396px of white under the panel
       (qa/w2-release.mjs: beat 4 at 495 of 721 when the panel let go).
       Beat 4's middle sits 10px below the midline at release (Patrick, round 2b:
       "closer to the middle, maybe slightly below"); its band closes 30px
       earlier (LAST_TAIL in the steps engine). */
    const beats = $$('.scroll-item', section);
    const last = beats[beats.length - 1];
    const b4 = last ? last.offsetHeight : 225;
    const room = Math.max(120, Math.round(top + h - innerHeight / 2 - 10 - b4 / 2));
    section.style.setProperty('--beat-room', room + 'px');
    if (window.ScrollTrigger && window.ScrollTrigger.refresh) window.ScrollTrigger.refresh();
  };

  const init = () => {
    setIntroHeight();
    stepsPanelSize();
    splitHeadline();
    loadNotches();
    anchors();
    if (document.fonts && document.fonts.ready) {
      // the webfont changes panel heights, and a notch clipped to the old height
      // cuts the bottom off the panel
      document.fonts.ready.then(() => {
        setIntroHeight();
        stepsPanelSize();
        applyNotches();
      });
    }
    // panels also change height when a step or a card opens
    if (window.ResizeObserver) {
      let pending = 0;
      const ro = new ResizeObserver(() => {
        cancelAnimationFrame(pending);
        pending = requestAnimationFrame(applyNotches);
      });
      $$('.svg-mask, .slot').forEach((el) => ro.observe(el));
    }

    // smooth scroll: Lenis at lerp 0.1. Measured on the live site — one wheel
    // impulse settles exponentially, ~40% of the remaining distance per ~85ms,
    // settle ~600ms => lerp ~0.095 ~ the library default. This single value is
    // the "smooth" the whole page hangs on.
    if (window.Lenis) {
      const lenis = new window.Lenis({ lerp: 0.1, smoothWheel: true });
      window.__lenis = lenis;
      if (gsap && ScrollTrigger) {
        lenis.on('scroll', ScrollTrigger.update);
        /* Round 2d: the footer follows Lenis's own scroll tick, not only the
           window's scroll event, so it moves on the same frame as the page in
           a real browser (measured in Chrome: it could trail by a frame or
           more, and the strip between runway and footer showed as a band). */
        lenis.on('scroll', () => { if (window.__layoutFooter) window.__layoutFooter(); });
        gsap.ticker.add((t) => lenis.raf(t * 1000));
        gsap.ticker.lagSmoothing(0);
      } else {
        const raf = (t) => { lenis.raf(t); requestAnimationFrame(raf); };
        requestAnimationFrame(raf);
      }
    }

    // native scroll fires whether Lenis is driving or not (Lenis scrolls the
    // window), so this one listener covers smooth, reduced-motion and the QA
    // harness that destroys Lenis to land on exact positions
    if (SEAM_SCRUB) addEventListener('scroll', paintSeams, { passive: true });
    paintSeams();

    boot();
    $$('.video-carousel .title-sequence').forEach(typeOnEnter);
    $$('.features-steps').forEach(stepsEngine);
    resolveTargets().forEach(readingResolve);
    heroExit();
    /* FAQ heading and kontakt heading: Patrick, looking at the deployed build,
       saw the reveal fade in late/unreliably and asked to drop it — solid from
       first paint instead. See replica.css for the matching static-colour
       override (their own CSS ships the <strong> in light grey, the pre-reveal
       colour these timelines used to animate away from). */
    fordeleCards();
    fordeleReveal();
    faqAccordion();
    textReveal($('.footer-title h1'), { end: '#ffffff' });
    formFieldsReveal();
    quoteLife();
    footerReveal();
    pathTraces();
    panelTraces();

    if (ScrollTrigger) ScrollTrigger.refresh();
  };

  if (document.readyState !== 'loading') init();
  else addEventListener('DOMContentLoaded', init);

  addEventListener('resize', () => {
    setIntroHeight();
    stepsPanelSize();
    applyNotches();
    paintSeams();
    // the trace geometry is baked in pixels, so it has to be regenerated
    pathTraces();
    panelTraces();
  });

  /* The QA harness turns smooth scroll off so anchored screenshots land on an
     exact scroll position instead of mid-glide. */
  window.__replicaStopScroll = () => window.__lenis && window.__lenis.destroy();
})();
