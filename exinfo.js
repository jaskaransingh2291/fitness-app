/* Taakat — Stage 5c: one exercise's page (what it works, how to do it safely, a "watch how" link).
   Progress for the exercise is added to this page in the next stage.
   Everything shown on screen uses textContent only. */
(function (root) {
  'use strict';

  /* YouTube search for good-form videos. Only the exercise name goes in the link (nothing about you). */
  function videoUrl(name) {
    var q = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    return 'https://www.youtube.com/results?search_query=' + encodeURIComponent((q || 'exercise') + ' proper form');
  }
  /* "Chest — upper & lower fibres; Front Delts (anterior deltoid)" → ['Chest — upper & lower fibres', 'Front Delts (anterior deltoid)'] */
  function muscleList(text) {
    return String(text || '').split(';').map(function (s) { return s.replace(/\s+/g, ' ').trim(); })
      .filter(function (s) { return s && !/^[—–\-.\s]*$/.test(s); }).slice(0, 12);   // "—" in the sheet means "none"
  }
  /* "Chest · Barbell · Compound · Beginner · one side at a time" */
  function metaLine(x) {
    if (!x) return '';
    var bits = [x.g, x.eq, x.mv, x.lv];
    if (x.one) bits.push('one side at a time');
    if (x.custom) bits.push('your own exercise');
    return bits.filter(function (b) { return typeof b === 'string' ? b.trim() : !!b; }).join(' · ');
  }

  /* ---------- progress (Stage 5c-2) ---------- */
  var LB_PER_KG = 2.20462;
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function r1(n) { return Math.round(n * 10) / 10; }
  function toUnit(w, from, unit) {
    if (w === null || w === undefined || w === '' || !isFinite(Number(w))) return null;
    w = Number(w); from = from === 'kg' ? 'kg' : 'lb';
    return r1(from === unit ? w : (unit === 'kg' ? w / LB_PER_KG : w * LB_PER_KG));
  }
  function num(n) { var v = r1(n); return (v % 1 === 0 ? v.toFixed(0) : v.toFixed(1)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function clock(sec) { sec = Math.round(sec); var m = Math.floor(sec / 60), s = sec % 60; return m + ':' + (s < 10 ? '0' : '') + s; }
  function day(iso) { var p = String(iso).split('-'); return MONTHS[+p[1] - 1] + ' ' + (+p[2]); }
  /* sessions: [{ date: 'YYYY-MM-DD', sets: [{ weight, weight_unit, reps, duration_sec }] }]
     tt: tracking type · unit: 'lb' | 'kg'
     → { kind: 'weight'|'reps'|'time'|'', points: [{ x, y, label }], bests: [{ k, v, date }], change: text, workouts: n } */
  function progress(sessions, tt, unit) {
    unit = unit === 'kg' ? 'kg' : 'lb';
    var byDate = {};
    (sessions || []).forEach(function (s) {
      if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(String(s.date))) return;
      var sets = (s.sets || []).map(function (x) {
        var reps = parseInt(x.reps, 10), dur = parseInt(x.duration_sec, 10);
        return { w: toUnit(x.weight, x.weight_unit, unit), reps: reps >= 0 ? reps : null, sec: dur >= 0 ? dur : null };
      }).filter(function (x) { return x.w !== null || x.reps !== null || x.sec !== null; });
      if (!sets.length) return;
      (byDate[s.date] = byDate[s.date] || []).push.apply(byDate[s.date], sets);
    });
    var dates = Object.keys(byDate).sort();
    var out = { kind: '', points: [], bests: [], change: '', workouts: dates.length };
    if (!dates.length) return out;
    var hasWeight = dates.some(function (d) { return byDate[d].some(function (x) { return x.w > 0; }); });
    var kind = (tt === 'time') ? 'time' : (tt === 'bodyweight_reps' ? 'reps' : (hasWeight ? 'weight' : (tt === 'weight_time' ? 'time' : 'reps')));
    out.kind = kind;
    var U = ' ' + unit;
    function better(a, b, keyA, keyB) { return !b || a[keyA] > b[keyA] || (a[keyA] === b[keyA] && (a[keyB] || 0) > (b[keyB] || 0)); }
    var heavy = null, mostReps = null, bestSet = null, longest = null, bestDayReps = null, bestDayTime = null;
    dates.forEach(function (d) {
      var sets = byDate[d], top = null, dayReps = 0, daySec = 0;
      sets.forEach(function (x) {
        var c = { w: x.w || 0, reps: x.reps || 0, sec: x.sec || 0, date: d, vol: (x.w || 0) * (x.reps || 0) };
        dayReps += c.reps; daySec += c.sec;
        if (kind === 'weight') { if (better(c, top, 'w', tt === 'weight_time' ? 'sec' : 'reps')) top = c; }
        else if (kind === 'reps') { if (better(c, top, 'reps', 'w')) top = c; }
        else if (better(c, top, 'sec', 'w')) top = c;
        if (better(c, heavy, 'w', tt === 'weight_time' ? 'sec' : 'reps')) heavy = c;
        if (better(c, mostReps, 'reps', 'w')) mostReps = c;
        if (c.vol > 0 && better(c, bestSet, 'vol', 'w')) bestSet = c;
        if (better(c, longest, 'sec', 'w')) longest = c;
      });
      if (!bestDayReps || dayReps > bestDayReps.n) bestDayReps = { n: dayReps, date: d };
      if (!bestDayTime || daySec > bestDayTime.n) bestDayTime = { n: daySec, date: d };
      var y = kind === 'weight' ? top.w : (kind === 'reps' ? top.reps : top.sec);
      var label = kind === 'weight' ? num(top.w) + U + (tt === 'weight_time' ? (top.sec ? ' · ' + clock(top.sec) : '') : (top.reps ? ' × ' + top.reps : ''))
        : (kind === 'reps' ? top.reps + (top.reps === 1 ? ' rep' : ' reps') + (top.w ? ' · +' + num(top.w) + U : '') : clock(top.sec) + (top.w ? ' · ' + num(top.w) + U : ''));
      out.points.push({ x: d, y: y, label: label });
    });
    if (kind === 'weight' && tt === 'weight_time') {
      out.bests.push({ k: 'Heaviest weight', v: num(heavy.w) + U + (heavy.sec ? ' · ' + clock(heavy.sec) : ''), date: heavy.date });
      if (longest && longest.sec) out.bests.push({ k: 'Longest time', v: clock(longest.sec) + (longest.w ? ' at ' + num(longest.w) + U : ''), date: longest.date });
    } else if (kind === 'weight') {
      out.bests.push({ k: 'Heaviest weight', v: num(heavy.w) + U + (heavy.reps ? ' × ' + heavy.reps : ''), date: heavy.date });
      if (mostReps && mostReps.reps) out.bests.push({ k: 'Most reps in one set', v: mostReps.reps + ' reps' + (mostReps.w ? ' at ' + num(mostReps.w) + U : ''), date: mostReps.date });
      if (bestSet) out.bests.push({ k: 'Best set', v: num(bestSet.w) + U + ' × ' + bestSet.reps, sub: num(bestSet.vol) + U + ' in one set', date: bestSet.date });
    } else if (kind === 'reps') {
      out.bests.push({ k: 'Most reps in one set', v: mostReps.reps + (mostReps.reps === 1 ? ' rep' : ' reps'), date: mostReps.date });
      if (bestDayReps && bestDayReps.n > mostReps.reps) out.bests.push({ k: 'Most reps in one workout', v: bestDayReps.n + ' reps', date: bestDayReps.date });
    } else {
      out.bests.push({ k: 'Longest time', v: clock(longest.sec), date: longest.date });
      if (bestDayTime && bestDayTime.n > longest.sec) out.bests.push({ k: 'Most time in one workout', v: clock(bestDayTime.n), date: bestDayTime.date });
    }
    if (out.points.length > 1) {
      var a = out.points[0], b = out.points[out.points.length - 1], diff = b.y - a.y;
      var amount = kind === 'weight' ? num(Math.abs(diff)) + U : (kind === 'reps' ? Math.abs(diff) + (Math.abs(diff) === 1 ? ' rep' : ' reps') : clock(Math.abs(diff)));
      out.change = Math.abs(diff) < 0.05 ? 'Same as on ' + day(a.x) : (diff > 0 ? 'Up ' : 'Down ') + amount + ' since ' + day(a.x);
    }
    return out;
  }

  var pure = { videoUrl: videoUrl, muscleList: muscleList, metaLine: metaLine, progress: progress, clock: clock };

  /* ====================================================================== */
  function TaakatExInfo(api) {
    var $ = api.$;
    var back = null;            // { label, go(), y } — where Back returns to
    var showing = null;         // the exercise on screen

    function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

    /* x = an exercise from the list (or your own); opts = { backLabel, onBack } */
    function open(x, opts) {
      if (!x) return;
      opts = opts || {};
      back = { label: opts.backLabel || '‹ Back', go: opts.onBack || null, y: window.scrollY || 0 };
      showing = x;
      $('ei-back').textContent = back.label;
      $('ei-title').textContent = x.n;
      var meta = metaLine(x);
      $('ei-meta').textContent = meta; $('ei-meta').hidden = !meta;

      // what it works
      var main = String(x.p || '').trim(), helpers = muscleList(x.s);
      $('ei-muscles').hidden = !main && !helpers.length;
      $('ei-main').textContent = main || '—';
      $('ei-main-row').hidden = !main;
      var hl = $('ei-helpers'); hl.textContent = '';
      helpers.forEach(function (h) { hl.appendChild(el('li', null, h)); });
      $('ei-helpers-row').hidden = !helpers.length;

      // do it safely
      var tips = Array.isArray(x.pre) ? x.pre.filter(function (t) { return typeof t === 'string' && t.trim(); }).slice(0, 12) : [];
      var tl = $('ei-tips'); tl.textContent = '';
      tips.forEach(function (t) { tl.appendChild(el('li', null, t)); });
      $('ei-safe').hidden = !tips.length;

      $('ei-own').hidden = !(x.custom || (!main && !tips.length));
      $('ei-own').textContent = x.custom
        ? 'You added this exercise yourself, so Taakat has no muscle notes or safety tips for it.'
        : 'Taakat has no muscle notes or safety tips for this one yet.';

      var v = $('ei-video');
      v.href = videoUrl(x.n);
      loadProgress(x);

      api.show('exinfo');
      api.focusQuiet($('ei-title'));
    }
    /* ---------- your progress with this exercise ---------- */
    var progToken = 0;
    function progMsg(text, retry) {
      var box = $('ei-prog-body'); box.textContent = '';
      box.appendChild(el('p', 'muted small ei-prog-msg', text));
      if (retry) { var b = el('button', 'btn-link', 'Try again'); b.type = 'button'; b.addEventListener('click', retry); box.appendChild(b); }
    }
    function loadProgress(x) {
      var token = ++progToken, sb = api.sb, uid = api.me() && api.me().id;
      $('ei-prog').hidden = false;
      $('ei-prog-change').hidden = true; $('ei-readout').hidden = true;
      progMsg('Loading your progress…');
      if (!sb || !uid) { progMsg('Log in to see your progress.'); return; }
      sb.from('workout_exercises').select('id,session_id,tracking_type').eq('user_id', uid).eq('exercise_ref', x.id)
        .order('created_at', { ascending: false }).limit(300)
        .then(function (r1) {
          if (r1.error) throw r1.error;
          var wex = r1.data || [];
          if (!wex.length) return [wex, [], []];
          var sids = wex.map(function (w) { return w.session_id; }).filter(function (v, i, a) { return a.indexOf(v) === i; });
          return Promise.all([
            sb.from('workout_sessions').select('id,session_date').in('id', sids),
            sb.from('workout_sets').select('workout_exercise_id,weight,weight_unit,reps,duration_sec').in('workout_exercise_id', wex.map(function (w) { return w.id; })).limit(5000)
          ]).then(function (r) {
            if (r[0].error) throw r[0].error;
            if (r[1].error) throw r[1].error;
            return [wex, r[0].data || [], r[1].data || []];
          });
        }).then(function (all) {
          if (token !== progToken || showing !== x) return;
          var dateOf = {}; all[1].forEach(function (s) { dateOf[s.id] = s.session_date; });
          var setsBy = {}; all[2].forEach(function (st) { (setsBy[st.workout_exercise_id] = setsBy[st.workout_exercise_id] || []).push(st); });
          var sessions = all[0].map(function (w) { return { date: dateOf[w.session_id], sets: setsBy[w.id] || [] }; });
          var tt = x.tt || (all[0][0] && all[0][0].tracking_type) || 'weight_reps';
          drawProgress(progress(sessions, tt, api.unit()), x);
        }).catch(function (e) {
          if (token !== progToken) return;
          console.warn('Progress load failed:', e && (e.code || e.message));
          progMsg(api.friendly(e) + ' Your workouts are safe.', function () { loadProgress(x); });
        });
    }
    function drawProgress(p, x) {
      var box = $('ei-prog-body'); box.textContent = '';
      if (!p.points.length) { progMsg('No sets logged for this one yet. After your first workout with it, your progress shows here.'); return; }
      var what = p.kind === 'weight' ? 'Heaviest weight each workout' : (p.kind === 'reps' ? 'Most reps in one set, each workout' : 'Longest time each workout');
      $('ei-prog-what').textContent = what;
      var chg = $('ei-prog-change'); chg.textContent = p.change; chg.hidden = !p.change;
      var ro = $('ei-readout'); ro.hidden = false;
      var cbox = el('div', 'ei-chart'); box.appendChild(cbox);
      var u = api.unit();
      var fmt = p.kind === 'weight' ? function (v, tick) { return tick ? num(v) : num(v) + ' ' + u; } : (p.kind === 'reps' ? function (v, tick) { return tick ? String(Math.round(v)) : v + ' reps'; } : function (v) { return clock(v); });
      var title = what + ' for ' + x.n + ': ' + p.points.length + (p.points.length === 1 ? ' workout' : ' workouts') + ', latest ' + p.points[p.points.length - 1].label + (p.change ? '. ' + p.change : '') + '.';
      if (root.TaakatChart) root.TaakatChart.line(cbox, { points: p.points, fmt: fmt, title: title, readout: ro });
      if (p.points.length === 1) box.appendChild(el('p', 'muted small ei-prog-msg', 'Do it again in another workout to start seeing a trend.'));
      var ul = el('ul', 'ei-bests');
      p.bests.forEach(function (b) {
        var li = el('li');
        li.appendChild(el('span', 'ei-best-k', b.k));
        var v = el('span', 'ei-best-v', b.v);
        li.appendChild(v);
        li.appendChild(el('span', 'ei-best-d', (b.sub ? b.sub + ' · ' : '') + day(b.date)));
        ul.appendChild(li);
      });
      box.appendChild(ul);
    }

    $('ei-back').addEventListener('click', function () {
      var b = back; showing = null;
      if (b && b.go) { b.go(); try { window.scrollTo(0, b.y || 0); } catch (e) { /* ignore */ } }
      else api.fallback();
    });

    return {
      open: open,
      showing: function () { return showing; },
      unitsChanged: function () { if (showing && api.current() === 'exinfo') loadProgress(showing); },
      clear: function () { back = null; showing = null; progToken++; }
    };
  }

  TaakatExInfo.pure = pure;
  if (typeof module !== 'undefined' && module.exports) module.exports = pure;
  else root.TaakatExInfo = TaakatExInfo;
})(this);
