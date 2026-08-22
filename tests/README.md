# Unit tests for ISO_5807_v5.html

A single self-contained suite that drives the editor in headless Chromium and
verifies every feature: palette, shape placement (click and drag-drop), node
movement in Select and Connect modes, flowline creation, text editing,
auto-size, undo/redo, delete, clear, zoom, the inspector, SVG/PNG/JSON export,
JSON import, Save to PDF, the lossless PDF → editor round-trip, rejection of
foreign/non-PDF files, and the memory monitor.

## Run

```bash
npm install playwright   # downloads Chromium on first install
node tests/unit_test.js
```

Exit code 0 means all tests passed. Each check prints `PASS`/`FAIL` with a
description; the summary line at the end shows the totals (currently 46 checks).

## About the PDF round-trip

`Save to PDF` writes a real vector PDF generated entirely in the browser, and
embeds the flowchart's JSON inside the file. `Open PDF` reads that data back,
so a PDF saved by this editor is a complete, editable copy of the flowchart —
users never need to handle `.json` files directly. PDFs from other programs
(Visio exports, scans) contain no such data and are declined with an
explanation, since interpreting arbitrary PDF drawings would require heavy
PDF-interpretation/OCR tooling that cannot run inside an offline single-file
web app.
