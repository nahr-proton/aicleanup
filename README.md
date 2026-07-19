# aicleanup.tools

Free, browser based tools that clean up and convert AI generated text.
Static HTML, CSS and vanilla JavaScript. No build step, no backend, no
database, no accounts.

**Everything runs client side.** Text a visitor pastes never leaves their
browser. That is the core promise of the site and every change should preserve
it.

## Pages

| URL | File |
| --- | --- |
| `/` | `index.html` |
| `/markdown-table-to-excel/` | Tool 1, markdown tables to .xlsx / .csv / TSV |
| `/ai-text-to-word/` | Tool 2, markdown to .docx |
| `/em-dash-remover/` | Tool 3, em dashes, smart quotes, invisible characters |
| `/about/` `/privacy/` `/terms/` `/contact/` `/impressum/` | Content and legal |
| `404.html` | Not found |

## Running it locally

Any static file server works. There is nothing to compile.

```
npx http-server . -p 4173 -c-1
```

Then open <http://localhost:4173>. `.claude/launch.json` has the same command
if you use that tooling.

Paths are root relative, so opening the HTML files directly from disk with
`file://` will not load the CSS. Use a server.

## Tests

The parsers are plain functions exposed on `window`, so they can be exercised
in Node with a small DOM stub. Test files live outside this repo; the pattern
is:

```js
global.document = { readyState: 'loading', addEventListener() {}, /* ... */ };
global.window = {};
eval(fs.readFileSync('assets/js/em-dash-remover.js', 'utf8'));
const { clean, analyse } = window.AOC_EMDASH;
```

Exposed for testing:

- `window.AOC_EMDASH` — `clean`, `analyse`, `describe`
- `window.AOC_MDTABLE` — `parseTables`, `toCSV`, `toTSV`, `stripInline`
- `window.AOC_MDWORD` — `parseBlocks`, `parseInline`, `preprocess`

## Configuration

All switches live at the top of `assets/js/site.js`.

### Analytics

```js
var UMAMI_SRC        = 'https://cloud.umami.is/script.js';
var UMAMI_WEBSITE_ID = 'de6953a3-1552-479d-a4cc-568175d5ec3f';
var UMAMI_DOMAINS    = 'aicleanup.tools';
```

Cookieless, so it needs no consent banner. `UMAMI_DOMAINS` keeps local and
preview traffic out of the statistics. Leaving either of the first two empty
disables analytics entirely.

### Advertising, currently off

```js
var ADSENSE_CLIENT = '';
```

While this is empty:

- no advertising script is requested,
- the cookie notice stays hidden, because there are no cookies to consent to,
- the `.ad-slot` containers collapse to zero height.

To switch advertising on:

1. Put the publisher ID in `ADSENSE_CLIENT`.
2. Add `data-ad-slot-id="…"` to each `.ad-slot` div, using the unit IDs from
   AdSense. Slots without an ID stay empty rather than rendering a broken unit.
3. Add `/ads.txt` at the repository root with the publisher ID.
4. Extend the CSP in `_headers`; the required origins are listed in a comment
   there.
5. Enable a Google certified CMP for EEA traffic.

Consent is enforced before any request is made, not after. Declining means the
script is never fetched. Consent Mode v2 signals default to denied.

### Scriber cross links

`em-dash-remover/index.html` and `ai-text-to-word/index.html` each contain a
commented out card linking to scriber.video. Delete the comment opener and
closer to make them live.

## Social share images

`_dev/og-generator.html` draws the Open Graph cards at 1200x630 and downloads
them as JPEGs. Open it, click the button, move the files into `assets/img/`.

The pages already reference these filenames, so until they exist the social
previews fall back to text only. Add a card to the `CARDS` array when a new
tool is added.

## Third party libraries

Loaded on demand, only when a visitor asks for a file, and pinned with
subresource integrity hashes:

| Library | Source | Used by |
| --- | --- | --- |
| SheetJS 0.18.5 | cdnjs | `.xlsx` downloads |
| docx 8.5.0 | jsDelivr | `.docx` downloads |

If either version changes, the SRI hash in the corresponding JS file must be
recomputed or the browser will refuse to run the script:

```
curl -sL <url> | openssl dgst -sha384 -binary | openssl base64 -A
```

docx is not published on cdnjs, which is why it comes from jsDelivr.

## Deployment

Cloudflare Pages, deployed from this repository.

- Build command: none
- Output directory: `/`

Also needed:

- `www` redirecting to the apex domain, since every canonical URL uses the
  apex form
- Trailing slashes preserved, because canonicals and the sitemap use them
- `hello@aicleanup.tools` forwarding, via Cloudflare Email Routing

`_headers` sets the CSP, HSTS and other security headers at the edge. There are
no inline scripts or inline styles anywhere in the site, so the CSP does not
need `unsafe-inline`. Keep it that way.

## Conventions worth keeping

- **Say only what is true.** The site claims no cookies, no advertising and no
  uploads. If any of that changes, the About page, privacy policy, home FAQ
  and cookie notice all have to change with it, and the FAQ text is duplicated
  in JSON-LD.
- **Source files stay ASCII.** Character classes are built from code points
  (`String.fromCharCode(0x200B)`) rather than pasted literals, because half of
  them are invisible and cannot be read or diffed otherwise.
- **Never write pasted text as HTML.** Previews are built with
  `createElement` and `textContent`. Link hrefs go through a protocol
  allowlist.
- **One H1 per page**, tool above the fold, FAQ mirrored into JSON-LD.
