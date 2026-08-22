#!/usr/bin/env node
/*
 * pdf2json.js — best-effort converter: vector flowchart PDF -> editor JSON
 *
 * Works on born-digital PDFs (Visio / Word / draw.io exports) by extracting
 * the vector geometry and text with pdf.js — no OCR involved. Scanned PDFs
 * (images of flowcharts) are NOT supported: they contain no vectors or text.
 *
 * Usage:
 *   npm install pdfjs-dist@3.11.174
 *   node tools/pdf2json.js input.pdf output.json
 *
 * The result is a heuristic reconstruction: shapes and their text transfer
 * well; connector direction is inferred and may need touch-up in the editor.
 */
const fs = require('fs');
const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');
const OPS = pdfjs.OPS;

const [, , IN, OUT] = process.argv;
if (!IN || !OUT) { console.error('usage: node tools/pdf2json.js input.pdf output.json'); process.exit(2); }

const mul = (a, b) => [
  a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3],
  a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3],
  a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5]];
const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

(async () => {
  const data = new Uint8Array(fs.readFileSync(IN));
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise;
  const pg = await doc.getPage(1);
  const vp = pg.getViewport({ scale: 1 });
  const pageH = vp.height;

  // ── walk the operator list, tracking the transform stack ──
  const ops = await pg.getOperatorList();
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [];
  const paths = []; // {pts:[[x,y]..], closed, painted:'fill'|'stroke'|'both', curved}
  let pending = null;

  const PAINT = {
    [OPS.fill]: 'fill', [OPS.eoFill]: 'fill', [OPS.stroke]: 'stroke',
    [OPS.closeStroke]: 'stroke', [OPS.fillStroke]: 'both',
    [OPS.eoFillStroke]: 'both', [OPS.closeFillStroke]: 'both',
  };

  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i], args = ops.argsArray[i];
    if (fn === OPS.save) stack.push(ctm.slice());
    else if (fn === OPS.restore) ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
    else if (fn === OPS.transform) ctm = mul(args, ctm);
    else if (fn === OPS.constructPath) {
      const [pops, pargs] = args;
      const subs = []; let cur = null; let curved = false; let k = 0; let closed = false;
      for (const p of pops) {
        if (p === OPS.moveTo) { cur = []; subs.push(cur); cur.push(apply(ctm, pargs[k], pargs[k + 1])); k += 2; }
        else if (p === OPS.lineTo) { cur && cur.push(apply(ctm, pargs[k], pargs[k + 1])); k += 2; }
        else if (p === OPS.curveTo) { curved = true; cur && cur.push(apply(ctm, pargs[k + 4], pargs[k + 5])); k += 6; }
        else if (p === OPS.curveTo2 || p === OPS.curveTo3) { curved = true; cur && cur.push(apply(ctm, pargs[k + 2], pargs[k + 3])); k += 4; }
        else if (p === OPS.closePath) closed = true;
        else if (p === OPS.rectangle) {
          const [x, y, w, h] = [pargs[k], pargs[k + 1], pargs[k + 2], pargs[k + 3]]; k += 4;
          subs.push([apply(ctm, x, y), apply(ctm, x + w, y), apply(ctm, x + w, y + h), apply(ctm, x, y + h)]);
          closed = true;
        }
      }
      pending = { subs, closed, curved };
    } else if (pending && PAINT[fn]) {
      for (const pts of pending.subs)
        if (pts.length >= 2) paths.push({ pts, closed: pending.closed || pts.length > 4, painted: PAINT[fn], curved: pending.curved });
      pending = null;
    } else if (pending && (fn === OPS.clip || fn === OPS.eoClip || fn === OPS.endPath)) {
      pending = null; // clip regions are not drawings
    }
  }

  // ── classify closed painted paths into flowchart shapes ──
  const bboxOf = pts => {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
  };
  const dedupe = pts => {
    const out = [];
    for (const p of pts) {
      const q = out[out.length - 1];
      if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 1.5) out.push(p);
    }
    if (out.length > 1) {
      const a = out[0], b = out[out.length - 1];
      if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1.5) out.pop();
    }
    return out;
  };

  const shapes = [], connectors = [], arrowheads = [];
  for (const p of paths) {
    const bb = bboxOf(p.pts);
    const area = bb.w * bb.h;
    const pageArea = vp.width * vp.height;
    if (p.closed && p.painted !== 'stroke') {
      const v = dedupe(p.pts);
      if (area < 40) continue;
      if (area < 400 && v.length <= 5) { arrowheads.push(bb); continue; } // filled arrow tips
      if (area > pageArea * 0.5) continue; // page background
      let type = 'process';
      if (p.curved) type = bb.w / bb.h > 1.6 ? 'terminal' : 'onpage';
      else if (v.length === 4) {
        const onAxis = v.filter(([x, y]) =>
          Math.abs(x - (bb.x0 + bb.w / 2)) < bb.w * 0.15 || Math.abs(y - (bb.y0 + bb.h / 2)) < bb.h * 0.15).length;
        type = onAxis === 4 ? 'decision' : 'process';
      } else if (v.length >= 7 && v.length <= 9) type = 'terminal'; // octagon
      shapes.push({ bb, type, area });
    } else if (!p.closed || p.painted === 'stroke') {
      const v = dedupe(p.pts);
      if (v.length >= 2 && area < pageArea * 0.5) {
        const len = Math.hypot(v[v.length - 1][0] - v[0][0], v[v.length - 1][1] - v[0][1]);
        if (len > 8) connectors.push({ a: v[0], b: v[v.length - 1] });
      }
    }
  }

  // drop shapes fully inside a bigger shape (double-borders, drop shadows)
  shapes.sort((a, b) => b.area - a.area);
  const kept = [];
  for (const s of shapes) {
    const inside = kept.some(k =>
      s.bb.x0 >= k.bb.x0 - 3 && s.bb.x1 <= k.bb.x1 + 3 &&
      s.bb.y0 >= k.bb.y0 - 3 && s.bb.y1 <= k.bb.y1 + 3 &&
      s.area > k.area * 0.55);
    if (!inside) kept.push(s);
  }

  // ── text: attach to containing shape, else keep for edge labels ──
  const tc = await pg.getTextContent();
  const texts = tc.items
    .filter(t => t.str.trim())
    .map(t => ({ str: t.str, x: t.transform[4], y: t.transform[5], size: Math.hypot(t.transform[1], t.transform[3]) }));
  const loose = [];
  for (const t of texts) {
    const owner = kept.find(s => t.x >= s.bb.x0 - 2 && t.x <= s.bb.x1 + 2 && t.y >= s.bb.y0 - 2 && t.y <= s.bb.y1 + 2);
    if (owner) (owner.texts = owner.texts || []).push(t);
    else loose.push(t);
  }

  // ── build nodes ──
  const nodes = kept.map((s, i) => {
    let text = '';
    if (s.texts) {
      s.texts.sort((a, b) => (b.y - a.y) || (a.x - b.x)); // top-to-bottom (PDF y-up)
      const lines = []; let last = null;
      for (const t of s.texts) {
        if (last !== null && Math.abs(t.y - last) < 2) lines[lines.length - 1] += (lines[lines.length - 1].endsWith(' ') || t.str.startsWith(' ') ? '' : ' ') + t.str;
        else lines.push(t.str);
        last = t.y;
      }
      text = lines.map(l => l.trim()).filter(Boolean).join('\n');
    }
    return {
      id: 'n' + (i + 1), type: s.type,
      x: Math.round(s.bb.x0), y: Math.round(pageH - s.bb.y1),
      w: Math.round(s.bb.w), h: Math.round(s.bb.h),
      text, font: 'Calibri,Arial,sans-serif', size: 8,
      bold: false, italic: false, under: false, margin: 4,
    };
  });

  // ── connectors -> edges (nearest shape at each end; arrowhead end = target) ──
  const nearIdx = (x, y, maxD) => {
    let best = -1, bd = maxD * maxD;
    kept.forEach((s, i) => {
      const dx = Math.max(s.bb.x0 - x, 0, x - s.bb.x1), dy = Math.max(s.bb.y0 - y, 0, y - s.bb.y1);
      const d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = i; }
    });
    return best;
  };
  const hasArrowNear = (x, y) => arrowheads.some(a =>
    x >= a.x0 - 8 && x <= a.x1 + 8 && y >= a.y0 - 8 && y <= a.y1 + 8);

  const edges = []; const seen = new Set(); let eid = 1;
  for (const c of connectors) {
    let ia = nearIdx(c.a[0], c.a[1], 25), ib = nearIdx(c.b[0], c.b[1], 25);
    if (ia < 0 || ib < 0 || ia === ib) continue;
    if (hasArrowNear(c.a[0], c.a[1]) && !hasArrowNear(c.b[0], c.b[1])) [ia, ib] = [ib, ia];
    const key = ia + '>' + ib;
    if (seen.has(key)) continue;
    seen.add(key);
    // label: loose text near the connector midpoint
    const mx = (c.a[0] + c.b[0]) / 2, my = (c.a[1] + c.b[1]) / 2;
    let label = '';
    let ld = 30 * 30;
    for (const t of loose) {
      const d = (t.x - mx) ** 2 + (t.y - my) ** 2;
      if (d < ld && t.str.trim().length <= 12) { ld = d; label = t.str.trim(); }
    }
    edges.push({ id: 'e' + (eid++), from: 'n' + (ia + 1), to: 'n' + (ib + 1), label });
  }

  // normalize origin
  if (nodes.length) {
    const minx = Math.min(...nodes.map(n => n.x)) - 60;
    const miny = Math.min(...nodes.map(n => n.y)) - 60;
    nodes.forEach(n => { n.x -= minx; n.y -= miny; });
  }

  fs.writeFileSync(OUT, JSON.stringify({ nodes, edges }, null, 1));
  console.error(`${IN.split('/').pop()}: ${nodes.length} nodes, ${edges.length} edges ` +
    `(from ${paths.length} vector paths, ${texts.length} text runs, ${connectors.length} line segments)`);
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
