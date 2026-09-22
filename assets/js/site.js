/* AI Output Cleanup — shared site script.
   Cookie consent, consent gated advertising, and small helpers reused by the
   tool pages. Everything here runs client side only. Nothing is uploaded. */
(function () {
  'use strict';

  /* ------------------------------------------------------------------------
     CONFIGURATION

     Paste your AdSense publisher ID here after approval, for example
     'ca-pub-1234567890123456'. While this is empty no advertising script is
     ever requested, which is the correct behaviour before approval.

     Each .ad-slot container also needs its own numeric unit ID from AdSense,
     added in the HTML as data-ad-slot-id="1234567890". Containers without one
     are left empty rather than filled with a broken unit.
     ------------------------------------------------------------------------ */
  var ADSENSE_CLIENT = '';

  /* ------------------------------------------------------------------------
     CLOUDFLARE WEB ANALYTICS

     Cookieless page counting. It sets no cookies and uses no local storage,
     so it needs no consent notice under the ePrivacy rules and does not weaken
     the "no cookies" position.

     Paste the token from the Cloudflare dashboard to switch it on (Analytics &
     Logs > Web Analytics > this site > Manage site, the "token" value inside
     the JS snippet). While it is empty, no analytics script is requested.

     Cloudflare's "automatic setup" does not inject the beacon into sites
     served by Workers static assets, which is why it is loaded here instead.
     The CSP in _headers must allow static.cloudflareinsights.com (script) and
     cloudflareinsights.com (data), or every beacon is silently blocked.
     ------------------------------------------------------------------------ */
  var CF_BEACON_TOKEN = '0530655a2819440d873293435f4f31c5';

  /* Only count traffic on the real domain, so local development and preview
     deployments never pollute the statistics. */
  var ANALYTICS_HOST = 'aicleanup.tools';

  var CONSENT_KEY = 'aoc-cookie-consent';
  var ACCEPTED = 'accepted';
  var DECLINED = 'declined';

  /* --- Google Consent Mode v2 ---------------------------------------------
     Signals are set to denied before any Google tag can run, so that if an
     advertising tag is ever loaded it starts from a refusal and is only
     upgraded when the visitor actually agrees. */
  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }

  gtag('consent', 'default', {
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    analytics_storage: 'denied',
    wait_for_update: 500
  });

  /* --- Stored choice ------------------------------------------------------- */
  function readConsent() {
    try {
      var v = localStorage.getItem(CONSENT_KEY);
      return (v === ACCEPTED || v === DECLINED) ? v : null;
    } catch (e) {
      /* Private mode or storage disabled. Treated as no choice made, which
         means no advertising loads. Failing closed is the safe direction. */
      return null;
    }
  }

  function writeConsent(value) {
    try { localStorage.setItem(CONSENT_KEY, value); } catch (e) { /* ignore */ }
  }

  /* --- Advertising --------------------------------------------------------
     The AdSense script is only ever requested after consent. Declining means
     the request is never made at all, so no advertising cookie can be set. */
  var adsRequested = false;

  function loadAds() {
    if (adsRequested) return;
    if (readConsent() !== ACCEPTED) return;
    if (!ADSENSE_CLIENT) return;   /* not configured yet */

    adsRequested = true;

    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' +
            encodeURIComponent(ADSENSE_CLIENT);
    s.crossOrigin = 'anonymous';
    document.head.appendChild(s);

    fillSlots();
  }

  function fillSlots() {
    var slots = document.querySelectorAll('.ad-slot[data-ad-slot-id]');
    for (var i = 0; i < slots.length; i++) {
      var slot = slots[i];
      if (slot.getAttribute('data-filled') === 'true') continue;
      slot.setAttribute('data-filled', 'true');

      var ins = document.createElement('ins');
      ins.className = 'adsbygoogle';
      ins.style.display = 'block';
      ins.setAttribute('data-ad-client', ADSENSE_CLIENT);
      ins.setAttribute('data-ad-slot', slot.getAttribute('data-ad-slot-id'));
      ins.setAttribute('data-full-width-responsive', 'true');
      slot.appendChild(ins);

      try {
        (window.adsbygoogle = window.adsbygoogle || []).push({});
      } catch (e) { /* the unit simply stays empty */ }
    }
  }

  /* --- Analytics ----------------------------------------------------------
     Deliberately not gated behind the cookie notice. The beacon stores
     nothing on the device, so there is no "access to information on a
     terminal device" to consent to. It runs on legitimate interests instead,
     which is stated in the privacy policy. */
  function doNotTrack() {
    var v = navigator.doNotTrack || window.doNotTrack || navigator.msDoNotTrack;
    return v === '1' || v === 'yes';
  }

  function loadAnalytics() {
    if (!CF_BEACON_TOKEN) return;
    if (location.hostname !== ANALYTICS_HOST) return;
    /* Cloudflare's beacon does not check Do Not Track itself, so it is
       honoured here: a visitor who asked not to be tracked is never counted. */
    if (doNotTrack()) return;

    var s = document.createElement('script');
    s.src = 'https://static.cloudflareinsights.com/beacon.min.js';
    /* Matches the snippet Cloudflare currently issues. */
    s.type = 'module';
    s.setAttribute('data-cf-beacon', JSON.stringify({ token: CF_BEACON_TOKEN }));
    document.head.appendChild(s);
  }

  /* --- Banner -------------------------------------------------------------- */
  var banner;

  function showBanner() { if (banner) banner.hidden = false; }
  function hideBanner() { if (banner) banner.hidden = true; }

  function choose(value) {
    var previous = readConsent();
    writeConsent(value);
    hideBanner();

    if (value === ACCEPTED) {
      gtag('consent', 'update', {
        ad_storage: 'granted',
        ad_user_data: 'granted',
        ad_personalization: 'granted'
      });
      loadAds();
      return;
    }

    /* Withdrawing consent after previously accepting: the advertising script
       is already in the page and cannot be unloaded, so reload to a state
       where it was never requested. */
    if (previous === ACCEPTED && adsRequested) {
      window.location.reload();
    }
  }

  function initBanner() {
    banner = document.getElementById('cookie-banner');
    if (!banner) return;

    /* No publisher ID means no advertising, which means no non-essential
       cookies exist to consent to. Asking anyway would be a consent prompt
       for nothing, so the notice stays hidden until advertising is switched
       on. The markup stays in the page, ready. */
    if (!ADSENSE_CLIENT) return;

    var accept = document.getElementById('cookie-accept');
    var decline = document.getElementById('cookie-decline');
    if (accept) accept.addEventListener('click', function () { choose(ACCEPTED); });
    if (decline) decline.addEventListener('click', function () { choose(DECLINED); });

    if (readConsent() === null) showBanner();
  }

  /* Withdrawing consent has to be as easy as giving it, so every page gets a
     way back to the choice. Injected rather than repeated in eight files. */
  function initConsentLink() {
    var list = document.querySelector('.footer-cols nav[aria-labelledby="footer-site"] ul');
    if (!list || !document.getElementById('cookie-banner')) return;
    /* Nothing to reopen while there is no advertising to consent to. */
    if (!ADSENSE_CLIENT) return;

    var li = document.createElement('li');
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'linklike';
    btn.id = 'cookie-settings';
    btn.textContent = 'Cookie settings';
    btn.addEventListener('click', function () {
      showBanner();
      banner.scrollIntoView({ block: 'nearest' });
      var first = document.getElementById('cookie-decline');
      if (first) first.focus();
    });
    li.appendChild(btn);
    list.appendChild(li);
  }

  /* --- Clipboard ----------------------------------------------------------
     Returns a promise. Falls back to a hidden textarea where the async
     Clipboard API is unavailable (older Safari, non secure contexts). */
  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy') ? resolve() : reject(new Error('copy failed'));
      } catch (err) {
        reject(err);
      } finally {
        document.body.removeChild(ta);
      }
    });
  }

  function flashStatus(el, message, isError) {
    if (!el) return;
    el.textContent = message;
    el.classList.toggle('status--error', !!isError);
  }

  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  /* Reveals the "next step" suggestion, once, after the visitor has actually
     succeeded at what they came to do. Deliberately not shown on page load:
     someone who has not finished does not need to be sold another tool. */
  function revealNextStep() {
    var el = document.getElementById('next-step');
    if (el) el.hidden = false;
  }

  function initYear() {
    var el = document.getElementById('year');
    if (el) el.textContent = String(new Date().getFullYear());
  }

  function init() {
    loadAnalytics();
    initBanner();
    initConsentLink();
    initYear();
    /* Returning visitors who already accepted get their ads without being
       asked again. */
    loadAds();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.AOC = {
    copyText: copyText,
    flashStatus: flashStatus,
    downloadBlob: downloadBlob,
    revealNextStep: revealNextStep,
    consent: {
      get: readConsent,
      set: choose,
      open: showBanner,
      /* Lets the publisher ID be supplied at runtime instead of edited into
         this file, which is also how the consent gate is tested. */
      configure: function (client) {
        ADSENSE_CLIENT = client || '';
        loadAds();
      },
      adsRequested: function () { return adsRequested; }
    }
  };
})();
