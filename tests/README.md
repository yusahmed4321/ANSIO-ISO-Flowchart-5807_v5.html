# Unit tests for ISO_5807_v5.html

A single self-contained suite that drives the editor in headless Chromium and
verifies every feature: palette, shape placement (click and drag-drop), node
movement in Select and Connect modes, flowline creation, text editing,
auto-size, undo/redo, delete, clear, zoom, the inspector, SVG/PNG/JSON export,
JSON import, Save to PDF, the lossless PDF → editor round-trip, rejection of
foreign/non-PDF files, Visio (.vsdx) import (using a synthetic .vsdx the test
builds itself), and the memory monitor.

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
contain no such data and are declined with an explanation.

## Importing flowcharts from other programs

- **Visio `.vsdx` files** import directly in the editor via the `⤒ Visio`
  button — no OCR and no libraries: a `.vsdx` is a ZIP of XML, which the
  browser unpacks itself (`DecompressionStream` + `DOMParser`). Shapes, text,
  sizes, positions, and glued connections convert deterministically; unglued
  connector ends are matched to the nearest shape.
- **Vector PDFs from other tools** (Visio/Word/draw.io exports) can be
  converted offline with `tools/pdf2json.js`, which extracts the vector
  geometry and text with pdf.js (open-source, no OCR) and reconstructs a
  best-effort chart: `node tools/pdf2json.js input.pdf output.json`, then
  Import the JSON in the editor.
- **Scanned PDFs** (photos/images of flowcharts) contain no vectors or text;
  recovering a chart from them needs OCR + computer-vision tooling
  (e.g. Tesseract + OpenCV) and is out of scope for this project.
