/* Em Dash Remover. All processing is local to this page.
   There are no network calls anywhere in this file. */
(function () {
  'use strict';

  /* --- Character classes ---------------------------------------------------
     Built from code points rather than written as literals. Half of these
     characters are invisible, so a literal regex would be a line of blank
     space that nobody could read, diff or safely edit. */

  function chr(code) { return String.fromCharCode(code); }

  /* Builds a character class. A nested array is treated as a range. */
  function charClass(codes) {
    var body = '';
    for (var i = 0; i < codes.length; i++) {
      body += (codes[i] instanceof Array)
        ? chr(codes[i][0]) + '-' + chr(codes[i][1])
        : chr(codes[i]);
    }
    return new RegExp('[' + body + ']', 'g');
  }

  var EM = 0x2014;   /* em dash */
  var EN = 0x2013;   /* en dash */

  var EM_DASH = new RegExp(chr(EM), 'g');
  var EN_DASH = new RegExp(chr(EN), 'g');

  /* One or more em dashes, plus any spaces or tabs hugging them.
     Deliberately [ \t] and not \s: a dash at the end of a line must not be
     able to swallow the newline and weld two lines together. */
  var EM_DASH_RUN = new RegExp('([ \\t]*)' + chr(EM) + '+([ \\t]*)', 'g');
  var EN_DASH_RUN = new RegExp(chr(EN) + '+', 'g');

  /* Curly single and double quotes, including the low and reversed variants
     that turn up in text pasted out of Word. */
  var SMART_QUOTES = charClass([
    0x2018, 0x2019, 0x201A, 0x201B,   /* single: left, right, low, reversed */
    0x201C, 0x201D, 0x201E, 0x201F    /* double: left, right, low, reversed */
  ]);

  /* Zero width and formatting characters: ZWSP, ZWNJ, ZWJ, word joiner, BOM,
     soft hyphen, and the LTR/RTL marks. These render as nothing at all, which
     is exactly why they are worth surfacing to the user. */
  var INVISIBLE = charClass([
    0x200B, 0x200C, 0x200D, 0x2060, 0xFEFF, 0x00AD, 0x200E, 0x200F
  ]);

  /* Spaces that are not a plain space: non breaking space, the quad family,
     narrow and medium maths spaces, ideographic space. */
  var ODD_SPACES = charClass([
    0x00A0, [0x2000, 0x200A], 0x202F, 0x205F, 0x3000
  ]);

  /* U+201C and U+201D are the curly double pair, U+201E and U+201F their low
     and reversed variants. Everything else in SMART_QUOTES is a single. */
  var DOUBLE_QUOTES = chr(0x201C) + chr(0x201D) + chr(0x201E) + chr(0x201F);

  function smartQuoteToStraight(ch) {
    return DOUBLE_QUOTES.indexOf(ch) !== -1 ? '"' : "'";
  }

  /* --- Counting ------------------------------------------------------------
     Counts describe the pasted text, not the result, so the numbers stay
     steady while the user toggles options on and off. */
  function countMatches(text, re) {
    var m = text.match(re);
    return m ? m.length : 0;
  }

  function analyse(text) {
    return {
      emDashes: countMatches(text, EM_DASH),
      enDashes: countMatches(text, EN_DASH),
      smartQuotes: countMatches(text, SMART_QUOTES),
      invisible: countMatches(text, INVISIBLE) + countMatches(text, ODD_SPACES)
    };
  }

  /* --- Cleaning ------------------------------------------------------------ */
  function clean(text, opts) {
    var out = text;

    /* 1. Em dashes, according to the chosen mode. */
    if (opts.emDash === 'comma') {
      /* "fast<em>simple" and "fast <em> simple" both become "fast, simple".
         A dash sitting straight after other punctuation would produce ", ,"
         so the punctuation already there wins instead. */
      out = out.replace(EM_DASH_RUN, function (match, before, after, offset, whole) {
        var prev = whole.charAt(offset - 1);
        if (prev === ',' || prev === ';' || prev === ':') return ' ';
        return ', ';
      });
    } else if (opts.emDash === 'hyphen') {
      /* Spacing is preserved in spirit: a spaced dash stays spaced. */
      out = out.replace(EM_DASH_RUN, function (match, before, after) {
        return (before || after) ? ' - ' : '-';
      });
    } else if (opts.emDash === 'remove') {
      /* A single space is left behind on purpose. Deleting the dash outright
         would weld the words on either side of it together. */
      out = out.replace(EM_DASH_RUN, ' ');
    }

    /* 2. En dashes, normally used for ranges such as 10-20. */
    if (opts.enDash) out = out.replace(EN_DASH_RUN, '-');

    /* 3. Curly quotes to straight. */
    if (opts.smartQuotes) out = out.replace(SMART_QUOTES, smartQuoteToStraight);

    /* 4. Invisible characters: formatting marks go, odd spaces become plain. */
    if (opts.invisible) {
      out = out.replace(INVISIBLE, '').replace(ODD_SPACES, ' ');
    }

    /* 5. Tidy spacing. Runs of spaces collapse and line ends are trimmed, but
          blank lines between paragraphs are left alone. */
    if (opts.collapse) out = out.replace(/[ \t]{2,}/g, ' ');
    out = out.replace(/[ \t]+$/gm, '');

    return out;
  }

  /* --- Counter wording ----------------------------------------------------- */
  function plural(n, singular, pluralForm) {
    return n + ' ' + (n === 1 ? singular : pluralForm);
  }

  function describe(counts, hasText) {
    if (!hasText) return { text: '', found: false };

    var parts = [];
    if (counts.emDashes)    parts.push(plural(counts.emDashes, 'em dash', 'em dashes'));
    if (counts.enDashes)    parts.push(plural(counts.enDashes, 'en dash', 'en dashes'));
    if (counts.smartQuotes) parts.push(plural(counts.smartQuotes, 'smart quote', 'smart quotes'));
    if (counts.invisible)   parts.push(plural(counts.invisible, 'invisible character', 'invisible characters'));

    if (!parts.length) {
      return {
        text: 'No em dashes, smart quotes or hidden characters found. This text is already clean.',
        found: false
      };
    }
    return { text: 'Found ' + parts.join(', ') + '.', found: true };
  }

  /* --- Wiring -------------------------------------------------------------- */
  var input, output, counter, counterText, copyBtn, clearBtn;

  function readOptions() {
    var mode = document.querySelector('input[name="emdash"]:checked');
    return {
      emDash: mode ? mode.value : 'comma',
      smartQuotes: document.getElementById('opt-quotes').checked,
      enDash: document.getElementById('opt-endash').checked,
      invisible: document.getElementById('opt-invisible').checked,
      collapse: document.getElementById('opt-spaces').checked
    };
  }

  function run() {
    var text = input.value;
    output.value = text ? clean(text, readOptions()) : '';

    var result = describe(analyse(text), text.length > 0);
    counterText.textContent = result.text ||
      'Paste your text above and a count of what needs cleaning appears here.';
    counter.classList.toggle('counter--found', result.found);

    copyBtn.disabled = !output.value;
  }

  var COPY_ICON = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">' +
    '<rect x="9" y="9" width="12" height="12" rx="2"></rect>' +
    '<path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"></path></svg>';
  var DONE_ICON = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">' +
    '<path d="m5 13 4 4L19 7"></path></svg>';
  var copyTimer;

  function setCopyLabel(icon, label, done) {
    copyBtn.innerHTML = icon + '<span>' + label + '</span>';
    copyBtn.classList.toggle('is-done', !!done);
  }

  function handleCopy() {
    if (!output.value) return;
    window.AOC.copyText(output.value).then(function () {
      /* Copy has no direction, so it confirms with a state swap rather than
         a moving icon. */
      setCopyLabel(DONE_ICON, 'Copied', true);
      window.AOC.revealNextStep();
      clearTimeout(copyTimer);
      copyTimer = setTimeout(function () {
        setCopyLabel(COPY_ICON, 'Copy cleaned text', false);
      }, 1900);
    })['catch'](function () {
      /* Clipboard access can be refused (permissions, an unfocused document,
         an insecure origin). Select the text so the suggested shortcut is
         actually true rather than just telling the user bad news. */
      output.focus();
      output.select();
      setCopyLabel(COPY_ICON, 'Press Ctrl+C to copy', false);
    });
  }

  function handleClear() {
    input.value = '';
    run();
    input.focus();
  }

  function init() {
    input = document.getElementById('input');
    output = document.getElementById('output');
    counter = document.getElementById('counter');
    counterText = document.getElementById('counter-text');
    copyBtn = document.getElementById('copy');
    clearBtn = document.getElementById('clear');
    if (!input) return;

    input.addEventListener('input', run);
    Array.prototype.forEach.call(
      document.querySelectorAll('.opt input'),
      function (el) { el.addEventListener('change', run); }
    );
    copyBtn.addEventListener('click', handleCopy);
    clearBtn.addEventListener('click', handleClear);

    run();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  /* Exposed so the behaviour can be exercised directly. Harmless otherwise. */
  window.AOC_EMDASH = { clean: clean, analyse: analyse, describe: describe };
})();
