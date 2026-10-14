/* Taakat — weigh-ins: one body weight per day, a 7-day average trend, and your latest weigh-in
   keeps the weight used for your calorie/protein targets up to date. Stored in kg; shown in kg or lb.
   Everything shown on screen uses textContent only. */
(function (root) {
  'use strict';
  var LB_PER_KG = 2.20462, MIN_KG = 30, MAX_KG = 300;

  function r1(n) { return Math.round(n * 10) / 10; }
  function r2(n) { return Math.round(n * 100) / 100; }
  function show1(n) { return r1(n).toFixed(1); }
  function toUnit(kg, unit) { return unit === 'lb' ? kg * LB_PER_KG : kg; }
  /* "72.4" / "72,4" / " 160 " in kg or lb → { kg } or { error } */
  function parseWeight(text, unit) {
    var t = String(text == null ? '' : text).trim().replace(',', '.');
    if (!t) return { error: 'Type your weight first.' };
    if (!/^\d{1,3}(\.\d{0,2})?$/.test(t)) return { error: 'Type your weight as a number, like ' + (unit === 'lb' ? '160.5' : '72.4') + '.' };
    var v = parseFloat(t), kg = unit === 'lb' ? v / LB_PER_KG : v;
    if (!(kg >= MIN_KG && kg <= MAX_KG)) {
      return { error: unit === 'lb' ? 'That doesn’t look right — enter between 67 and 661 lb.' : 'That doesn’t look right — enter between 30 and 300 kg.' };
    }
    return { kg: r2(kg) };
  }
  function isoMs(iso) { var p = String(iso).split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2], 12); }
  function daysApart(a, b) { return Math.round((isoMs(b) - isoMs(a)) / 86400000); }   // b − a
  /* entries [{ log_date, weight_kg }] → 7-day average on each weigh-in day (average of the weigh-ins in that day and the 6 before) */
  function avg7(entries) {
    var list = (entries || []).filter(function (e) { return e && isFinite(Number(e.weight_kg)); }).slice().sort(function (a, b) { return a.log_date < b.log_date ? -1 : 1; });
    return list.map(function (e) {
      var win = list.filter(function (o) { var d = daysApart(o.log_date, e.log_date); return d >= 0 && d <= 6; });
      var sum = win.reduce(function (s, o) { return s + Number(o.weight_kg); }, 0);
      return { x: e.log_date, y: sum / win.length };
    });
  }
  /* This week's average (today and the 6 days before) vs the week before. → { now, before, diff } (kg; null when not enough) */
  function weekChange(entries, today) {
    function avgIn(from, to) {
      var w = (entries || []).filter(function (e) { var d = daysApart(e.log_date, today); return d >= from && d <= to; });
      return w.length ? w.reduce(function (s, e) { return s + Number(e.weight_kg); }, 0) / w.length : null;
    }
    var now = avgIn(0, 6), before = avgIn(7, 13);
    return { now: now, before: before, diff: now !== null && before !== null ? now - before : null };
  }
  var pure = { parseWeight: parseWeight, avg7: avg7, weekChange: weekChange, toUnit: toUnit, LB_PER_KG: LB_PER_KG };

  /* ====================================================================== */
  function TaakatBody(api) {
    var $ = api.$, sb = api.sb, C = api.C;
    var list = [];            // your weigh-ins, newest first
    var loadedFor = null, loading = null, loadingFor = null, token = 0;
    var busy = {};

    function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
    function me() { return api.me().id; }
    function owner() { return api.owner ? api.owner().id : me(); }      // crew view: whose weigh-ins are shown
    function ro() { return !!(api.viewOnly && api.viewOnly()); }
    function unit() { var p = api.profile(); return p && p.body_unit === 'lb' ? 'lb' : 'kg'; }
    function fmt(kg, u) { u = u || unit(); return show1(toUnit(kg, u)) + ' ' + u; }
    function offline(id) { if (navigator.onLine) return false; api.setMsg(id, "You're offline. Connect to the internet and try again — nothing was lost."); return true; }
    function newest() { return list[0] || null; }

    function load(force) {
      var uid = owner();
      if (!force && loadedFor === uid) return Promise.resolve(list);
      if (!force && loading && loadingFor === uid) return loading;
      loadingFor = uid;
      var t = ++token;
      loading = sb.from('weigh_ins').select('id,log_date,weight_kg').eq('user_id', uid).order('log_date', { ascending: false }).limit(400)
        .then(function (res) {
          if (res.error) throw res.error;
          if (t === token && api.me() && owner() === uid) { list = (res.data || []).map(function (r) { return { id: r.id, log_date: r.log_date, weight_kg: Number(r.weight_kg) }; }); loadedFor = uid; }
          return list;
        }).finally(function () { if (t === token) loading = null; });
      return loading;
    }

    /* the little line on Today's Weight tile: weigh-ins of the last 30 days + this week vs last week */
    function drawSpark(today) {
      var box = $('to-weigh-spark'), note = $('to-weigh-change');
      if (!box || !note) return;
      box.textContent = ''; note.textContent = '';
      if (!today) return;
      var pts = list.filter(function (e) { var d = daysApart(e.log_date, today); return d >= 0 && d <= 30; }).slice().reverse();
      if (pts.length >= 2) {
        var W = 120, H = 28, ys = pts.map(function (e) { return e.weight_kg; });
        var lo = Math.min.apply(null, ys), hi = Math.max.apply(null, ys), span = hi - lo || 1;
        var x0 = isoMs(pts[0].log_date), xs = (isoMs(pts[pts.length - 1].log_date) - x0) || 1;
        var d = pts.map(function (e, i) {
          var x = 2 + (isoMs(e.log_date) - x0) / xs * (W - 4), y = 3 + (1 - (e.weight_kg - lo) / span) * (H - 6);
          return (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
        }).join(' ');
        var NS = 'http://www.w3.org/2000/svg', svg = document.createElementNS(NS, 'svg'), path = document.createElementNS(NS, 'path');
        svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H); svg.setAttribute('class', 'spark'); svg.setAttribute('focusable', 'false');
        path.setAttribute('d', d); svg.appendChild(path); box.appendChild(svg);
      }
      var wc = weekChange(list, today);
      if (wc.diff !== null) {
        var u = unit(), v = toUnit(Math.abs(wc.diff), u);
        note.textContent = r1(v) === 0 ? 'Steady vs last week' : (wc.diff < 0 ? '▼ ' : '▲ ') + show1(v) + ' ' + u + ' vs last week';
      }
    }

    /* the "Weight" tile on Today */
    function summary() {
      var sub = $('to-weigh-sub');
      load().then(function () {
        var n = newest(), today = C.localDate();
        if (!n) { drawSpark(null); sub.textContent = ro() ? api.ownerName() + ' hasn’t logged a weigh-in yet' : 'Log your weight to see your trend'; return; }
        var ago = daysApart(n.log_date, today);
        sub.textContent = fmt(n.weight_kg) + ' · ' + (ago <= 0 ? 'today' : ago === 1 ? 'yesterday' : ago + ' days ago');
        drawSpark(today);
      }).catch(function () { sub.textContent = 'Log your weight and see your trend'; drawSpark(null); });
    }

    /* ---------- the Weight screen ---------- */
    function open(note) {
      var view = ro();
      $('wi-title').textContent = view ? api.ownerName() + '’s weight' : 'Weight';
      $('wi-form').hidden = view; $('wi-intro').hidden = view;
      $('wi-empty').textContent = view ? api.ownerName() + ' hasn’t logged a weigh-in yet.' : 'No weigh-ins yet. Your trend shows up here after a few.';
      api.show('weigh');
      api.focusQuiet($('wi-title'));
      api.setMsg('wi-msg', note || '', 'ok');
      setUnitRadios();
      var today = C.localDate();
      $('wi-date').max = today; $('wi-date').min = '2020-01-01';
      $('wi-date').value = today;
      $('wi-weight').value = '';
      $('wi-list').textContent = '';
      $('wi-status').textContent = 'Loading your weigh-ins…'; $('wi-status').hidden = false;
      load(true).then(function () {
        if (api.current() !== 'weigh') return;
        $('wi-status').hidden = true;
        if (!ro()) fillForDate();
        draw();
      }).catch(function (e) {
        console.warn('Weigh-ins load failed:', e && (e.code || e.message));
        $('wi-status').textContent = api.friendly(e) + ' Your weigh-ins are safe — go back and try again.';
      });
    }
    function setUnitRadios() { Array.prototype.forEach.call(document.querySelectorAll('input[name="wi-unit"]'), function (r) { r.checked = r.value === unit(); }); $('wi-unit-label').textContent = unit(); }
    function entryOn(date) { return list.filter(function (e) { return e.log_date === date; })[0] || null; }
    function fillForDate() {
      var d = $('wi-date').value, e = entryOn(d), today = C.localDate();
      $('wi-weight').value = e ? show1(toUnit(e.weight_kg, unit())) : '';
      $('wi-weight-label').textContent = d === today ? 'Today’s weight' : 'Weight on ' + C.shortDate(d);
      $('wi-save').textContent = e ? (d === today ? 'Update today’s weight' : 'Update this weigh-in') : (d === today ? 'Save today’s weight' : 'Save this weigh-in');
    }
    $('wi-date').addEventListener('change', function () { api.setMsg('wi-msg', ''); if (/^\d{4}-\d{2}-\d{2}$/.test($('wi-date').value)) fillForDate(); });
    $('wi-weight').addEventListener('input', function () { api.setMsg('wi-msg', ''); $('wi-weight').removeAttribute('aria-invalid'); });

    function draw() {
      var u = unit(), today = C.localDate();
      var box = $('wi-chart'), readEl = $('wi-readout');
      var wc = weekChange(list, today);
      $('wi-trend').hidden = !list.length;
      $('wi-empty').hidden = !!list.length;
      if (list.length) {
        $('wi-avg').textContent = wc.now !== null ? fmt(wc.now, u) : fmt(newest().weight_kg, u);
        $('wi-avg-label').textContent = wc.now !== null ? '7-day average' : 'Latest weigh-in';
        var ch = $('wi-change');
        if (wc.diff === null) ch.textContent = ro() ? 'Not enough weigh-ins yet to compare weeks.' : (list.length < 3 ? 'Weigh in a few times a week to see a clear trend.' : 'Weigh in this week and next to compare weeks.');
        else if (Math.abs(toUnit(wc.diff, u)) < 0.05) ch.textContent = 'Same as the week before.';
        else ch.textContent = (wc.diff < 0 ? 'Down ' : 'Up ') + show1(Math.abs(toUnit(wc.diff, u))) + ' ' + u + ' vs the week before.';
        var pts = list.map(function (e) { return { x: e.log_date, y: r1(toUnit(e.weight_kg, u)), label: fmt(e.weight_kg, u) }; });
        var avg = avg7(list).map(function (p) { return { x: p.x, y: r1(toUnit(p.y, u)) }; });
        $('wi-legend').hidden = list.length < 2;
        if (root.TaakatChart) root.TaakatChart.line(box, {
          points: pts, line: list.length > 1 ? avg : null, readout: readEl,
          fmt: function (v) { return show1(v) + (arguments[1] ? '' : ' ' + u); },
          title: 'Your weigh-ins: ' + list.length + ', latest ' + fmt(newest().weight_kg, u) + (wc.now !== null ? ', 7-day average ' + fmt(wc.now, u) : '') + '.'
        });
      } else { box.textContent = ''; readEl.textContent = ''; }
      drawList();
    }
    function drawList() {
      var ul = $('wi-list'); ul.textContent = '';
      list.slice(0, 60).forEach(function (e) {
        var li = el('li', 'wi-row');
        var t = el('span', 'entry-text');
        t.appendChild(el('span', 'entry-name', fmt(e.weight_kg)));
        t.appendChild(el('span', 'entry-meta', C.dayName(e.log_date, C.localDate()) === 'Today' ? 'Today · ' + C.shortDate(e.log_date) : C.longDate(e.log_date)));
        li.appendChild(t);
        if (ro()) { ul.appendChild(li); return; }
        var del = el('button', 'btn-link danger-link wi-del', 'Delete'); del.type = 'button';
        del.setAttribute('aria-label', 'Delete weigh-in of ' + C.longDate(e.log_date));
        del.addEventListener('click', function () { removeEntry(e, del); });
        li.appendChild(del);
        ul.appendChild(li);
      });
      $('wi-more').hidden = list.length <= 60;
    }

    $('wi-units').addEventListener('change', function () {
      var r = document.querySelector('input[name="wi-unit"]:checked'); var u = r && r.value === 'lb' ? 'lb' : 'kg';
      if (busy.unit || u === unit()) return;
      var typed = parseWeight($('wi-weight').value, unit());
      busy.unit = true;
      api.setMsg('wi-msg', '');
      sb.from('profiles').update({ body_unit: u }).eq('id', me()).then(function (res) {
        if (res.error) throw res.error;
        api.profile().body_unit = u;
        $('wi-unit-label').textContent = u;
        if (typed.kg) $('wi-weight').value = show1(toUnit(typed.kg, u));
        draw(); summary();
      }).catch(function (e) {
        console.warn('Body unit save failed:', e && (e.code || e.message));
        setUnitRadios();
        api.setMsg('wi-msg', api.friendly(e));
      }).finally(function () { busy.unit = false; });
    });

    $('wi-form').addEventListener('submit', function (ev) {
      ev.preventDefault();
      if (ro()) return;
      if (busy.save) return;
      var d = $('wi-date').value, today = C.localDate();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || d > today || d < '2020-01-01') { api.setMsg('wi-msg', 'Pick a date from 2020 up to today.'); return; }
      var w = parseWeight($('wi-weight').value, unit());
      if (w.error) { api.setMsg('wi-msg', w.error); $('wi-weight').setAttribute('aria-invalid', 'true'); $('wi-weight').focus(); return; }
      if (offline('wi-msg')) return;
      busy.save = true;
      var b = $('wi-save'); api.setBusy(b, true, 'Saving…');
      var becomesNewest = !newest() || d >= newest().log_date;
      sb.from('weigh_ins').upsert({ user_id: me(), log_date: d, weight_kg: w.kg, updated_at: new Date().toISOString() }, { onConflict: 'user_id,log_date' }).select().single()
        .then(function (res) {
          if (res.error) throw res.error;
          var row = { id: res.data.id, log_date: res.data.log_date, weight_kg: Number(res.data.weight_kg) };
          list = list.filter(function (e) { return e.log_date !== row.log_date; }).concat([row]).sort(function (a, b) { return a.log_date < b.log_date ? 1 : -1; });
          $('wi-weight').blur();
          if (!becomesNewest) return 'Saved ' + fmt(row.weight_kg) + ' for ' + C.shortDate(d) + '.';
          return api.weightChanged(row.weight_kg).then(function () {
            return 'Saved ' + fmt(row.weight_kg) + '. Your calorie and protein targets now use it.';
          }, function () {
            return 'Saved ' + fmt(row.weight_kg) + '. Your targets will catch up the next time you open the app.';
          });
        }).then(function (note) {
          draw(); summary();
          api.setMsg('wi-msg', note, 'ok');
        }).catch(function (e) {
          console.warn('Weigh-in save failed:', e && (e.code || e.message));
          api.setMsg('wi-msg', api.friendly(e) + ' Nothing was saved — try again.');
        }).finally(function () {
          busy.save = false; api.setBusy(b, false);
          delete b.dataset.label;            // the button's wording depends on the date, so don't restore the old one
          var typed = $('wi-weight').value; fillForDate();
          if (!$('wi-msg').classList.contains('ok') && typed) $('wi-weight').value = typed;   // keep what you typed if it failed
        });
    });

    var delTimer = null;
    function removeEntry(e, b) {
      if (ro()) return;
      if (busy.del) return;
      if (b.dataset.armed !== '1') {
        Array.prototype.forEach.call(document.querySelectorAll('.wi-del'), function (x) { x.dataset.armed = ''; x.textContent = 'Delete'; });
        b.dataset.armed = '1'; b.textContent = 'Tap again to delete';
        clearTimeout(delTimer); delTimer = setTimeout(function () { if (b.isConnected) { b.dataset.armed = ''; b.textContent = 'Delete'; } }, 4000);
        return;
      }
      if (offline('wi-msg')) return;
      busy.del = true;
      var wasNewest = newest() && newest().id === e.id;
      sb.from('weigh_ins').delete().eq('id', e.id).then(function (res) {
        if (res.error) throw res.error;
        list = list.filter(function (x) { return x.id !== e.id; });
        if (wasNewest && newest()) return api.weightChanged(newest().weight_kg).catch(function () {});
      }).then(function () {
        fillForDate(); draw(); summary();
        api.setMsg('wi-msg', 'Deleted the weigh-in from ' + C.shortDate(e.log_date) + '.', 'ok');
      }).catch(function (err) {
        console.warn('Weigh-in delete failed:', err && (err.code || err.message));
        api.setMsg('wi-msg', api.friendly(err) + ' Nothing was deleted.');
      }).finally(function () { busy.del = false; });
    }
    $('wi-back').addEventListener('click', function () { api.back(); });

    return {
      open: open, summary: summary, load: load,
      all: function () { return list.slice(); },
      clear: function () { list = []; loadedFor = null; loading = null; token++; busy = {}; }
    };
  }

  TaakatBody.pure = pure;
  if (typeof module !== 'undefined' && module.exports) module.exports = pure;
  else root.TaakatBody = TaakatBody;
})(this);
