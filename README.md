# SCORM Mini Editor

Free, browser-based WYSIWYG editor for SCORM ZIP courses — for teachers and
researchers who want to fix a text or swap an image without touching HTML,
CSS, JavaScript or XML.

**Live app:** https://fycodelab.github.io/scorm-mini-editor/
**Repository:** https://github.com/FYCodeLab/scorm-mini-editor

Everything runs in your browser. There is no backend, no account, no database
and no paid API. Your SCORM ZIP is **never uploaded** to GitHub or any server:
it is read, edited and re-zipped locally with the browser's File and JSZip APIs.

## Workflow

1. Open the live app.
2. **Import SCORM ZIP** — or drag and drop a `.zip` onto the landing page.
   You can also click *“try the built-in demo course”* to explore without a file.
3. Pick a text block on the left (search works), edit it, and click
   **Apply change**. Use **Undo / Redo** in the top bar for file-level undo.
4. In the **Images** tab, replace a local image. In the **External** tab,
   replace an external image with an upload, or try **Make local (download)**.
5. Switch to **Preview** to see the course as a learner would, in a sandboxed
   iframe, with a simulated SCORM API log.
6. Click **Export SCORM ZIP**. The download is a new file
   (`<original>-edited.zip`); your original is never overwritten.
7. Reimport the exported ZIP to verify your changes, then test it in your
   real LMS (e.g. Moodle) before publishing to learners.

## User guide

### Text editing

- **Static HTML text** (ordinary pages) is edited with a rich-text toolbar:
  bold, italic, underline, font size, text colour, highlight, alignment,
  headings, bulleted and numbered lists, undo/redo.
- **JavaScript-generated text** is different, and the editor says so. Many
  single-page courses generate their lessons from JavaScript data at run
  time, so there is no static paragraph to click. SCORM Mini Editor handles
  this case in a structure-aware way: it parses the course's data
  (`tasks`, `syntheses`, `imageUrls`, `readPhotos` in the reference course)
  with a small literal parser that records the exact position of each
  string, and replaces *only that string*, in place. Scoring keys, points,
  navigation and tracking code are never offered as editable text.
- Blocks that the course escapes as HTML (for example lesson titles) are
  plain-text only, on purpose: a `<b>` tag there would be shown literally
  to learners. Blocks that the course inserts as HTML (for example the
  “Remember that…” summaries) offer the full rich-text toolbar.
- Clicking text in Preview tries to select the matching editable block.

### Images

- **Replace a local image:** the file name in the package is unchanged, so
  every reference still works. PNG, JPEG, GIF, WebP, SVG and AVIF are
  accepted (max 20 MB). SVGs containing scripts or event handlers are rejected.
- **Replace an external image:** upload a file you have the right to use.
  It is added to the ZIP under its own file name, every occurrence of the
  old URL in the course HTML is rewritten to that file name, and the file is
  listed in the manifest resource (the only documented manifest change).
- **Make images local:** the app tries to download the external image with
  a normal CORS fetch. Many hosts refuse this; when it fails, the app says
  so and does **not** bypass the restriction. Upload a replacement instead.
  Never assume permission to redistribute a third-party image.
- Image resizing/alignment: proportions are preserved by the course's own
  CSS. There is no separate resize control in this version (see Limitations).

### Preview and SCORM tracking

Preview runs the course in an `<iframe sandbox="allow-scripts">`. Imported
scripts therefore cannot touch the editor's DOM, state, credentials or
GitHub context. Local assets are rewritten to Blob URLs created from the
package; external URLs are left as-is.

A SCORM 1.2 `window.API` stub is injected for preview only, and its calls
are logged under *SCORM API log*. **Preview is not an LMS test.** Scores
and completion shown in preview are simulated and are not saved anywhere.
Always import the exported ZIP into your LMS and complete the course there
before using it with learners.

## Supported formats and limitations

Supported:

- SCORM 1.2 and SCORM 2004 packages whose launch file is HTML, with
  `imsmanifest.xml` at the package root (or in a subfolder).
- Multi-page HTML courses and single-page JavaScript courses whose lesson
  text lives in data literals (see above).
- Local images in PNG, JPEG, GIF, WebP, SVG, AVIF.

Not supported (reported as an error or a clear in-app note, never silently
corrupted):

- Packages without a readable `imsmanifest.xml`.
- Flash, compiled binaries, or proprietary players with no HTML launch page.
- HTML generated inside JavaScript template strings, except the data
  literals listed above. Editing those by blind string replacement could
  break buttons, quizzes and navigation, so the editor does not offer it.
- Scoring keys, points, navigation order and SCORM logic — intentionally
  not editable.
