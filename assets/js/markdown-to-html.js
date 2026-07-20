/* Markdown to HTML. Parsing and serialising happen in this browser.
   Nothing is uploaded. */
(function () {
  'use strict';

  /* ==========================================================================
     Optional clean up, applied before parsing
     ========================================================================== */

  function chr(code) { return String.fromCharCode(code); }

  var EM_DASH_RUN = new RegExp('([ \\t]*)' + chr(0x2014) + '+([ \\t]*)', 'g');
  var SMART_QUOTES = new RegExp('[' +
    chr(0x2018) + chr(0x2019) + chr(0x201A) + chr(0x201B) +
    chr(0x201C) + chr(0x201D) + chr(0x201E) + chr(0x201F) + ']', 'g');
  var DOUBLE_QUOTES = chr(0x201C) + chr(0x201D) + chr(0x201E) + chr(0x201F);

  function range(a, b) {
    return String.fromCodePoint(a) + '-' + String.fromCodePoint(b);
  }
  var EMOJI = new RegExp('[' +
    range(0x1F000, 0x1FAFF) +
    range(0x2600, 0x27BF) +
    range(0x2B00, 0x2BFF) +
    range(0xFE00, 0xFE0F) +
    String.fromCodePoint(0x20E3) +
    String.fromCodePoint(0x200D) +
    ']', 'gu');

  function preprocess(text, opts) {
    var out = text;
    if (opts.emDash) {
      out = out.replace(EM_DASH_RUN, function (m, before, after, offset, whole) {
        var prev = whole.charAt(offset - 1);
        if (prev === ',' || prev === ';' || prev === ':') return ' ';
        return ', ';
      });
    }
    if (opts.smartQuotes) {
      out = out.replace(SMART_QUOTES, function (ch) {
        return DOUBLE_QUOTES.indexOf(ch) !== -1 ? '"' : "'";
      });
    }
    if (opts.emoji) {
      out = out.replace(EMOJI, '')
               .replace(/[ \t]{2,}/g, ' ')
               .replace(/[ \t]+([,.;:!?])/g, '$1')
               .replace(/[ \t]+$/gm, '');
    }
    return out;
  }

  /* ==========================================================================
     Escaping

     Every piece of text that came from the user is escaped before it reaches
     the output. This is what stops a pasted <script> tag becoming a real one,
     and it is also simply correct: an ampersand in prose must be &amp;.
     ========================================================================== */

  function escapeText(s) {
    return s.replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
  }

  /* Attribute values additionally need quotes neutralised, or a crafted URL
     could break out of the attribute and add its own. */
  function escapeAttr(s) {
    return escapeText(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* Only these schemes become clickable. A pasted javascript: or data: URL is
     rendered as plain text instead of a working link. */
  function safeHref(url) {
    return /^(https?:|mailto:|tel:|#|\/|\.\/|\.\.\/)/i.test(url.trim()) ? url.trim() : null;
  }

  /* ==========================================================================
     Inline parsing
     ========================================================================== */

  var INLINE_PATTERNS = [
    { type: 'code',   re: /`([^`]+)`/ },
    { type: 'image',  re: /!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/ },
    { type: 'link',   re: /\[([^\]]*)\]\(([^)\s]+)[^)]*\)/ },
    { type: 'bi',     re: /\*\*\*([\s\S]+?)\*\*\*/ },
    { type: 'bold',   re: /\*\*([\s\S]+?)\*\*/ },
    { type: 'bold',   re: /__([\s\S]+?)__/ },
    { type: 'strike', re: /~~([\s\S]+?)~~/ },
    { type: 'italic', re: /\*([^*\n]+)\*/ },
    /* Underscore italics only at word boundaries, so snake_case survives. */
    { type: 'italic', re: /(?:^|(?<=[^\w`]))_([^_\n]+)_(?!\w)/ }
  ];

  function findFirst(text) {
    var best = null;
    for (var i = 0; i < INLINE_PATTERNS.length; i++) {
      var m = INLINE_PATTERNS[i].re.exec(text);
      if (m && (best === null || m.index < best.index)) {
        best = {
          index: m.index,
          length: m[0].length,
          type: INLINE_PATTERNS[i].type,
          content: m[1],
          url: m[2] || ''
        };
      }
    }
    return best;
  }

  /* Returns an HTML string. Text is escaped as it is emitted, never after,
     so generated tags can never be escaped by accident. */
  function inlineToHtml(text, opts) {
    var out = '';

    while (text.length) {
      var hit = findFirst(text);
      if (!hit) { out += escapeText(text); break; }
      if (hit.index > 0) out += escapeText(text.slice(0, hit.index));

      if (hit.type === 'code') {
        out += '<code>' + escapeText(hit.content) + '</code>';

      } else if (hit.type === 'image') {
        var src = safeHref(hit.url);
        out += src
          ? '<img src="' + escapeAttr(src) + '" alt="' + escapeAttr(hit.content) + '">'
          : escapeText(hit.content);

      } else if (hit.type === 'link') {
        var href = safeHref(hit.url);
        if (href) {
          var external = /^https?:/i.test(href);
          var attrs = ' href="' + escapeAttr(href) + '"';
          if (opts.newTab && external) attrs += ' target="_blank" rel="noopener"';
          out += '<a' + attrs + '>' + inlineToHtml(hit.content, opts) + '</a>';
        } else {
          /* Unsafe scheme: keep the words, drop the link. */
          out += inlineToHtml(hit.content, opts);
        }

      } else if (hit.type === 'bi') {
        out += '<strong><em>' + inlineToHtml(hit.content, opts) + '</em></strong>';
      } else if (hit.type === 'bold') {
        out += '<strong>' + inlineToHtml(hit.content, opts) + '</strong>';
      } else if (hit.type === 'italic') {
        out += '<em>' + inlineToHtml(hit.content, opts) + '</em>';
      } else if (hit.type === 'strike') {
        out += '<del>' + inlineToHtml(hit.content, opts) + '</del>';
      }

      text = text.slice(hit.index + hit.length);
    }
    return out;
  }

  /* ==========================================================================
     Block parsing
     ========================================================================== */

  function splitCells(line) {
    var cells = [];
    var cur = '';
    var i = 0;
    while (i < line.length) {
      var ch = line.charAt(i);
      if (ch === '\\' && line.charAt(i + 1) === '|') { cur += '|'; i += 2; }
      else if (ch === '|') { cells.push(cur); cur = ''; i += 1; }
      else { cur += ch; i += 1; }
    }
    cells.push(cur);
    var t = line.trim();
    if (cells.length > 1 && t.charAt(0) === '|') cells.shift();
    if (cells.length > 1 && t.charAt(t.length - 1) === '|' && t.charAt(t.length - 2) !== '\\') cells.pop();
    return cells.map(function (c) { return c.trim(); });
  }

  function isTableSeparator(line) {
    if (!line || line.indexOf('-') === -1) return false;
    var cells = splitCells(line);
    if (!cells.length) return false;
    for (var i = 0; i < cells.length; i++) {
      if (!/^:?-+:?$/.test(cells[i])) return false;
    }
    return true;
  }

  function alignOf(cell) {
    var c = cell.trim();
    var l = c.charAt(0) === ':';
    var r = c.charAt(c.length - 1) === ':';
    if (l && r) return 'center';
    if (r) return 'right';
    if (l) return 'left';
    return '';
  }

  var RE_HEADING = /^(#{1,6})\s+(.*)$/;
  var RE_BULLET  = /^(\s*)[-*+]\s+(.*)$/;
  var RE_ORDERED = /^(\s*)\d+[.)]\s+(.*)$/;
  var RE_QUOTE   = /^\s*>\s?(.*)$/;
  var RE_FENCE   = /^\s*```(.*)$/;
  var RE_HR      = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/;

  function startsNewBlock(line) {
    return line.trim() === '' ||
      RE_HEADING.test(line) || RE_BULLET.test(line) || RE_ORDERED.test(line) ||
      RE_QUOTE.test(line) || RE_FENCE.test(line) || RE_HR.test(line);
  }

  function parseBlocks(text) {
    var lines = String(text).split(/\r?\n/);
    var blocks = [];
    var i = 0;

    while (i < lines.length) {
      var line = lines[i];
      if (line.trim() === '') { i += 1; continue; }

      var fence = RE_FENCE.exec(line);
      if (fence) {
        var lang = fence[1].trim();
        var buf = [];
        i += 1;
        while (i < lines.length && !RE_FENCE.test(lines[i])) { buf.push(lines[i]); i += 1; }
        i += 1;
        blocks.push({ type: 'code', lang: lang, text: buf.join('\n') });
        continue;
      }

      if (line.indexOf('|') !== -1 && isTableSeparator(lines[i + 1])) {
        var header = splitCells(line);
        var align = splitCells(lines[i + 1]).map(alignOf);
        var rows = [];
        var j = i + 2;
        while (j < lines.length && lines[j].trim() !== '' &&
               lines[j].indexOf('|') !== -1 && !isTableSeparator(lines[j])) {
          rows.push(splitCells(lines[j]));
          j += 1;
        }
        blocks.push({ type: 'table', header: header, align: align, rows: rows });
        i = j;
        continue;
      }

      if (RE_HR.test(line)) { blocks.push({ type: 'hr' }); i += 1; continue; }

      var heading = RE_HEADING.exec(line);
      if (heading) {
        blocks.push({ type: 'heading', level: heading[1].length, text: heading[2].trim() });
        i += 1;
        continue;
      }

      if (RE_QUOTE.test(line)) {
        var q = [];
        while (i < lines.length && RE_QUOTE.test(lines[i])) {
          q.push(RE_QUOTE.exec(lines[i])[1]);
          i += 1;
        }
        blocks.push({ type: 'quote', text: q.join(' ').trim() });
        continue;
      }

      if (RE_BULLET.test(line) || RE_ORDERED.test(line)) {
        var ordered = RE_ORDERED.test(line);
        var items = [];
        while (i < lines.length) {
          var m = ordered ? RE_ORDERED.exec(lines[i]) : RE_BULLET.exec(lines[i]);
          if (!m) break;
          var indent = m[1].replace(/\t/g, '  ').length;
          items.push({ level: Math.min(Math.floor(indent / 2), 1), text: m[2].trim() });
          i += 1;
        }
        blocks.push({ type: 'list', ordered: ordered, items: items });
        continue;
      }

      var p = [line];
      i += 1;
      while (i < lines.length && !startsNewBlock(lines[i]) &&
             !(lines[i].indexOf('|') !== -1 && isTableSeparator(lines[i + 1]))) {
        p.push(lines[i]);
        i += 1;
      }
      blocks.push({ type: 'paragraph', text: p.join(' ').trim() });
    }

    return blocks;
  }

  /* ==========================================================================
     Serialising to HTML
     ========================================================================== */

  var IND = '  ';

  function pad(n) {
    var s = '';
    for (var i = 0; i < n; i++) s += IND;
    return s;
  }

  function listToHtml(block, opts, depth) {
    var tag = block.ordered ? 'ol' : 'ul';
    var out = pad(depth) + '<' + tag + '>\n';
    var i = 0;

    while (i < block.items.length) {
      var item = block.items[i];

      if (item.level === 0) {
        /* Collect any nested items belonging to this one. */
        var nested = [];
        var k = i + 1;
        while (k < block.items.length && block.items[k].level > 0) {
          nested.push(block.items[k]);
          k += 1;
        }

        if (nested.length) {
          out += pad(depth + 1) + '<li>' + inlineToHtml(item.text, opts) + '\n';
          out += listToHtml({ ordered: block.ordered, items: nested.map(function (n) {
            return { level: 0, text: n.text };
          }) }, opts, depth + 2);
          out += pad(depth + 1) + '</li>\n';
        } else {
          out += pad(depth + 1) + '<li>' + inlineToHtml(item.text, opts) + '</li>\n';
        }
        i = k;
      } else {
        /* A nested item with no parent above it. Treat it as top level rather
           than dropping it. */
        out += pad(depth + 1) + '<li>' + inlineToHtml(item.text, opts) + '</li>\n';
        i += 1;
      }
    }

    return out + pad(depth) + '</' + tag + '>\n';
  }

  function tableToHtml(block, opts, depth) {
    var out = pad(depth) + '<table>\n';
    out += pad(depth + 1) + '<thead>\n' + pad(depth + 2) + '<tr>\n';
    block.header.forEach(function (cell, idx) {
      var a = block.align[idx] ? ' style="text-align:' + block.align[idx] + '"' : '';
      out += pad(depth + 3) + '<th' + a + '>' + inlineToHtml(cell, opts) + '</th>\n';
    });
    out += pad(depth + 2) + '</tr>\n' + pad(depth + 1) + '</thead>\n';

    if (block.rows.length) {
      out += pad(depth + 1) + '<tbody>\n';
      block.rows.forEach(function (row) {
        out += pad(depth + 2) + '<tr>\n';
        row.forEach(function (cell, idx) {
          var a = block.align[idx] ? ' style="text-align:' + block.align[idx] + '"' : '';
          out += pad(depth + 3) + '<td' + a + '>' + inlineToHtml(cell, opts) + '</td>\n';
        });
        out += pad(depth + 2) + '</tr>\n';
      });
      out += pad(depth + 1) + '</tbody>\n';
    }

    return out + pad(depth) + '</table>\n';
  }

  function blocksToHtml(blocks, opts) {
    var depth = opts.fullDocument ? 1 : 0;
    var out = '';

    blocks.forEach(function (b) {
      if (b.type === 'heading') {
        var lvl = Math.min(b.level, 6);
        out += pad(depth) + '<h' + lvl + '>' + inlineToHtml(b.text, opts) + '</h' + lvl + '>\n';

      } else if (b.type === 'paragraph') {
        out += pad(depth) + '<p>' + inlineToHtml(b.text, opts) + '</p>\n';

      } else if (b.type === 'quote') {
        out += pad(depth) + '<blockquote>\n' +
               pad(depth + 1) + '<p>' + inlineToHtml(b.text, opts) + '</p>\n' +
               pad(depth) + '</blockquote>\n';

      } else if (b.type === 'code') {
        /* Code is escaped but never inline parsed: its content is literal. */
        var cls = b.lang ? ' class="language-' + escapeAttr(b.lang) + '"' : '';
        out += pad(depth) + '<pre><code' + cls + '>' + escapeText(b.text) + '</code></pre>\n';

      } else if (b.type === 'hr') {
        out += pad(depth) + '<hr>\n';

      } else if (b.type === 'list') {
        out += listToHtml(b, opts, depth);

      } else if (b.type === 'table') {
        out += tableToHtml(b, opts, depth);
      }
    });

    return out;
  }

  function toHtml(markdown, opts) {
    opts = opts || {};
    var blocks = parseBlocks(preprocess(markdown, opts));
    var body = blocksToHtml(blocks, opts);

    if (!opts.fullDocument) return body.replace(/\n$/, '');

    var title = '';
    for (var i = 0; i < blocks.length; i++) {
      if (blocks[i].type === 'heading') { title = blocks[i].text; break; }
    }

    return '<!DOCTYPE html>\n<html lang="en">\n<head>\n' +
      IND + '<meta charset="utf-8">\n' +
      IND + '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
      IND + '<title>' + escapeText(title || 'Document') + '</title>\n' +
      '</head>\n<body>\n' + body + '</body>\n</html>';
  }

  /* Counts of what was produced, for the status line. */
  function summarise(blocks) {
    var counts = {};
    blocks.forEach(function (b) { counts[b.type] = (counts[b.type] || 0) + 1; });
    var parts = [];
    function add(k, one, many) {
      if (counts[k]) parts.push(counts[k] + ' ' + (counts[k] === 1 ? one : many));
    }
    add('heading', 'heading', 'headings');
    add('paragraph', 'paragraph', 'paragraphs');
    add('list', 'list', 'lists');
    add('table', 'table', 'tables');
    add('code', 'code block', 'code blocks');
    add('quote', 'quote', 'quotes');
    return parts.length ? 'Converted ' + parts.join(', ') + '.' : '';
  }

  /* ==========================================================================
     UI
     ========================================================================== */

  var input, codeOut, previewOut, statusEl, emptyState, btnCopy, btnDownload, seg;
  var view = 'code';
  var lastHtml = '';

  function readOptions() {
    return {
      fullDocument: document.getElementById('opt-full').checked,
      newTab: document.getElementById('opt-newtab').checked,
      emDash: document.getElementById('opt-emdash').checked,
      smartQuotes: document.getElementById('opt-quotes').checked,
      emoji: document.getElementById('opt-emoji').checked
    };
  }

  function say(message, isError) {
    statusEl.textContent = message;
    statusEl.classList.toggle('status--error', !!isError);
  }

  function setView(next) {
    view = next;
    codeOut.hidden = (view !== 'code');
    previewOut.hidden = (view !== 'preview');
    Array.prototype.forEach.call(seg.querySelectorAll('button'), function (b) {
      b.setAttribute('aria-pressed', b.getAttribute('data-view') === view ? 'true' : 'false');
    });
  }

  function refresh() {
    var raw = input.value;

    if (!raw.trim()) {
      lastHtml = '';
      codeOut.value = '';
      previewOut.textContent = '';
      emptyState.hidden = true;
      btnCopy.disabled = true;
      btnDownload.disabled = true;
      say('');
      return;
    }

    var opts = readOptions();
    var blocks = parseBlocks(preprocess(raw, opts));

    if (!blocks.length) {
      lastHtml = '';
      codeOut.value = '';
      previewOut.textContent = '';
      emptyState.hidden = false;
      btnCopy.disabled = true;
      btnDownload.disabled = true;
      say('');
      return;
    }

    emptyState.hidden = true;
    lastHtml = toHtml(raw, opts);
    codeOut.value = lastHtml;

    /* The preview uses innerHTML deliberately. The invariant that makes this
       safe is in the serialiser, not here: every piece of user text is escaped
       at the moment it is emitted, and unsafe URL schemes never become hrefs.
       The escaping tests cover exactly this. If the serialiser is ever changed
       to emit user input unescaped, this line becomes an XSS hole. */
    previewOut.innerHTML = opts.fullDocument
      ? toHtml(raw, Object.assign({}, opts, { fullDocument: false }))
      : lastHtml;

    btnCopy.disabled = false;
    btnDownload.disabled = false;
    say(summarise(blocks));
  }

  var COPY_ICON = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">' +
    '<rect x="9" y="9" width="12" height="12" rx="2"></rect>' +
    '<path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"></path></svg>';
  var DONE_ICON = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">' +
    '<path d="m5 13 4 4L19 7"></path></svg>';
  var copyTimer;

  function handleCopy() {
    if (!lastHtml) return;
    window.AOC.copyText(lastHtml).then(function () {
      btnCopy.innerHTML = DONE_ICON + '<span>Copied</span>';
      btnCopy.classList.add('is-done');
      window.AOC.revealNextStep();
      clearTimeout(copyTimer);
      copyTimer = setTimeout(function () {
        btnCopy.innerHTML = COPY_ICON + '<span>Copy HTML</span>';
        btnCopy.classList.remove('is-done');
      }, 1900);
    })['catch'](function () {
      codeOut.focus();
      codeOut.select();
      say('Clipboard access was refused. The HTML is selected, press Ctrl+C.', true);
    });
  }

  function handleDownload() {
    if (!lastHtml) return;
    var blob = new Blob([lastHtml], { type: 'text/html;charset=utf-8' });
    window.AOC.downloadBlob(blob, 'document.html');
    say('Downloaded document.html.');
    window.AOC.revealNextStep();
  }

  var EXAMPLE = [
    '# Quarterly Update',
    '',
    'Revenue rose **12 percent** this quarter, with the',
    '[full report](https://example.com) available online.',
    '',
    '## Highlights',
    '',
    '- Two new markets opened',
    '  - Portugal',
    '  - Ireland',
    '- Margin held steady',
    '',
    '| Region | Revenue | Growth |',
    '| ------ | ------: | :----: |',
    '| North  | $12,400 | +8%    |',
    '| South  | $9,800  | -2%    |',
    '',
    '> Momentum is good, but the margin story needs work.',
    '',
    '```bash',
    'npm install',
    'npm run build',
    '```'
  ].join('\n');

  function init() {
    input = document.getElementById('input');
    if (!input) return;

    codeOut = document.getElementById('output-code');
    previewOut = document.getElementById('output-preview');
    statusEl = document.getElementById('status');
    emptyState = document.getElementById('empty-state');
    btnCopy = document.getElementById('copy-html');
    btnDownload = document.getElementById('dl-html');
    seg = document.getElementById('view-toggle');

    input.addEventListener('input', refresh);
    btnCopy.addEventListener('click', handleCopy);
    btnDownload.addEventListener('click', handleDownload);

    Array.prototype.forEach.call(
      document.querySelectorAll('.opt input'),
      function (el) { el.addEventListener('change', refresh); }
    );

    Array.prototype.forEach.call(seg.querySelectorAll('button'), function (b) {
      b.addEventListener('click', function () { setView(b.getAttribute('data-view')); });
    });

    var example = document.getElementById('load-example');
    if (example) {
      example.addEventListener('click', function () {
        input.value = EXAMPLE;
        refresh();
        input.focus();
      });
    }

    setView('code');
    refresh();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.AOC_MDHTML = {
    toHtml: toHtml,
    parseBlocks: parseBlocks,
    inlineToHtml: inlineToHtml,
    preprocess: preprocess,
    summarise: summarise,
    escapeText: escapeText,
    safeHref: safeHref
  };
})();
