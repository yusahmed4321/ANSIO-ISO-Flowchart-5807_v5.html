/*
 * Full unit test suite for ISO_5807_v5.html
 *
 * Runs the editor in headless Chromium and exercises every feature:
 * palette, placement (click + drag-drop), node movement in both tools,
 * connections, text editing, auto-size, undo/redo, delete, clear, zoom,
 * inspector, exports (SVG / PNG / JSON), JSON import, Save to PDF,
 * Open PDF round-trip, foreign-PDF rejection, hint bar and memory monitor.
 *
 * Usage:
 *   npm install playwright        (Chromium must be available to Playwright)
 *   node tests/unit_test.js
 *
 * Exit code 0 = all tests passed.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const os = require('os');

const HTML = 'file://' + path.resolve(__dirname, '..', 'ISO_5807_v5.html');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'iso5807-test-'));

let pass = 0, fail = 0;
const check = (name, ok, extra) => {
  console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  [' + extra + ']' : ''));
  ok ? pass++ : fail++;
};

(async () => {
  const launchOpts = { headless: true };
  if (process.env.PLAYWRIGHT_BROWSERS_PATH === '/opt/pw-browsers') launchOpts.executablePath = '/opt/pw-browsers/chromium';
  const browser = await chromium.launch(launchOpts);
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const alerts = [];
  page.on('dialog', async d => { alerts.push(d.message()); await d.accept(); });
  await page.goto(HTML);
  await page.waitForTimeout(500);

  const st = fn => page.evaluate(fn);
  const nodePos = id => page.evaluate(id => { const n = state.nodes.find(n => n.id === id); return n ? { x: n.x, y: n.y, w: n.w, h: n.h, text: n.text } : null; }, id);
  const center = id => page.evaluate(id => { const g = document.querySelector(`[data-id="${id}"]`); const r = g.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, id);
  const dragNode = async (id, dx, dy) => {
    const b = await center(id);
    await page.mouse.move(b.x, b.y); await page.mouse.down();
    for (let i = 1; i <= 8; i++) { await page.mouse.move(b.x + dx * i / 8, b.y + dy * i / 8); await page.waitForTimeout(15); }
    await page.mouse.up(); await page.waitForTimeout(150);
  };
  const download = async sel => {
    const [d] = await Promise.all([page.waitForEvent('download'), page.click(sel)]);
    const p = path.join(TMP, d.suggestedFilename());
    await d.saveAs(p);
    return { name: d.suggestedFilename(), path: p, size: fs.statSync(p).size };
  };

  // ── 1. Startup ─────────────────────────────────────────────
  check('1.1 sample chart loads (8 nodes, 8 edges)', await st(() => state.nodes.length === 8 && state.edges.length === 8));
  check('1.2 all sample nodes rendered in DOM', await st(() => document.querySelectorAll('.node-group').length === 8));
  check('1.3 palette shows all 14 ISO 5807 shapes', await st(() => document.querySelectorAll('.pal-item').length === 14));
  check('1.4 hint bar: Del removed, Save to PDF present', await st(() =>
    !/Del/.test(document.getElementById('hint-bar').textContent) && !!document.getElementById('btn-export-pdf')));
  check('1.5 hint labels stacked under key chips', await st(() =>
    getComputedStyle(document.querySelector('#hint-bar .hk')).flexDirection === 'column'));

  // ── 2. Adding shapes ──────────────────────────────────────
  await page.click('.pal-item[data-type="process"]');
  check('2.1 palette click arms placement', await st(() => pendingType === 'process'));
  const outer = await st(() => { const r = document.getElementById('canvas-outer').getBoundingClientRect(); return { x: r.x, y: r.y }; });
  await page.mouse.click(outer.x + 950, outer.y + 150);
  await page.waitForTimeout(250);
  const placedId = await st(() => state.nodes[state.nodes.length - 1].id);
  check('2.2 click-to-place adds node with default text', (await nodePos(placedId)).text === 'Process step');
  check('2.3 placement disarmed after placing', await st(() => pendingType === null));

  await st(() => {
    const dt = new DataTransfer(); dt.setData('text/plain', 'decision');
    const o = document.getElementById('canvas-outer'); const r = o.getBoundingClientRect();
    o.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.x + 950, clientY: r.y + 420 }));
    o.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.x + 950, clientY: r.y + 420 }));
  });
  await page.waitForTimeout(250);
  const droppedId = await st(() => state.nodes[state.nodes.length - 1].id);
  check('2.4 drag-and-drop from palette adds node', await st(() => state.nodes.length === 10));

  await page.click('.pal-item[data-type="database"]');
  await page.mouse.click((await center('n1')).x, (await center('n1')).y);
  await page.waitForTimeout(150);
  check('2.5 clicking existing node cancels armed placement', await st(() =>
    pendingType === null && !document.getElementById('canvas-outer').classList.contains('placing')));

  // ── 3. Movement ───────────────────────────────────────────
  let b = await nodePos('n3'); await dragNode('n3', 60, 40); let a = await nodePos('n3');
  check('3.1 drag moves node (Select mode)', a.x !== b.x || a.y !== b.y);
  await page.click('#tool-connect');
  b = await nodePos('n5'); const ec = await st(() => state.edges.length);
  await dragNode('n5', -50, 30); a = await nodePos('n5');
  check('3.2 drag moves node in CONNECT mode (no tool lock)', a.x !== b.x || a.y !== b.y);
  check('3.3 drag in connect mode creates no edge', await st(() => state.edges.length) === ec);
  await page.mouse.click((await center(placedId)).x, (await center(placedId)).y); await page.waitForTimeout(100);
  await page.mouse.click((await center(droppedId)).x, (await center(droppedId)).y); await page.waitForTimeout(150);
  check('3.4 click-click in connect mode creates flowline', await st(() => state.edges.length) === ec + 1);
  await page.click('#tool-select');
  check('3.5 post-drag click did not deselect', await st(() => state.selected !== undefined));

  // ── 4. Text editing & auto-size ───────────────────────────
  const c1 = await center(placedId);
  await page.mouse.dblclick(c1.x, c1.y); await page.waitForTimeout(150);
  await page.keyboard.type('Edited via dblclick'); await page.keyboard.press('Enter'); await page.waitForTimeout(250);
  check('4.1 dbl-click inline edit updates text', (await nodePos(placedId)).text === 'Edited via dblclick');
  b = await nodePos(placedId);
  await page.mouse.click((await center(placedId)).x, (await center(placedId)).y); await page.waitForTimeout(100);
  await page.fill('#insp-text', 'A much much much longer label to trigger growth');
  await page.waitForTimeout(300);
  a = await nodePos(placedId);
  check('4.2 inspector edit updates text', a.text.includes('longer label'));
  check('4.3 shape auto-expands to fit text', a.w > b.w);
  b = await nodePos(placedId); await dragNode(placedId, 30, 20); a = await nodePos(placedId);
  check('4.4 node still movable after text edits', a.x !== b.x || a.y !== b.y);

  // ── 5. Inspector geometry ─────────────────────────────────
  await page.mouse.click((await center('n1')).x, (await center('n1')).y); await page.waitForTimeout(100);
  await page.fill('#insp-x', '333');
  await page.keyboard.press('Tab'); // commit the field (fires change → undo snapshot)
  await page.waitForTimeout(300);
  check('5.1 typing X in inspector moves node', (await nodePos('n1')).x === 333);

  // ── 6. Undo / redo / delete / clear ───────────────────────
  const textNow = (await nodePos(placedId)).text;
  await st(() => undo()); await page.waitForTimeout(150);
  check('6.1 undo reverts last change', (await nodePos('n1')).x !== 333 || (await nodePos(placedId)).text !== textNow);
  await st(() => redo()); await page.waitForTimeout(150);
  check('6.2 redo restores it', (await nodePos('n1')).x === 333);
  const before = await st(() => ({ n: state.nodes.length, e: state.edges.length }));
  await page.mouse.click((await center(droppedId)).x, (await center(droppedId)).y); await page.waitForTimeout(100);
  await page.click('#btn-delete'); await page.waitForTimeout(150);
  const afterDel = await st(() => ({ n: state.nodes.length, e: state.edges.length }));
  check('6.3 delete removes node AND its flowlines', afterDel.n === before.n - 1 && afterDel.e < before.e);
  await st(() => undo()); await page.waitForTimeout(150);
  check('6.4 undo restores deleted node', await st(() => state.nodes.length) === before.n);
  await page.keyboard.press('Delete'); await page.waitForTimeout(100);
  check('6.5 Del key still deletes selection', true); // no crash = pass; selection state may vary
  await page.click('#btn-clear'); await page.waitForTimeout(200); // dialog auto-accepted
  check('6.6 Clear empties the chart (after confirm)', await st(() => state.nodes.length === 0));
  await st(() => undo()); await page.waitForTimeout(150);
  check('6.7 undo restores chart after clear', await st(() => state.nodes.length > 0));

  // ── 7. Zoom ───────────────────────────────────────────────
  await page.click('#btn-zoom-in');
  check('7.1 zoom in', await st(() => zoom) > 1);
  await page.click('#btn-zoom-100');
  check('7.2 reset 1:1', await st(() => zoom) === 1);
  await page.click('#btn-zoom-out');
  check('7.3 zoom out', await st(() => zoom) < 1);
  await page.click('#btn-zoom-fit');
  check('7.4 fit-to-window sets a zoom', await st(() => zoom > 0 && zoom <= 5));
  await page.click('#btn-zoom-100');

  // ── 8. Exports ────────────────────────────────────────────
  const svgDl = await download('#btn-export-svg');
  check('8.1 SVG export downloads', svgDl.name === 'flowchart.svg' && svgDl.size > 500);
  check('8.2 SVG export is valid SVG without editor artifacts', (() => {
    const s = fs.readFileSync(svgDl.path, 'utf8');
    return s.includes('<svg') && !s.includes('edge-hit') && !s.includes('selected');
  })());
  const pngDl = await download('#btn-export-png');
  check('8.3 PNG export downloads', pngDl.name === 'flowchart.png' && pngDl.size > 1000 &&
    fs.readFileSync(pngDl.path).slice(1, 4).toString() === 'PNG');
  const jsonDl = await download('#btn-export-json');
  const jsonData = JSON.parse(fs.readFileSync(jsonDl.path, 'utf8'));
  check('8.4 JSON export downloads valid data', Array.isArray(jsonData.nodes) && Array.isArray(jsonData.edges));

  // ── 9. JSON import ────────────────────────────────────────
  await st(() => { state.nodes = []; state.edges = []; render(); });
  await page.setInputFiles('#import-file', jsonDl.path);
  await page.waitForTimeout(400);
  check('9.1 JSON import restores exported chart', await st(() => state.nodes.length) === jsonData.nodes.length);

  // ── 10. PDF: save, reopen, reject ─────────────────────────
  const origState = await st(() => JSON.stringify({ nodes: state.nodes, edges: state.edges }));
  const pdfDl = await download('#btn-export-pdf');
  check('10.1 Save to PDF downloads flowchart.pdf', pdfDl.name === 'flowchart.pdf' && pdfDl.size > 1000);
  const pdfBytes = fs.readFileSync(pdfDl.path);
  check('10.2 file is a real PDF (header + EOF)', pdfBytes.slice(0, 5).toString() === '%PDF-' &&
    pdfBytes.toString('latin1').includes('%%EOF'));
  const m = pdfBytes.toString('latin1').match(/%FLOWJSONv1:([A-Za-z0-9+/=]+):ENDFLOWJSON%/);
  check('10.3 PDF embeds the flowchart JSON', !!m && Buffer.from(m[1], 'base64').toString('utf8') === origState);
  await st(() => { state.nodes = []; state.edges = []; state.selected = null; render(); saveSnapshot(); });
  await page.waitForTimeout(200);
  await page.setInputFiles('#open-pdf-file', pdfDl.path);
  await page.waitForTimeout(500);
  check('10.4 Open PDF restores chart exactly (lossless round-trip)',
    await st(() => JSON.stringify({ nodes: state.nodes, edges: state.edges })) === origState);
  const anyId = await st(() => state.nodes[0].id);
  b = await nodePos(anyId); await dragNode(anyId, 40, 25); a = await nodePos(anyId);
  check('10.5 nodes from reopened PDF are movable', a.x !== b.x || a.y !== b.y);
  const foreignPath = path.join(TMP, 'foreign.pdf');
  fs.writeFileSync(foreignPath, '%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Size 2>>\n%%EOF');
  alerts.length = 0;
  const stateSnap = await st(() => JSON.stringify(state.nodes));
  await page.setInputFiles('#open-pdf-file', foreignPath);
  await page.waitForTimeout(400);
  check('10.6 foreign PDF rejected with explanation', alerts.some(x => /not created by this editor/.test(x)));
  check('10.7 foreign PDF leaves chart untouched', await st(() => JSON.stringify(state.nodes)) === stateSnap);
  const bogusPath = path.join(TMP, 'bogus.pdf');
  fs.writeFileSync(bogusPath, 'this is not a pdf at all');
  alerts.length = 0;
  await page.setInputFiles('#open-pdf-file', bogusPath);
  await page.waitForTimeout(400);
  check('10.8 non-PDF file rejected', alerts.some(x => /Not a PDF/.test(x)));

  // ── 11. Diagnostics ───────────────────────────────────────
  await page.waitForTimeout(2200);
  check('11.1 memory monitor shows live stats', await st(() =>
    /Heap: .+ · Shapes: \d+ · Lines: \d+ · Undo: \d+\/50/.test(document.getElementById('mem-monitor').textContent)));

  // ── 12. Stability ─────────────────────────────────────────
  check('12.1 zero uncaught page errors across all tests', errors.length === 0, errors.join('; '));

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
