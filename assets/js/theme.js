/* AI Output Cleanup - light and dark mode switch.
   Loaded in the head, before the page is drawn, so a saved choice applies
   from the first frame instead of flashing the other theme. Kept separate
   from site.js because that one is deferred and would arrive too late.

   Without a saved choice the site follows the device setting through CSS
   alone. Clicking the switch saves "light" or "dark" on this device only;
   nothing is sent anywhere. */
(function () {
  'use strict';

  var KEY = 'aoc-theme';
  var root = document.documentElement;
  var media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  function saved() {
    try {
      var v = localStorage.getItem(KEY);
      return (v === 'light' || v === 'dark') ? v : null;
    } catch (e) {
      return null;
    }
  }

  function current() {
    return saved() || (media && media.matches ? 'dark' : 'light');
  }

  var choice = saved();
  if (choice) root.setAttribute('data-theme', choice);

  var SUN = '<svg class="icon icon--sm" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
    '<circle cx="12" cy="12" r="4"></circle>' +
    '<path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"></path></svg>';
  var MOON = '<svg class="icon icon--sm" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
    '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z"></path></svg>';

  var button;

  /* The icon shows where the click takes you, as on most sites: a moon in
     light mode, a sun in dark mode. */
  function render() {
    if (!button) return;
    var dark = current() === 'dark';
    button.innerHTML = dark ? SUN : MOON;
    button.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
    button.title = dark ? 'Light mode' : 'Dark mode';
  }

  function toggle() {
    var next = current() === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    try { localStorage.setItem(KEY, next); } catch (e) { /* still switches for this page */ }
    render();
  }

  function init() {
    var header = document.querySelector('.site-header__inner');
    if (!header) return;
    button = document.createElement('button');
    button.type = 'button';
    button.className = 'theme-toggle';
    button.addEventListener('click', toggle);
    header.appendChild(button);
    render();
  }

  /* Keeps the icon right if the device switches while the page is open and
     the visitor has not made a choice of their own. */
  if (media) {
    var onChange = function () { if (!saved()) render(); };
    if (media.addEventListener) media.addEventListener('change', onChange);
    else if (media.addListener) media.addListener(onChange);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
