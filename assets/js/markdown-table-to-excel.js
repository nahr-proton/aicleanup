/* Markdown Table to Excel. All parsing and file generation happens in this
   browser. Nothing is uploaded. */
(function () {
  'use strict';

  var SHEETJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
  /* Subresource integrity: if the CDN ever serves altered bytes, the browser
     refuses to run them. Pinned to the exact version above, so this hash must
     be recomputed if that version ever changes. */
  var SHEETJS_SRI = 'sha384-vtjasyidUo0kW94K5MXDXntzOJpQgBKXmE7e2Ga4LG0skTTLeBi97eFAXsqewJjw';

  /* ==========================================================================
     Parsing
     ========================================================================== */

  /* Splits one row on unescaped pipes. A backslash escaped pipe is a literal
     pipe inside a cell, so it must not become a column boundary. */
  function splitRow(line) {
    var cells = [];
    var cur = '';
    var i = 0;
    while (i < line.length) {
      var ch = line.charAt(i);
      if (ch === '\\' && line.charAt(i + 1) === '|') {
        cur += '|';
        i += 2;
      } else if (ch === '|') {
        cells.push(cur);
        cur = '';
        i += 1;
      } else {
        cur += ch;
        i += 1;
      }
    }
    cells.push(cur);
    return cells;
  }

  /* Outer pipes are optional in markdown. When they are present they produce
     an empty cell at each end, which is padding rather than data. */
  function dropOuterEmpties(cells, line) {
    var t = line.trim();
    var out = cells.slice();
    if (out.length > 1 && t.charAt(0) === '|') out.shift();
    var last = t.charAt(t.length - 1);
    var escaped = t.charAt(t.length - 2) === '\\';
    if (out.length > 1 && last === '|' && !escaped) out.pop();
    return out;
  }

  function cellsOf(line) {
    return dropOuterEmpties(splitRow(line), line);
  }

  /* A separator cell is dashes with optional alignment colons: --- :--- ---: :---: */
  function isSeparatorCell(cell) {
    return /^\s*:?-+:?\s*$/.test(cell);
  }

  function isSeparatorLine(line) {
    if (line.indexOf('-') === -1) return false;
    var cells = cellsOf(line);
    if (!cells.length) return false;
    for (var i = 0; i < cells.length; i++) {
      if (!isSeparatorCell(cells[i])) return false;
    }
    return true;
  }

  function alignmentOf(cell) {
    var c = cell.trim();
    var left = c.charAt(0) === ':';
    var right = c.charAt(c.length - 1) === ':';
    if (left && right) return 'center';
    if (right) return 'right';
    if (left) return 'left';
    return '';
  }

  /* --- Inline markdown ------------------------------------------------------
     Cells arrive carrying bold, italic, code and link syntax. Excel has no
     idea what any of that means, so the syntax goes and the text stays. */
  function stripInline(s) {
    return s
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')      /* images */
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')       /* links, keep the label */
      .replace(/~~([\s\S]+?)~~/g, '$1')              /* strikethrough */
      .replace(/\*\*([\s\S]+?)\*\*/g, '$1')          /* bold */
      .replace(/__([\s\S]+?)__/g, '$1')              /* bold, underscore form */
      .replace(/\*([^*]+)\*/g, '$1')                 /* italic */
      /* Underscore italics only at word boundaries, so snake_case_names and
         file_name.txt survive intact. */
      .replace(/(^|[^\w`])_([^_]+)_(?!\w)/g, '$1$2')
      .replace(/`([^`]*)`/g, '$1')                   /* inline code */
      .replace(/<br\s*\/?>/gi, ' ')                  /* line breaks in cells */
      .replace(/&nbsp;/gi, ' ')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/gi, '&')                       /* last, or it double decodes */
      .trim();
  }

  function cleanCells(line) {
    var raw = cellsOf(line);
    var out = [];
    for (var i = 0; i < raw.length; i++) out.push(stripInline(raw[i]));
    return out;
  }

  /* Rows in the wild are often ragged. Every row is padded to the widest one
     so the grid is rectangular before it reaches a spreadsheet. */
  function squareOff(table) {
    var width = table.header.length;
    var i;
    for (i = 0; i < table.rows.length; i++) {
      if (table.rows[i].length > width) width = table.rows[i].length;
    }
    function pad(row) {
      while (row.length < width) row.push('');
      return row;
    }
    pad(table.header);
    for (i = 0; i < table.rows.length; i++) pad(table.rows[i]);
    while (table.align.length < width) table.align.push('');
    return table;
  }

  /* Finds every table in the pasted text. A table is a line containing pipes
     followed immediately by a separator row. */
  function parseTables(text) {
    var lines = String(text).split(/\r?\n/);
    var tables = [];
    var i = 0;

    while (i < lines.length) {
      var line = lines[i];
      var hasPipe = line.indexOf('|') !== -1;
      var nextIsSeparator = (i + 1 < lines.length) && isSeparatorLine(lines[i + 1]);

      if (hasPipe && line.trim() !== '' && nextIsSeparator) {
        var header = cleanCells(line);
        var sepCells = cellsOf(lines[i + 1]);
        var align = [];
        for (var a = 0; a < sepCells.length; a++) align.push(alignmentOf(sepCells[a]));

        var rows = [];
        var j = i + 2;
        while (j < lines.length &&
               lines[j].trim() !== '' &&
               lines[j].indexOf('|') !== -1 &&
               !isSeparatorLine(lines[j])) {
          rows.push(cleanCells(lines[j]));
          j += 1;
        }

        tables.push(squareOff({ header: header, align: align, rows: rows }));
        i = j;
      } else {
        i += 1;
      }
    }
    return tables;
  }

  /* ==========================================================================
     Output formats
     ========================================================================== */

  function asGrid(table) {
    return [table.header].concat(table.rows);
  }

  /* RFC 4180: quote when the value holds a comma, quote or newline, and
     double any quote inside. CRLF endings keep Excel happy. */
  function csvCell(v) {
    return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }

  function toCSV(table) {
    return asGrid(table).map(function (row) {
      return row.map(csvCell).join(',');
    }).join('\r\n');
  }

  /* TSV has no escaping mechanism at all, so any tab or newline inside a cell
     would silently create a new column or row. They collapse to spaces. */
  function toTSV(table) {
    return asGrid(table).map(function (row) {
      return row.map(function (v) {
        return v.replace(/[\t\r\n]+/g, ' ');
      }).join('\t');
    }).join('\n');
  }

  /* Excel sheet names cannot exceed 31 characters or contain : \ / ? * [ ] */
  function sheetName(index) {
    return ('Table ' + (index + 1)).slice(0, 31);
  }

  /* ==========================================================================
     UI
     ========================================================================== */

  var input, preview, statusEl, segWrap, btnXlsx, btnCsv, btnTsv, emptyState;
  var tables = [];
  var selected = 0;

  /* Loads SheetJS on first use rather than on page load. The library is far
     larger than this entire site, and most visitors only need CSV or TSV. */
  var sheetJsPromise = null;
  function loadSheetJS() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (sheetJsPromise) return sheetJsPromise;

    sheetJsPromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = SHEETJS_URL;
      s.async = true;
      s.integrity = SHEETJS_SRI;
      s.crossOrigin = 'anonymous';   /* required for integrity to be checked */
      s.referrerPolicy = 'no-referrer';
      s.onload = function () {
        window.XLSX ? resolve(window.XLSX) : reject(new Error('XLSX missing'));
      };
      s.onerror = function () {
        /* Clear the cache so a later click retries. Without this the rejected
           promise is remembered forever and a temporary network blip would
           permanently disable the button until a reload. */
        sheetJsPromise = null;
        reject(new Error('Could not load the spreadsheet library'));
      };
      document.head.appendChild(s);
    });
    return sheetJsPromise;
  }

  function say(message, isError) {
    statusEl.textContent = message;
    statusEl.classList.toggle('status--error', !!isError);
  }

  function current() {
    return tables[selected] || null;
  }

  /* --- Rendering ------------------------------------------------------------
     Built with createElement and textContent throughout. Pasted text is never
     written as HTML, so a cell containing markup stays inert text. */
  function renderPreview() {
    preview.textContent = '';

    for (var t = 0; t < tables.length; t++) {
      var table = tables[t];

      var item = document.createElement('div');
      item.className = 'preview__item';

      var head = document.createElement('div');
      head.className = 'preview__head';

      var title = document.createElement('span');
      title.className = 'preview__title';
      title.textContent = tables.length > 1 ? 'Table ' + (t + 1) : 'Parsed table';

      var meta = document.createElement('span');
      meta.className = 'preview__meta';
      meta.textContent = table.header.length + ' columns, ' + table.rows.length +
        (table.rows.length === 1 ? ' row' : ' rows');

      head.appendChild(title);
      head.appendChild(meta);

      var scroll = document.createElement('div');
      scroll.className = 'table-scroll';

      var el = document.createElement('table');
      var thead = document.createElement('thead');
      var htr = document.createElement('tr');
      for (var c = 0; c < table.header.length; c++) {
        var th = document.createElement('th');
        th.textContent = table.header[c];
        th.scope = 'col';
        if (table.align[c]) th.className = 'is-' + table.align[c];
        htr.appendChild(th);
      }
      thead.appendChild(htr);
      el.appendChild(thead);

      var tbody = document.createElement('tbody');
      for (var r = 0; r < table.rows.length; r++) {
        var tr = document.createElement('tr');
        for (var k = 0; k < table.rows[r].length; k++) {
          var td = document.createElement('td');
          td.textContent = table.rows[r][k];
          if (table.align[k]) td.className = 'is-' + table.align[k];
          tr.appendChild(td);
        }
        tbody.appendChild(tr);
      }
      el.appendChild(tbody);
      scroll.appendChild(el);

      item.appendChild(head);
      item.appendChild(scroll);
      preview.appendChild(item);
    }
  }

  function renderSelector() {
    segWrap.textContent = '';
    if (tables.length < 2) {
      segWrap.hidden = true;
      return;
    }
    segWrap.hidden = false;

    var label = document.createElement('span');
    label.className = 'field__hint';
    label.textContent = 'CSV and TSV apply to:';
    segWrap.appendChild(label);

    var seg = document.createElement('div');
    seg.className = 'seg';
    seg.setAttribute('role', 'group');
    seg.setAttribute('aria-label', 'Choose which table to export');

    for (var i = 0; i < tables.length; i++) {
      (function (index) {
        var b = document.createElement('button');
        b.type = 'button';
        b.textContent = 'Table ' + (index + 1);
        b.setAttribute('aria-pressed', index === selected ? 'true' : 'false');
        b.addEventListener('click', function () {
          selected = index;
          renderSelector();
          say('CSV and tab separated copies will use table ' + (index + 1) + '.');
        });
        seg.appendChild(b);
      })(i);
    }
    segWrap.appendChild(seg);
  }

  var EXAMPLE = [
    '| Region | Revenue | Growth |',
    '| ------ | ------: | :----: |',
    '| **North** | $12,400 | +8% |',
    '| South | $9,800 | -2% |',
    '| East `beta` | $15,200 | +14% |'
  ].join('\n');

  function refresh() {
    var text = input.value;
    tables = text.trim() ? parseTables(text) : [];
    if (selected >= tables.length) selected = 0;

    var found = tables.length > 0;
    emptyState.hidden = found || !text.trim();
    preview.hidden = !found;

    btnXlsx.disabled = !found;
    btnCsv.disabled = !found;
    btnTsv.disabled = !found;

    renderSelector();

    if (!text.trim()) {
      preview.textContent = '';
      say('');
      return;
    }
    if (!found) {
      say('');
      return;
    }

    renderPreview();

    var totalRows = 0;
    for (var i = 0; i < tables.length; i++) totalRows += tables[i].rows.length;
    say(tables.length === 1
      ? 'Found 1 table with ' + totalRows + (totalRows === 1 ? ' row' : ' rows') + '.'
      : 'Found ' + tables.length + ' tables with ' + totalRows + ' rows in total. The .xlsx puts each on its own sheet.');
  }

  /* --- Downloads ----------------------------------------------------------- */
  function downloadCSV() {
    var table = current();
    if (!table) return;
    /* The BOM makes Excel read the file as UTF-8 instead of guessing. */
    var blob = new Blob([String.fromCharCode(0xFEFF) + toCSV(table)], { type: 'text/csv;charset=utf-8;' });
    var name = tables.length > 1 ? 'table-' + (selected + 1) + '.csv' : 'table.csv';
    window.AOC.downloadBlob(blob, name);
    say('Downloaded ' + name + '.');
  }

  function downloadXLSX() {
    if (!tables.length) return;
    var original = btnXlsx.innerHTML;
    btnXlsx.disabled = true;
    say('Preparing the spreadsheet...');

    loadSheetJS().then(function (XLSX) {
      var wb = XLSX.utils.book_new();
      for (var i = 0; i < tables.length; i++) {
        var ws = XLSX.utils.aoa_to_sheet(asGrid(tables[i]));
        XLSX.utils.book_append_sheet(wb, ws, sheetName(i));
      }
      var out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      var blob = new Blob([out], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      });
      window.AOC.downloadBlob(blob, 'tables.xlsx');
      say(tables.length > 1
        ? 'Downloaded tables.xlsx with ' + tables.length + ' sheets.'
        : 'Downloaded tables.xlsx.');
    })['catch'](function () {
      say('The spreadsheet library could not be loaded. Check your connection, or use Download .csv which needs nothing extra.', true);
    })['then'](function () {
      btnXlsx.innerHTML = original;
      btnXlsx.disabled = !tables.length;
    });
  }

  var TSV_LABEL = 'Copy as tab separated';
  var copyTimer;

  function copyTSV() {
    var table = current();
    if (!table) return;
    window.AOC.copyText(toTSV(table)).then(function () {
      btnTsv.classList.add('is-done');
      btnTsv.querySelector('span').textContent = 'Copied, ready to paste';
      clearTimeout(copyTimer);
      copyTimer = setTimeout(function () {
        btnTsv.classList.remove('is-done');
        btnTsv.querySelector('span').textContent = TSV_LABEL;
      }, 1900);
    })['catch'](function () {
      say('Clipboard access was refused. Use Download .csv instead.', true);
    });
  }

  function init() {
    input = document.getElementById('input');
    if (!input) return;

    preview = document.getElementById('preview');
    statusEl = document.getElementById('status');
    segWrap = document.getElementById('table-select');
    emptyState = document.getElementById('empty-state');
    btnXlsx = document.getElementById('dl-xlsx');
    btnCsv = document.getElementById('dl-csv');
    btnTsv = document.getElementById('copy-tsv');

    input.addEventListener('input', refresh);
    btnCsv.addEventListener('click', downloadCSV);
    btnXlsx.addEventListener('click', downloadXLSX);
    btnTsv.addEventListener('click', copyTSV);

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

  /* Exposed so the parser can be exercised directly. */
  window.AOC_MDTABLE = {
    parseTables: parseTables,
    toCSV: toCSV,
    toTSV: toTSV,
    stripInline: stripInline
  };
})();