- SVG illustrations drawn by JavaScript code (they are not image files).
- Image resizing and alignment controls, drag-and-drop reordering of
  lessons, and SCORM 2004 sequencing rules — not implemented in this version.
- The manifest is copied byte-for-byte on export, except when a *new*
  local image replaces an external one (see Images above).
- ZIP limits for safety: 100 MB ZIP, 500 MB total uncompressed, 20 MB per
  uploaded image. Path-traversal entries (`..`, absolute paths) are dropped.

### Reference course: SupBiotech Human Cell Culture

The editor was developed and tested against the SupBiotech
*Human Cell Culture Mini-MOOC* SCORM 1.2 package (v3.0) supplied for this
project. Verified directly against that ZIP (not from assumptions):

- Manifest ID `supbiotech_human_cell_culture_2026_v2_3`, SCORM 1.2,
  launch file `index.html`, 6 files in total.
- Local assets: `supbiotech-logo.png`, `theory_page8.png`,
  `theory_page11.png`, `culture_dish_reference.png`. Note:
  `theory_page8.png` and `theory_page11.png` are listed in the manifest
  but are **not referenced** by `index.html` (orphan assets); they are
  preserved untouched on export.
- 17 distinct external image URLs (Bio-Rad, ATCC, Wikimedia, SupBiotech,
  STEMCELL, Corning, ibidi, etc.), including the welcome image and the
  12 `readPhotos` entries.
- The course is a single-page JavaScript application: 12 lessons
  (`tasks`), 12 “Remember that…” summaries (`syntheses`), quiz items and
  questions stored as data, plus SCORM 1.2 tracking
  (`LMSInitialize`, `LMSSetValue('cmi.core.score.raw', …)`,
  `cmi.core.lesson_status`, `cmi.suspend_data`).

Round-trip test performed locally (see *Testing*): import → change a lesson
title (including an apostrophe, to check JS escaping) → rewrite a summary
with bold and red text → replace the external welcome image with a local
file → replace `culture_dish_reference.png` → export → reimport. Result:
manifest byte-identical, tracking code intact, orphan assets preserved,
edited strings present, reimported package editable again. The reference
course itself is **not** committed to this public repository.

**Not yet verified in a real LMS:** the exported reference package has been
validated structurally (manifest, files, reimport, JS data still parses),
but not yet imported into Moodle or another LMS in this environment. That
step is required before classroom use, and the app says so on export.

## Development

```bash
npm install
npm run dev      # local server
npm run test     # Vitest: manifest, JS literal parser, edits, ZIP round-trip, unsupported packages
npm run build    # TypeScript + Vite production build
```

Stack: React + TypeScript + Vite, Tailwind CSS v4, JSZip, DOMPurify.
The rich-text editor is a lightweight `contenteditable` component
(`src/components/RichTextEditor.tsx`) with the toolbar contract from the
spec (bold/italic, size, colour, highlight, alignment, headings, lists,
undo/redo) — no Tiptap dependency, by design, to keep the static bundle
small and the build dependency-free of a heavy editor framework.

Key modules:

- `src/lib/manifest.ts` — SCORM 1.2/2004 detection, launch file, validation.
- `src/lib/jsLiteral.ts` — position-aware, non-evaluating JS literal parser.
- `src/lib/editables.ts` — static HTML blocks, JS-data blocks, image refs,
  offset-safe edit application.
- `src/lib/scormPackage.ts` — JSZip import/export, preview builder
  (Blob-URL asset rewriting + SCORM API stub + click reporting), security limits.
- `src/lib/sample.ts` — synthetic demo course used by the app and the tests.

## Deployment

GitHub Actions (`.github/workflows/deploy.yml`) runs tests, builds, and
deploys `dist/` to GitHub Pages on every push to `main`. Vite is configured
with `base: '/scorm-mini-editor/'`. The repository's Pages source must be
set to *GitHub Actions* (done once in repository settings).

## Screenshots

No screenshots are included in this release: the build environment has no
browser to capture them from, and a fabricated screenshot would be worse
than none. Capture them from the live site after deployment (landing page,
editor with a course loaded, preview mode) and add them under `docs/`.

## Security notes

- Imported course scripts run only inside a sandboxed iframe
  (`allow-scripts`, no `allow-same-origin`, no `allow-top-navigation`).
- Imported HTML is never injected into the React app; the editor works on
  file text and on parsed string positions, not on a live DOM of the course.
- Rich HTML from the editor is sanitized with DOMPurify (allowlist of
  formatting tags; no `script`, `iframe`, `form` or `img` from editor input).
- ZIP entries are path-checked, size-limited, and SVGs are screened for
  scripts/event handlers before they enter a package.

## License

MIT — see `LICENSE`.
