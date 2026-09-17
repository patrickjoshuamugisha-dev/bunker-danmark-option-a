/* ---------------------------------------------------------------------------
   interactions.js — the clickable parts of the page.

   Same rule as app.js: their CSS already contains every state. This only sets
   the classes and values their Vue components set.
--------------------------------------------------------------------------- */
(() => {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  /* =======================================================================
     Gone from this build, and why — both were real code that now has nothing
     to run against:

     1. The ROI calculator. Their savings panel became the mid-page CTA, so
        there are no inputs and no computed numbers. Left in, it wrote its own
        total over "125.000" the moment the page loaded.
     2. The platform carousel. The four-tab section was cut — it re-told the
        Bunkeren steps one screen later.

     The originals are in git history if either slot ever comes back.
     ======================================================================= */

  /* =======================================================================
     3. FAQ
     The accordion is native <details>/<summary>, so open/close already works
     with no JS — only one item at a time is theirs, and the category tabs
     switch the active pill.

     Known gap, stated rather than faked: the SSR document only carries the
     items for the first category. Their app fetches the other three from the
     CMS, so the other tabs re-render the same list here.
     ======================================================================= */
  const faq = () => {
    const section = $('.tabbed-accordion');
    if (!section) return;

    $$('.tab-button', section).forEach((btn, _i, all) => {
      btn.addEventListener('click', () => {
        all.forEach((b) => b.classList.toggle('tab-button--active', b === btn));
      });
    });
    /* Items stay open. The toggle listener that closed every other item lived
       here and fought app.js faqAccordion (which animates the open); with both
       running, opening one answer snapped the last one shut. Patrick: they
       should stay open. Deleted 2026-09-03. */
  };

  /* =======================================================================
     4. forms

     Nothing is sent anywhere — the address check needs the DAWA lookup and the
     lead mail to mst@fineas.io, neither of which is built yet. So a submit says
     exactly that rather than faking a verdict. Wording is the line Magnus
     already saw on the first preview, kept word for word.
     ======================================================================= */
  /* Reads as information with a way forward, not as a failure. The previous
     wording sat under the field as a flat grey sentence with nothing to do
     next, which is what Patrick meant by "it's not really an error message
     ... it does not make sense". */
  const DEMO_NOTE =
    'Adressetjekket er ikke koblet til endnu. ' +
    '<a href="#kontakt">Skriv til os her</a>, så ser vi på din grund.';
  /* The contact form's own line. The generic toast below writes textContent,
     so the hero note's <a> came out as raw HTML there, and its wording sent
     people to #kontakt from inside #kontakt. Plain text, and it says what is
     true of this form. */
  const FORM_NOTE = 'Formularen er ikke koblet til endnu. Den sender til Bunker Danmark inden lancering.';

  /* =======================================================================
     4b. the hero address check

     Patrick, on the old behaviour: "you can click, but nothing happens". That
     was half true. It did fire the generic handler below, but that handler
     drops a toast at the BOTTOM of the screen, roughly 700px from the button
     being clicked, so nothing happened anywhere the eye was.

     It is also not a scroll button and must not become one: it is the primary
     CTA and its job is to hand the address to Magnus's automation. So it is
     built as the real thing — validate, pending, post, done or fail — with the
     endpoint as one constant. When the automation exists, LEAD_ENDPOINT is the
     only line that changes.

     Until then the request fails on purpose and the fallback says plainly that
     the check is not connected. It never invents a verdict and never claims to
     have received an address it did not send.
     ======================================================================= */
  /* Walkthrough 2026-09-05 (D9): Web3Forms. Free, no account; the access key
     is issued to mst@fineas.io, so Magnus owns the delivery. Until Patrick
     pastes the key here both forms say, truthfully, that they are not
     connected. LEAD_KEY is the one line that changes at launch. */
  const LEAD_ENDPOINT = 'https://api.web3forms.com/submit';
  const LEAD_KEY = ''; // launch blocker: the Web3Forms access key from Magnus's mail
  const leadPayload = (fields) => JSON.stringify({
    access_key: LEAD_KEY,
    subject: 'Ny henvendelse fra Bunker Danmark-siden',
    from_name: 'Bunker Danmark',
    ...fields,
    page: location.href,
  });
  const sendLead = async (fields) => {
    if (!LEAD_KEY) throw new Error('LEAD_KEY is not set');
    const res = await fetch(LEAD_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: leadPayload(fields),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json().catch(() => ({}));
    if (data.success === false) throw new Error(data.message || 'rejected');
  };
  const DONE_NOTE = 'Tak. Vi ser på din grund og vender tilbage inden for et par dage.';
  const FAIL_NOTE = 'Noget gik galt. Ring til os på +45 12 34 56 78, eller prøv igen om lidt.';

  const heroCheck = () => {
    const form = $('.hero-check');
    if (!form) return;
    const input = $('input', form);
    const button = $('button', form);
    if (!input || !button) return;

    const status = document.createElement('p');
    status.className = 'hero-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    form.insertAdjacentElement('afterend', status);

    const copyBlock = form.closest('.hero-copy');
    const idleLabel = button.textContent;

    /* One place decides what the whole block looks like in a given state.

       The state also lands on .hero-copy, because of a contradiction Patrick
       caught: the small line under the field promises "din vurdering vises med
       det samme", and the old code left it sitting directly beneath a message
       saying the check was not connected. Two lines, opposite claims, stacked.
       Any state with something to say now hides that promise. */
    const set = (state, msg) => {
      if (state) {
        button.dataset.state = state;
        copyBlock && (copyBlock.dataset.check = state);
      } else {
        delete button.dataset.state;
        copyBlock && delete copyBlock.dataset.check;
      }
      // only a user mistake marks the field; a missing endpoint is ours, not theirs
      form.dataset.error = state === 'error' ? '1' : '';
      status.innerHTML = msg || '';
    };

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const address = input.value.trim();
      if (address.length < 5) {
        set('error', 'Skriv din adresse først.');
        input.focus();
        return;
      }

      set('pending', 'Sender din adresse.');
      button.textContent = 'SENDER';

      try {
        await sendLead({ adresse: address, source: 'hero' });
        set('done', DONE_NOTE);
        button.textContent = 'MODTAGET';
        input.readOnly = true;
      } catch (err) {
        console.warn('[hero-check] not sent:', err.message);
        if (!LEAD_KEY) { set('note', DEMO_NOTE); }
        else { set('error', FAIL_NOTE); }
        button.textContent = idleLabel;
      }
    });

    // typing again clears whatever the last attempt left on screen
    input.addEventListener('input', () => {
      if (button.dataset.state) {
        set('', '');
        button.textContent = idleLabel;
      }
    });
  };

  const forms = () => {
    let toast = null;
    let timer = null;
    const say = (msg) => {
      if (!toast) {
        toast = document.createElement('div');
        toast.className = 'demo-toast';
        toast.setAttribute('role', 'status');
        document.body.appendChild(toast);
      }
      toast.textContent = msg;
      toast.classList.add('is-on');
      clearTimeout(timer);
      timer = setTimeout(() => toast.classList.remove('is-on'), 3600);
    };

    /* the contact form (section 4): validate, pending, post, done or fail,
       same shape as the hero check. Walkthrough 2026-09-05, Task 10. */
    const contact = $('.contact-form');
    if (contact) {
      const button = $('.cf-send', contact);
      const label = button && $('span', button);
      const idle = label ? label.textContent : '';
      const status = document.createElement('p');
      status.className = 'cf-status';
      status.setAttribute('role', 'status');
      status.setAttribute('aria-live', 'polite');
      contact.appendChild(status);
      const say = (state, msg) => {
        if (button) { if (state) button.dataset.state = state; else delete button.dataset.state; }
        status.textContent = msg || '';
      };
      contact.addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = (n) => (contact.elements[n] ? contact.elements[n].value.trim() : '');
        if (contact.elements.botcheck && contact.elements.botcheck.checked) return; // a bot filled the honeypot
        const email = $('input[type="email"]', contact);
        if (f('adresse').length < 5) { say('error', 'Skriv adressen på grunden først.'); $('#cf-adresse').focus(); return; }
        if (f('navn').length < 2) { say('error', 'Skriv dit navn.'); $('#cf-navn').focus(); return; }
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f('email'))) { say('error', 'Skriv en e-mail, vi kan svare på.'); email && email.setAttribute('aria-invalid', 'true'); email && email.focus(); return; }
        say('pending', 'Sender.');
        if (label) label.textContent = 'Sender';
        try {
          await sendLead({ adresse: f('adresse'), navn: f('navn'), telefon: f('telefon'), email: f('email'), source: 'kontakt' });
          say('done', DONE_NOTE);
          if (label) label.textContent = 'Modtaget';
          $$('input', contact).forEach((i) => { i.readOnly = true; });
        } catch (err) {
          console.warn('[contact-form] not sent:', err.message);
          say(LEAD_KEY ? 'error' : 'note', LEAD_KEY ? FAIL_NOTE : FORM_NOTE);
          if (label) label.textContent = idle;
        }
      });
      $$('input', contact).forEach((i) => i.addEventListener('input', () => { i.removeAttribute('aria-invalid'); if (button && button.dataset.state && button.dataset.state !== 'done') say('', ''); }));
    }

    // the hero check owns its own submit (4b), the contact form its own (above); this is for the rest
    $$('form:not(.hero-check):not(.contact-form)').forEach((form) => {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        // keep their invalid state working where there is an email field
        const email = $('input[type="email"], input[name*="mail"]', form);
        if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.value)) {
          email.setAttribute('aria-invalid', 'true');
          return;
        }
        say(FORM_NOTE);
      });
      $$('input', form).forEach((i) =>
        i.addEventListener('input', () => i.removeAttribute('aria-invalid'))
      );
    });
  };

  /* =======================================================================
     5. nav dropdowns
     Hover/focus opens the mega-panel; their CSS holds the panel styling.
     ======================================================================= */
  const nav = () => {
    const header = $('.site-header');
    if (!header) return;
    $$('.dropdown-tab, [class*="nav-item"], .site-header li', header).forEach((item) => {
      const panel = $('.dropdown, [class*="dropdown"], [class*="mega"]', item);
      if (!panel) return;
      const open = (on) => {
        item.classList.toggle('is-active', on);
        item.classList.toggle('is-open', on);
      };
      item.addEventListener('mouseenter', () => open(true));
      item.addEventListener('mouseleave', () => open(false));
      item.addEventListener('focusin', () => open(true));
      item.addEventListener('focusout', () => open(false));
    });
  };

  /* v11: the nav pill sits translucent over the hero and solidifies once the
     page has moved, so it never floats as a grey slab over light sections. */
  const navScrollState = () => {
    const onScroll = () => {
      document.body.classList.toggle('is-scrolled', window.scrollY > 40);
    };
    onScroll();
    addEventListener('scroll', onScroll, { passive: true });
  };

  /* The mobile menu shipped inert: Terminal's Vue component owned the toggle, so
     the static copy had a burger that did nothing and a drawer parked off-screen
     at translateX(100%). Their own CSS already styles `.mobile-menu.is-open`, so
     this only has to flip the class and keep the a11y state honest. */
  const mobileMenu = () => {
    const btn = document.querySelector('.toggle-mobile-menu-button');
    const menu = document.querySelector('.mobile-menu');
    const drawer = document.querySelector('#mobile-menu');
    if (!btn || !menu) return;

    const setOpen = (on) => {
      menu.classList.toggle('is-open', on);
      btn.setAttribute('aria-expanded', String(on));
      if (drawer) drawer.setAttribute('aria-hidden', String(!on));
      document.body.style.overflow = on ? 'hidden' : '';
    };

    setOpen(false);
    btn.addEventListener('click', () => setOpen(!menu.classList.contains('is-open')));
    menu.addEventListener('click', (e) => {
      if (e.target.closest('a')) setOpen(false);
    });
    addEventListener('keydown', (e) => {
      if (e.key === 'Escape') setOpen(false);
    });
  };

  const init = () => {
    faq();
    heroCheck();
    forms();
    nav();
    navScrollState();
    mobileMenu();
  };
  if (document.readyState !== 'loading') init();
  else addEventListener('DOMContentLoaded', init);
})();
