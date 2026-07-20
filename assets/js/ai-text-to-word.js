/* AI Text to Word. Markdown is parsed and the .docx is built in this browser.
   Nothing is uploaded. */
(function () {
  'use strict';

  /* docx is not published on cdnjs, so it comes from jsDelivr, pinned to an
     exact version rather than a floating tag. */
  var DOCX_URL = 'https://cdn.jsdelivr.net/npm/docx@8.5.0/build/index.umd.js';
  /* Subresource integrity: if the CDN ever serves altered bytes, the browser
     refuses to run them. Pinned to the exact version above, so this hash must
     be recomputed if that version ever changes. */
  var DOCX_SRI = 'sha384-4xaIisuLEy2lo2HkB2C4rEf7v8jbTb2kuogX6TkuEt9feTWKBSFSOzsqNNbV+sKh';

  /* ==========================================================================
     Optional clean up, applied before parsing
     ========================================================================== */

  function chr(code) { return String.fromCharCode(code); }

  var EM_DASH_RUN = new RegExp('([ \\t]*)' + chr(0x2014) + '+([ \\t]*)', 'g');
  var SMART_QUOTES = new RegExp('[' +
    chr(0x2018) + chr(0x2019) + chr(0x201A) + chr(0x201B) +
    chr(0x201C) + chr(0x201D) + chr(0x201E) + chr(0x201F) + ']', 'g');
  var DOUBLE_QUOTES = chr(0x201C) + chr(0x201D) + chr(0x201E) + chr(0x201F);

  /* Pictographic ranges. Deliberately excludes arrows and common punctuation
     symbols, which are real text rather than decoration. */
  function range(a, b) {
    return String.fromCodePoint(a) + '-' + String.fromCodePoint(b);
  }
  var EMOJI = new RegExp('[' +
    range(0x1F000, 0x1FAFF) +   /* emoticons, pictographs, transport, symbols */
    range(0x2600, 0x27BF) +     /* misc symbols and dingbats */
    range(0x2B00, 0x2BFF) +     /* misc symbols and arrows block */
    range(0xFE00, 0xFE0F) +     /* variation selectors */
    String.fromCodePoint(0x20E3) +  /* combining enclosing keycap */
    String.fromCodePoint(0x200D) +  /* zero width joiner in emoji sequences */
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
      out = out.replace(EMOJI, '');
      /* Removing an emoji leaves a gap. Two separate cases: between words it
         leaves a double space, but before punctuation it leaves a single
         orphaned space ("work , the") which a double space collapse misses. */
      out = out.replace(/[ \t]{2,}/g, ' ')
               .replace(/[ \t]+([,.;:!?])/g, '$1')
               .replace(/[ \t]+$/gm, '');
    }
    return out;
  }

  /* ==========================================================================
     Inline parsing: markdown spans to formatting runs
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
      var p = INLINE_PATTERNS[i];
      var m = p.re.exec(text);
      if (m && (best === null || m.index < best.index)) {
        best = {
          index: m.index,
          length: m[0].length,
          type: p.type,
          content: m[1],
          url: m[2] || ''
        };
      }
    }
    return best;
  }

  function copyFlags(flags, extra) {
    var out = {
      bold: flags.bold, italic: flags.italic,
      strike: flags.strike, link: flags.link
    };
    if (extra) {
      for (var k in extra) { if (extra.hasOwnProperty(k)) out[k] = extra[k]; }
    }
    return out;
  }

  function parseInline(text, flags) {
    flags = flags || {};
    var runs = [];

    while (text.length) {
      var hit = findFirst(text);
      if (!hit) {
        runs.push(makeRun(text, flags));
        break;
      }
      if (hit.index > 0) {
        runs.push(makeRun(text.slice(0, hit.index), flags));
      }

      if (hit.type === 'code') {
        /* Code spans are literal. Nothing inside them is markdown. */
        runs.push(makeRun(hit.content, copyFlags(flags, { code: true })));
      } else if (hit.type === 'link' || hit.type === 'image') {
        var inner = parseInline(hit.content, copyFlags(flags, { link: hit.url }));
        runs = runs.concat(inner);
      } else if (hit.type === 'bi') {
        runs = runs.concat(parseInline(hit.content, copyFlags(flags, { bold: true, italic: true })));
      } else if (hit.type === 'bold') {
        runs = runs.concat(parseInline(hit.content, copyFlags(flags, { bold: true })));
      } else if (hit.type === 'italic') {
        runs = runs.concat(parseInline(hit.content, copyFlags(flags, { italic: true })));
      } else if (hit.type === 'strike') {
        runs = runs.concat(parseInline(hit.content, copyFlags(flags, { strike: true })));
      }

      text = text.slice(hit.index + hit.length);
    }

    return runs.filter(function (r) { return r.text !== ''; });
  }

  function makeRun(text, flags) {
    return {
      text: text,
      bold: !!flags.bold,
      italic: !!flags.italic,
      strike: !!flags.strike,
      code: !!flags.code,
      link: flags.link || ''
    };
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

      /* Fenced code block. Everything inside is literal until the closing fence. */
      var fence = RE_FENCE.exec(line);
      if (fence) {
        var lang = fence[1].trim();
        var buf = [];
        i += 1;
        while (i < lines.length && !RE_FENCE.test(lines[i])) {
          buf.push(lines[i]);
          i += 1;
        }
        i += 1; /* closing fence */
        blocks.push({ type: 'code', lang: lang, text: buf.join('\n') });
        continue;
      }

      /* Table: a row of pipes followed by a separator row. */
      if (line.indexOf('|') !== -1 && isTableSeparator(lines[i + 1])) {
        var header = splitCells(line);
        var rows = [];
        var j = i + 2;
        while (j < lines.length && lines[j].trim() !== '' &&
               lines[j].indexOf('|') !== -1 && !isTableSeparator(lines[j])) {
          rows.push(splitCells(lines[j]));
          j += 1;
        }
        blocks.push({ type: 'table', header: header, rows: rows });
        i = j;
        continue;
      }

      if (RE_HR.test(line)) { blocks.push({ type: 'hr' }); i += 1; continue; }

      var heading = RE_HEADING.exec(line);
      if (heading) {
        /* Word styles beyond level 4 are rarely used, so deeper headings clamp. */
        var level = Math.min(heading[1].length, 4);
        blocks.push({ type: 'heading', level: level, runs: parseInline(heading[2].trim()) });
        i += 1;
        continue;
      }

      if (RE_QUOTE.test(line)) {
        var qbuf = [];
        while (i < lines.length && RE_QUOTE.test(lines[i])) {
          qbuf.push(RE_QUOTE.exec(lines[i])[1]);
          i += 1;
        }
        blocks.push({ type: 'quote', runs: parseInline(qbuf.join(' ').trim()) });
        continue;
      }

      if (RE_BULLET.test(line) || RE_ORDERED.test(line)) {
        var ordered = RE_ORDERED.test(line);
        var items = [];
        while (i < lines.length) {
          var m = ordered ? RE_ORDERED.exec(lines[i]) : RE_BULLET.exec(lines[i]);
          var other = ordered ? RE_BULLET.exec(lines[i]) : RE_ORDERED.exec(lines[i]);
          if (!m) {
            /* A different list marker ends this list and starts another. */
            if (other) break;
            break;
          }
          /* Two spaces of indent is one nesting level, capped at two levels. */
          var indent = m[1].replace(/\t/g, '  ').length;
          items.push({ level: Math.min(Math.floor(indent / 2), 1), runs: parseInline(m[2].trim()) });
          i += 1;
        }
        blocks.push({ type: 'list', ordered: ordered, items: items });
        continue;
      }

      /* Paragraph: consecutive lines until something else begins. */
      var pbuf = [line];
      i += 1;
      while (i < lines.length && !startsNewBlock(lines[i]) &&
             !(lines[i].indexOf('|') !== -1 && isTableSeparator(lines[i + 1]))) {
        pbuf.push(lines[i]);
        i += 1;
      }
      blocks.push({ type: 'paragraph', runs: parseInline(pbuf.join(' ').trim()) });
    }

    return blocks;
  }

  /* ==========================================================================
     Preview rendering
     ========================================================================== */

  /* Only these protocols become clickable. A pasted javascript: URL must never
     survive into an href. */
  function safeHref(url) {
    return /^(https?:|mailto:)/i.test(url) ? url : null;
  }

  function runsToDom(runs, target) {
    for (var i = 0; i < runs.length; i++) {
      var run = runs[i];
      var node = document.createTextNode(run.text);

      if (run.code) { node = wrap('code', node); }
      if (run.strike) { node = wrap('s', node); }
      if (run.italic) { node = wrap('em', node); }
      if (run.bold) { node = wrap('strong', node); }
      if (run.link) {
        var href = safeHref(run.link);
        var a = document.createElement('a');
        if (href) {
          a.href = href;
          a.rel = 'nofollow noopener';
          a.target = '_blank';
        }
        a.appendChild(node);
        node = a;
      }
      target.appendChild(node);
    }
  }

  function wrap(tag, node) {
    var el = document.createElement(tag);
    el.appendChild(node);
    return el;
  }

  function renderPreview(blocks, target) {
    target.textContent = '';

    for (var i = 0; i < blocks.length; i++) {
      var b = blocks[i];
      var el;

      if (b.type === 'heading') {
        /* Shifted down one level: the page already owns the single h1, so a
           markdown h1 becomes an h2 in the preview. The .docx is unaffected
           and still gets a real Heading 1. */
        el = document.createElement('h' + Math.min(b.level + 1, 6));
        runsToDom(b.runs, el);
      } else if (b.type === 'paragraph') {
        el = document.createElement('p');
        runsToDom(b.runs, el);
      } else if (b.type === 'quote') {
        el = document.createElement('blockquote');
        var qp = document.createElement('p');
        runsToDom(b.runs, qp);
        el.appendChild(qp);
      } else if (b.type === 'code') {
        el = document.createElement('pre');
        var codeEl = document.createElement('code');
        codeEl.textContent = b.text;
        el.appendChild(codeEl);
      } else if (b.type === 'hr') {
        el = document.createElement('hr');
      } else if (b.type === 'list') {
        el = buildList(b);
      } else if (b.type === 'table') {
        el = buildTable(b);
      }

      if (el) target.appendChild(el);
    }
  }

  function buildList(block) {
    var root = document.createElement(block.ordered ? 'ol' : 'ul');
    var currentNested = null;

    for (var i = 0; i < block.items.length; i++) {
      var item = block.items[i];
      var li = document.createElement('li');
      runsToDom(item.runs, li);

      if (item.level === 0) {
        root.appendChild(li);
        currentNested = null;
      } else {
        if (!currentNested) {
          currentNested = document.createElement(block.ordered ? 'ol' : 'ul');
          var host = root.lastElementChild || root.appendChild(document.createElement('li'));
          host.appendChild(currentNested);
        }
        currentNested.appendChild(li);
      }
    }
    return root;
  }

  function buildTable(block) {
    var scroll = document.createElement('div');
    scroll.className = 'table-scroll';

    var table = document.createElement('table');
    var thead = document.createElement('thead');
    var htr = document.createElement('tr');
    for (var c = 0; c < block.header.length; c++) {
      var th = document.createElement('th');
      th.scope = 'col';
      runsToDom(parseInline(block.header[c]), th);
      htr.appendChild(th);
    }
    thead.appendChild(htr);
    table.appendChild(thead);

    var tbody = document.createElement('tbody');
    for (var r = 0; r < block.rows.length; r++) {
      var tr = document.createElement('tr');
      for (var k = 0; k < block.rows[r].length; k++) {
        var td = document.createElement('td');
        runsToDom(parseInline(block.rows[r][k]), td);
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    scroll.appendChild(table);
    return scroll;
  }

  /* ==========================================================================
     docx building
     ========================================================================== */

  var CODE_FILL = 'F3F1EE';
  var CODE_FONT = 'Consolas';
  var NUM_REF = 'aoc-ordered';

  function buildRuns(d, runs) {
    var out = [];
    for (var i = 0; i < runs.length; i++) {
      var r = runs[i];
      var opts = {
        text: r.text,
        bold: r.bold || undefined,
        italics: r.italic || undefined,
        strike: r.strike || undefined
      };
      if (r.code) {
        opts.font = CODE_FONT;
        opts.shading = { type: d.ShadingType.CLEAR, fill: CODE_FILL };
      }
      if (r.link) {
        out.push(new d.ExternalHyperlink({
          children: [new d.TextRun(Object.assign({}, opts, { style: 'Hyperlink' }))],
          link: r.link
        }));
      } else {
        out.push(new d.TextRun(opts));
      }
    }
    return out;
  }

  var HEADING_LEVELS = ['HEADING_1', 'HEADING_2', 'HEADING_3', 'HEADING_4'];

  function buildDocxChildren(d, blocks) {
    var children = [];
    var orderedInstance = 0;

    for (var i = 0; i < blocks.length; i++) {
      var b = blocks[i];

      if (b.type === 'heading') {
        children.push(new d.Paragraph({
          heading: d.HeadingLevel[HEADING_LEVELS[b.level - 1]],
          children: buildRuns(d, b.runs),
          spacing: { before: 240, after: 120 }
        }));

      } else if (b.type === 'paragraph') {
        children.push(new d.Paragraph({
          children: buildRuns(d, b.runs),
          spacing: { after: 160 }
        }));

      } else if (b.type === 'quote') {
        children.push(new d.Paragraph({
          children: buildRuns(d, b.runs),
          indent: { left: 480 },
          border: {
            left: { style: d.BorderStyle.SINGLE, size: 12, color: 'CCCCCC', space: 12 }
          },
          spacing: { after: 160 }
        }));

      } else if (b.type === 'code') {
        /* One paragraph per line, each shaded, so the block reads as a slab. */
        var codeLines = b.text.split('\n');
        for (var c = 0; c < codeLines.length; c++) {
          children.push(new d.Paragraph({
            children: [new d.TextRun({ text: codeLines[c] || ' ', font: CODE_FONT, size: 20 })],
            shading: { type: d.ShadingType.CLEAR, fill: CODE_FILL },
            spacing: { after: 0, line: 260 }
          }));
        }
        children.push(new d.Paragraph({ text: '', spacing: { after: 120 } }));

      } else if (b.type === 'hr') {
        children.push(new d.Paragraph({
          text: '',
          border: { bottom: { style: d.BorderStyle.SINGLE, size: 6, color: 'DDDDDD', space: 8 } },
          spacing: { after: 160 }
        }));

      } else if (b.type === 'list') {
        if (b.ordered) orderedInstance += 1;
        for (var k = 0; k < b.items.length; k++) {
          var item = b.items[k];
          var para = { children: buildRuns(d, item.runs), spacing: { after: 60 } };
          if (b.ordered) {
            /* A fresh instance per list, otherwise every ordered list on the
               page continues the previous one's numbering. */
            para.numbering = { reference: NUM_REF, level: item.level, instance: orderedInstance };
          } else {
            para.bullet = { level: item.level };
          }
          children.push(new d.Paragraph(para));
        }

      } else if (b.type === 'table') {
        children.push(buildDocxTable(d, b));
        children.push(new d.Paragraph({ text: '', spacing: { after: 160 } }));
      }
    }

    return children;
  }

  function buildDocxTable(d, block) {
    function cell(text, isHeader) {
      return new d.TableCell({
        children: [new d.Paragraph({
          children: buildRuns(d, parseInline(text)),
          spacing: { after: 0 }
        })],
        shading: isHeader ? { type: d.ShadingType.CLEAR, fill: CODE_FILL } : undefined
      });
    }

    var rows = [];
    rows.push(new d.TableRow({
      tableHeader: true,
      children: block.header.map(function (h) { return cell(h, true); })
    }));

    for (var r = 0; r < block.rows.length; r++) {
      var cells = block.rows[r];
      /* Word requires every row to have the same number of cells. */
      while (cells.length < block.header.length) cells.push('');
      rows.push(new d.TableRow({
        children: cells.slice(0, block.header.length).map(function (t) { return cell(t, false); })
      }));
    }

    return new d.Table({
      rows: rows,
      width: { size: 100, type: d.WidthType.PERCENTAGE }
    });
  }

  function buildDocument(d, blocks) {
    return new d.Document({
      numbering: {
        config: [{
          reference: NUM_REF,
          levels: [
            { level: 0, format: 'decimal', text: '%1.', alignment: d.AlignmentType.START },
            { level: 1, format: 'lowerLetter', text: '%2.', alignment: d.AlignmentType.START }
          ]
        }]
      },
      sections: [{ properties: {}, children: buildDocxChildren(d, blocks) }]
    });
  }

  /* ==========================================================================
     UI
     ========================================================================== */

  var input, previewEl, statusEl, emptyState, btnDocx;
  var blocks = [];

  var docxPromise = null;
  function loadDocx() {
    if (window.docx) return Promise.resolve(window.docx);
    if (docxPromise) return docxPromise;

    docxPromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = DOCX_URL;
      s.async = true;
      s.integrity = DOCX_SRI;
      s.crossOrigin = 'anonymous';   /* required for integrity to be checked */
      s.referrerPolicy = 'no-referrer';
      s.onload = function () {
        window.docx ? resolve(window.docx) : reject(new Error('docx missing'));
      };
      s.onerror = function () {
        /* Clear the cache so a later click can retry after a network blip. */
        docxPromise = null;
        reject(new Error('Could not load the Word library'));
      };
      document.head.appendChild(s);
    });
    return docxPromise;
  }

  function say(message, isError) {
    statusEl.textContent = message;
    statusEl.classList.toggle('status--error', !!isError);
  }

  function readOptions() {
    return {
      emDash: document.getElementById('opt-emdash').checked,
      smartQuotes: document.getElementById('opt-quotes').checked,
      emoji: document.getElementById('opt-emoji').checked
    };
  }

  function describe(list) {
    var counts = {};
    for (var i = 0; i < list.length; i++) {
      counts[list[i].type] = (counts[list[i].type] || 0) + 1;
    }
    var parts = [];
    function add(key, singular, plural) {
      if (counts[key]) parts.push(counts[key] + ' ' + (counts[key] === 1 ? singular : plural));
    }
    add('heading', 'heading', 'headings');
    add('paragraph', 'paragraph', 'paragraphs');
    add('list', 'list', 'lists');
    add('table', 'table', 'tables');
    add('code', 'code block', 'code blocks');
    add('quote', 'quote', 'quotes');
    return parts.length ? 'Found ' + parts.join(', ') + '.' : '';
  }

  function refresh() {
    var raw = input.value;
    if (!raw.trim()) {
      blocks = [];
      previewEl.textContent = '';
      previewEl.hidden = true;
      emptyState.hidden = true;
      btnDocx.disabled = true;
      say('');
      return;
    }

    blocks = parseBlocks(preprocess(raw, readOptions()));

    var has = blocks.length > 0;
    previewEl.hidden = !has;
    emptyState.hidden = has;
    btnDocx.disabled = !has;

    if (has) {
      renderPreview(blocks, previewEl);
      say(describe(blocks));
    } else {
      say('');
    }
  }

  function download() {
    if (!blocks.length) return;
    btnDocx.disabled = true;
    say('Building the Word document...');

    loadDocx().then(function (d) {
      var doc = buildDocument(d, blocks);
      return d.Packer.toBlob(doc).then(function (blob) {
        window.AOC.downloadBlob(blob, 'document.docx');
        say('Downloaded document.docx.');
        window.AOC.revealNextStep();
      });
    })['catch'](function () {
      say('The Word library could not be loaded. Check your connection and try again.', true);
    })['then'](function () {
      btnDocx.disabled = !blocks.length;
    });
  }

  var EXAMPLE = [
    '# Quarterly Update',
    '',
    'This is a **short example** with *italic text*, a [link](https://example.com)',
    'and some `inline code` to show what survives the conversion.',
    '',
    '## Highlights',
    '',
    '- Revenue up 12 percent',
    '- Two new markets opened',
    '  - Portugal',
    '  - Ireland',
    '',
    '### Next steps',
    '',
    '1. Finalise the budget',
    '2. Brief the team',
    '3. Ship the update',
    '',
    '> Momentum is good, but the margin story needs work.',
    '',
    '| Region | Revenue | Growth |',
    '| ------ | ------- | ------ |',
    '| North  | $12,400 | +8%    |',
    '| South  | $9,800  | -2%    |',
    '',
    '```',
    'npm install',
    'npm run build',
    '```'
  ].join('\n');

  function init() {
    input = document.getElementById('input');
    if (!input) return;

    previewEl = document.getElementById('preview');
    statusEl = document.getElementById('status');
    emptyState = document.getElementById('empty-state');
    btnDocx = document.getElementById('dl-docx');

    input.addEventListener('input', refresh);
    btnDocx.addEventListener('click', download);
    Array.prototype.forEach.call(
      document.querySelectorAll('.opt input'),
      function (el) { el.addEventListener('change', refresh); }
    );

    var example = document.getElementById('load-example');
    if (example) {
      example.addEventListener('click', function () {
        input.value = EXAMPLE;
        refresh();
        input.focus();
      });
    }

    refresh();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.AOC_MDWORD = {
    parseBlocks: parseBlocks,
    parseInline: parseInline,
    preprocess: preprocess
  };
})();
