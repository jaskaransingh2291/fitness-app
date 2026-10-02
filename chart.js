/* Taakat — a small line chart drawn by the app itself (no chart library, nothing loaded from other websites).
   Used for an exercise's heaviest weight and for weigh-ins. Colours come from styles.css classes (.ch-*),
   so the line is always the person's own colour. Tap or drag on the chart to read any point. */
(function (root) {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';
  var DAY = 86400000;
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function ms(iso) { var p = String(iso).split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2], 12); }
  function shortDay(iso, withYear) {
    var p = String(iso).split('-');
    return MONTHS[+p[1] - 1] + ' ' + (+p[2]) + (withYear ? ', ' + p[0] : '');
  }
  /* 3–4 round tick values covering [lo, hi] */
  function niceTicks(lo, hi) {
    if (!(isFinite(lo) && isFinite(hi))) return [];
    if (hi - lo < 1e-9) { var pad = Math.max(1, Math.abs(hi) * 0.05); lo -= pad; hi += pad; }
    var raw = (hi - lo) / 3, mag = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / mag;
    var step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * mag;
    var start = Math.floor(lo / step) * step, end = Math.ceil(hi / step) * step, out = [];
    for (var v = start; v <= end + step / 2 && out.length < 8; v += step) out.push(Math.round(v * 1000) / 1000);
    return out;
  }
  var pure = { niceTicks: niceTicks, shortDay: shortDay };

  function el(tag, attrs, parent) {
    var e = document.createElementNS(NS, tag);
    Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    if (parent) parent.appendChild(e);
    return e;
  }

  /* box: an empty element. opts:
     points  [{ x: 'YYYY-MM-DD', y: number, label?: string }]  the main series (dots)
     line    optional [{ x, y }] drawn as the coloured line instead of joining the dots (e.g. 7-day average)
     fmt     y → text (e.g. "155 lb")
     title   accessible description of the whole chart
     readout element that shows the point being read (defaults to the newest)            */
  function line(box, opts) {
    box.textContent = '';
    var pts = (opts.points || []).filter(function (p) { return p && isFinite(p.y); }).slice().sort(function (a, b) { return a.x < b.x ? -1 : 1; });
    var ln = opts.line ? opts.line.filter(function (p) { return p && isFinite(p.y); }).slice().sort(function (a, b) { return a.x < b.x ? -1 : 1; }) : null;
    var fmt = opts.fmt || function (v) { return String(v); };
    if (!pts.length) return null;
    var W = Math.max(240, Math.round(box.clientWidth || 320)), H = opts.height || 180;
    var L = 46, R = 14, T = 12, B = 26;
    var all = pts.concat(ln || []);
    var ys = all.map(function (p) { return p.y; });
    var ticks = niceTicks(Math.min.apply(null, ys), Math.max.apply(null, ys));
    var y0 = ticks[0], y1 = ticks[ticks.length - 1];
    var x0 = ms(pts[0].x), x1 = ms(pts[pts.length - 1].x);
    if (ln && ln.length) { x0 = Math.min(x0, ms(ln[0].x)); x1 = Math.max(x1, ms(ln[ln.length - 1].x)); }
    var single = x1 - x0 < DAY / 2;
    function X(iso) { return single ? (L + (W - L - R) / 2) : L + (ms(iso) - x0) / (x1 - x0) * (W - L - R); }
    function Y(v) { return T + (1 - (v - y0) / (y1 - y0 || 1)) * (H - T - B); }

    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, width: W, height: H, 'class': 'ch', role: 'img', 'aria-label': opts.title || 'Chart' });
    var g = el('g', { 'aria-hidden': 'true' }, svg);
    ticks.forEach(function (t) {
      el('line', { x1: L, x2: W - R, y1: Y(t), y2: Y(t), 'class': 'ch-grid' }, g);
      var tx = el('text', { x: L - 8, y: Y(t) + 4, 'class': 'ch-tick', 'text-anchor': 'end' }, g);
      tx.textContent = fmt(t, true);
    });
    var withYear = !single && (x1 - x0) > 300 * DAY;
    var first = el('text', { x: single ? X(pts[0].x) : L, y: H - 6, 'class': 'ch-tick', 'text-anchor': single ? 'middle' : 'start' }, g);
    first.textContent = shortDay(pts[0].x, withYear);
    if (!single) { var last = el('text', { x: W - R, y: H - 6, 'class': 'ch-tick', 'text-anchor': 'end' }, g); last.textContent = shortDay(pts[pts.length - 1].x, withYear); }

    var main = ln && ln.length ? ln : pts;
    if (main.length > 1) {
      var d = main.map(function (p, i) { return (i ? 'L' : 'M') + X(p.x).toFixed(1) + ' ' + Y(p.y).toFixed(1); }).join(' ');
      el('path', { d: d, 'class': 'ch-line' }, g);
    }
    var showAll = pts.length <= Math.floor((W - L - R) / 9);
    var dots = el('g', {}, g);
    pts.forEach(function (p, i) {
      if (!showAll && i !== pts.length - 1) return;
      el('circle', { cx: X(p.x), cy: Y(p.y), r: 4, 'class': ln ? 'ch-dot ch-dot-muted' : 'ch-dot' }, dots);
    });
    // the point being read
    var cross = el('line', { x1: 0, x2: 0, y1: T, y2: H - B, 'class': 'ch-cross' }, g);
    var focus = el('circle', { cx: 0, cy: 0, r: 6, 'class': 'ch-focus' }, g);
    var hit = el('rect', { x: L - 10, y: 0, width: W - L - R + 20, height: H, 'class': 'ch-hit' }, svg);

    function read(i, active) {
      var p = pts[i];
      cross.setAttribute('x1', X(p.x)); cross.setAttribute('x2', X(p.x));
      focus.setAttribute('cx', X(p.x)); focus.setAttribute('cy', Y(p.y));
      cross.classList.toggle('on', !!active); focus.classList.toggle('on', true);
      if (opts.readout) opts.readout.textContent = (active ? '' : 'Latest · ') + shortDay(p.x, withYear) + ' · ' + (p.label || fmt(p.y));
    }
    function nearest(clientX) {
      var r = svg.getBoundingClientRect();
      var x = (clientX - r.left) * (W / (r.width || W)), best = 0, bd = Infinity;
      pts.forEach(function (p, i) { var dd = Math.abs(X(p.x) - x); if (dd < bd) { bd = dd; best = i; } });
      return best;
    }
    hit.addEventListener('pointerdown', function (e) { read(nearest(e.clientX), true); });
    hit.addEventListener('pointermove', function (e) { if (e.pointerType === 'mouse' || e.buttons) read(nearest(e.clientX), true); });
    hit.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse') read(pts.length - 1, false); });
    read(pts.length - 1, false);
    box.appendChild(svg);
    return { svg: svg, read: read, count: pts.length };
  }

  var api = { line: line, pure: pure };
  if (typeof module !== 'undefined' && module.exports) module.exports = pure;
  else root.TaakatChart = api;
})(this);
