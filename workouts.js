/* Taakat — Stage 5a: workouts (start a workout, add exercises, log sets live, finish, history).
   Everything shown to the screen uses textContent only (never HTML). */
(function (root) {
  'use strict';

  var GROUPS = ['Chest', 'Shoulders', 'Back', 'Biceps', 'Triceps', 'Legs', 'Abs', 'Forearms'];
  var TRACK = {
    weight_reps: { w: true, r: true, t: false, label: 'Weight & reps' },
    bodyweight_reps: { w: false, r: true, t: false, label: 'Reps only' },
    time: { w: false, r: false, t: true, label: 'Time' },
    weight_time: { w: true, r: false, t: true, label: 'Weight & time' }
  };
  var LB_PER_KG = 2.20462;
  var MAX_SETS = 50, MAX_EXERCISES = 40;
  // The gym staples rank a little higher when a search word matches them (e.g. "bench" → Barbell Bench Press first).
  var POPULAR = { EX001: 1, EX100: 1, EX047: 1, EX056: 1, EX024: 1, EX052: 1, EX049: 1, EX068: 1, EX070: 1, EX113: 1, EX106: 1, EX032: 1, EX062: 1, EX005: 1, EX004: 1, EX102: 1, EX018: 1 };
  var ALIASES = { db: 'dumbbell', dbs: 'dumbbell', bb: 'barbell', ohp: 'overhead press', rdl: 'romanian deadlift', bench: 'bench', abs: 'abs', ab: 'abs',
    pullup: 'pull-up', pullups: 'pull-up', chinup: 'chin-up', pushup: 'push-up', pushups: 'push-up', situp: 'sit-up', lats: 'lat', tri: 'triceps', bi: 'biceps', quad: 'quads', ham: 'hamstring', hammy: 'hamstring' };

  function norm(s) { return String(s || '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim(); }
  function convert(w, from, to) {
    if (w === null || w === undefined || w === '') return null;
    w = Number(w);
    if (!isFinite(w)) return null;
    if (!from || !to || from === to) return w;
    return to === 'kg' ? w / LB_PER_KG : w * LB_PER_KG;
  }
  function round1(n) { return Math.round(n * 10) / 10; }
  function fmtW(n) { var v = round1(Number(n) || 0); return v % 1 === 0 ? v.toFixed(0) : v.toFixed(1); }
  function fmtTime(sec) {
    sec = Math.round(Number(sec) || 0);
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    if (h) return h + ':' + (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }
  /* "90", "1:30", "1:02:00" → seconds, or null */
  function parseTime(text) {
    var t = String(text == null ? '' : text).trim();
    if (!t) return null;
    if (/^\d{1,5}$/.test(t)) return parseInt(t, 10);
    var m = /^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/.exec(t);
    if (!m) return null;
    if (m[3] !== undefined) { if (+m[2] > 59 || +m[3] > 59) return null; return (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]); }
    if (+m[2] > 59) return null;
    return (+m[1]) * 60 + (+m[2]);
  }
  function parseReps(text) {
    var t = String(text == null ? '' : text).trim();
    if (!/^\d{1,4}$/.test(t)) return null;
    return parseInt(t, 10);
  }

  /* Search the exercise list. Every word must match somewhere; the name counts most. */
  function prepareExercises(list) {
    list.forEach(function (e) {
      e._name = norm(e.n);
      e._hay = norm([e.n, e.g, e.a, e.eq, e.ppl].join(' '));
    });
    return list;
  }
  function searchExercises(list, q, group, limit) {
    var words = norm(q).split(' ').filter(Boolean).map(function (w) { return ALIASES[w] ? norm(ALIASES[w]) : w; });
    var whole = norm(q);
    var out = [];
    list.forEach(function (e) {
      if (group && group !== 'all' && e.g !== group) return;
      if (!words.length) { out.push({ e: e, s: 0 }); return; }
      var score = 0;
      for (var i = 0; i < words.length; i++) {
        var w = words[i];
        var inName = (' ' + e._name + ' ').indexOf(' ' + w) !== -1;
        var inHay = (' ' + e._hay + ' ').indexOf(' ' + w) !== -1 || e._hay.indexOf(w) !== -1;
        if (!inName && !inHay) return;
        score += inName ? 10 : 3;
        if ((' ' + e._name + ' ').indexOf(' ' + w + ' ') !== -1) score += 4;
      }
      if (e._name.indexOf(whole) === 0) score += 8;
      if ((' ' + e._name + ' ').indexOf(' ' + whole + ' ') !== -1) score += 12;
      if (POPULAR[e.id]) score += 9;
      if (e.custom) score += 6;           // your own exercises: you named them, you probably want them
      if (e.lv === 'Beginner') score += 1;
      score -= e._name.length / 100;
      out.push({ e: e, s: score });
    });
    out.sort(function (a, b) { return b.s - a.s || (a.e._name < b.e._name ? -1 : 1); });
    return { total: out.length, items: out.slice(0, limit || 60).map(function (x) { return x.e; }) };
  }

  /* One saved set as words, in the unit you use: "135 × 8", "12 reps", "1:30", "50 lb × 0:45" */
  function setText(s, tt, unit) {
    var tr = TRACK[tt] || TRACK.weight_reps;
    var w = tr.w && s.weight != null ? fmtW(convert(s.weight, s.weight_unit || 'lb', unit)) : null;
    if (tr.w && tr.r) return (w != null ? w : '–') + ' × ' + (s.reps != null ? s.reps : '–');
    if (tr.r) return (s.reps != null ? s.reps : '–') + ' reps';
    if (tr.w && tr.t) return (w != null ? w + ' ' + unit + ' × ' : '') + fmtTime(s.duration_sec);
    return fmtTime(s.duration_sec);
  }
  /* Totals for a workout. exs: [{ tt, sets: [saved set rows] }] */
  function summarise(exs, unit) {
    var t = { exercises: 0, sets: 0, volume: 0, reps: 0 };
    exs.forEach(function (x) {
      var n = (x.sets || []).length;
      if (n) t.exercises++;
      t.sets += n;
      (x.sets || []).forEach(function (s) {
        if (s.reps != null) t.reps += Number(s.reps) || 0;
        if ((TRACK[x.tt] || TRACK.weight_reps).w && s.weight != null && s.reps != null) t.volume += convert(s.weight, s.weight_unit || 'lb', unit) * Number(s.reps);
      });
    });
    t.volume = Math.round(t.volume);
    return t;
  }
  function minutesBetween(a, b) {
    var x = Date.parse(a), y = Date.parse(b);
    if (!isFinite(x) || !isFinite(y) || y < x) return null;
    var m = Math.round((y - x) / 60000);
    return m > 0 && m <= 6 * 60 ? m : null;   // longer than 6 h = forgot to finish; don't show a silly time
  }

  /* Which history group a workout date falls in. Weeks start on Monday.
     → { key, label }: 'This week', 'Last week', then 'Earlier in October' / 'September' / 'December 2025'. */
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  function historyGroup(iso, today) {
    function d(x) { var p = String(x).split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2], 12); }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso)) || !/^\d{4}-\d{2}-\d{2}$/.test(String(today))) return { key: 'other', label: 'Earlier' };
    var t = d(today), x = d(iso), day = 86400000;
    var monday = t - ((new Date(t).getUTCDay() + 6) % 7) * day;
    if (x >= monday) return { key: 'w0', label: 'This week' };
    if (x >= monday - 7 * day) return { key: 'w1', label: 'Last week' };
    var y = +iso.slice(0, 4), m = +iso.slice(5, 7), ty = +today.slice(0, 4), tm = +today.slice(5, 7);
    var key = 'm' + iso.slice(0, 7);
    if (y === ty && m === tm) return { key: key, label: 'Earlier in ' + MONTHS[m - 1] };
    return { key: key, label: MONTHS[m - 1] + (y !== ty ? ' ' + y : '') };
  }

  var pure = { GROUPS: GROUPS, TRACK: TRACK, convert: convert, fmtW: fmtW, fmtTime: fmtTime, parseTime: parseTime, parseReps: parseReps,
    prepareExercises: prepareExercises, searchExercises: searchExercises, setText: setText, summarise: summarise, minutesBetween: minutesBetween,
    historyGroup: historyGroup };

  /* ====================================================================== */
  function TaakatWorkouts(api) {
    var $ = api.$, C = api.C, sb = api.sb;
    var library = null, libraryLoading = null;
    var customs = [];            // the person's own exercises (custom_exercises rows)
    var session = null;          // workout_sessions row on screen
    var exs = [];                // exercises in it: { id, ref, name, group, tt, position, eq, one, note, rows: [...], last: [...] }
    var sessToken = 0, listToken = 0;
    var groupOpen = {};          // history groups you opened or closed (key → true/false)
    var pickerFor = null;        // session id the exercise picker adds to
    var busy = {};               // guards against double taps per action

    function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
    function radio(name) { var r = document.querySelector('input[name="' + name + '"]:checked'); return r ? r.value : ''; }
    function setRadio(name, v) { Array.prototype.forEach.call(document.querySelectorAll('input[name="' + name + '"]'), function (r) { r.checked = r.value === v; }); }
    function unit() { var p = api.profile(); return p && p.weight_unit === 'kg' ? 'kg' : 'lb'; }
    function fmt(n) { return Math.round(Number(n) || 0).toLocaleString('en-CA'); }
    function me() { return api.me().id; }
    /* Crew view: whose workouts are on screen (you, or someone sharing with you — then everything is view only). */
    function owner() { return api.owner ? api.owner().id : me(); }
    function ro() { return !!(api.viewOnly && api.viewOnly()); }
    function offline(msgId) { if (navigator.onLine) return false; api.setMsg(msgId, "You're offline. Connect to the internet and try again — nothing was lost."); return true; }
    function timeOfDay(iso) { try { return new Date(iso).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' }); } catch (e) { return ''; } }
    function dayText(iso) { var t = C.localDate(); var n = C.dayName(iso, t); return n === 'Today' || n === 'Yesterday' ? n + ' · ' + C.shortDate(iso) : C.shortDate(iso); }

    function loadLibrary() {
      if (library) return Promise.resolve(library);
      if (libraryLoading) return libraryLoading;
      libraryLoading = window.fetch('exercises.json?v=' + encodeURIComponent(api.version)).then(function (r) {
        if (!r.ok) throw new Error('exercises ' + r.status);
        return r.json();
      }).then(function (j) {
        if (!j || !Array.isArray(j.exercises)) throw new Error('exercise file broken');
        library = prepareExercises(j.exercises);
        return library;
      }).catch(function (e) { libraryLoading = null; throw e; });
      return libraryLoading;
    }
    function loadCustoms() {
      return sb.from('custom_exercises').select('id,name,muscle_group,equipment,tracking_type').eq('user_id', me()).order('name', { ascending: true }).limit(500)
        .then(function (res) {
          if (res.error) throw res.error;
          customs = (res.data || []).map(customToEx);
          return customs;
        });
    }
    function customToEx(c) {
      return prepareExercises([{ id: 'C' + c.id, n: c.name, g: c.muscle_group, a: '', eq: c.equipment || '', tt: TRACK[c.tracking_type] ? c.tracking_type : 'weight_reps', custom: true, lv: '' }])[0];
    }
    function findEx(ref) {
      var all = (library || []).concat(customs);
      for (var i = 0; i < all.length; i++) if (all[i].id === ref) return all[i];
      return null;
    }

    /* ======================= Workouts tab ======================= */
    function open(note) {
      var token = ++listToken;
      api.show('workouts');
      api.setMsg('wo-msg', note || '', 'ok');
      var view = ro();
      $('wo-active').hidden = true; $('wo-start').hidden = view;
      $('wo-exlib').hidden = view;                 // exercise pages stay personal
      $('wo-title').textContent = view ? api.ownerName() + '’s training' : 'Training';
      $('wo-title').classList.toggle('wo-title-who', view);
      if (api.cover && api.cover()) api.cover().paintHero();
      var spBox = $('wo-split'); spBox.textContent = ''; var ld = el('p', 'muted small', 'Loading your split…'); spBox.appendChild(ld);
      $('wo-list').textContent = '';
      $('wo-empty').hidden = true;
      $('wo-status').textContent = view ? 'Loading ' + api.ownerName() + '’s workouts…' : 'Loading your workouts…'; $('wo-status').hidden = false;
      $('wo-empty').textContent = view ? api.ownerName() + ' hasn’t logged any workouts yet.' : 'No workouts yet — they’ll show up here once you’ve done one.';
      api.setMsg('wo-err', ''); $('wo-retry').hidden = true;
      var uid = owner();
      sb.from('workout_sessions').select('id,session_date,started_at,finished_at,notes,split_day').eq('user_id', uid)
        .order('session_date', { ascending: false }).order('started_at', { ascending: false }).limit(30)
        .then(function (res) {
          if (token !== listToken) return null;
          if (res.error) throw res.error;
          var rows = res.data || [];
          var ids = rows.map(function (r) { return r.id; });
          if (!ids.length) return [rows, [], []];
          return sb.from('workout_exercises').select('id,session_id,exercise_name,tracking_type').in('session_id', ids).then(function (r2) {
            if (r2.error) throw r2.error;
            var eids = (r2.data || []).map(function (x) { return x.id; });
            if (!eids.length) return [rows, r2.data || [], []];
            return sb.from('workout_sets').select('workout_exercise_id,weight,weight_unit,reps,duration_sec').in('workout_exercise_id', eids).limit(5000).then(function (r3) {
              if (r3.error) throw r3.error;
              return [rows, r2.data || [], r3.data || []];
            });
          });
        }).then(function (all) {
          if (!all || token !== listToken) return;
          renderList(all[0], all[1], all[2]);
        }).catch(function (e) {
          if (token !== listToken) return;
          console.warn('Workouts load failed:', e && (e.code || e.message));
          $('wo-status').hidden = true;
          if (api.splits()) api.splits().renderBlock(false);
          api.setMsg('wo-err', api.friendly(e) + ' Your workouts are safe.');
          $('wo-retry').hidden = false;
        });
    }
    function renderList(rows, wex, sets) {
      $('wo-status').hidden = true;
      var u = unit();
      var setsBy = {}; sets.forEach(function (s) { (setsBy[s.workout_exercise_id] = setsBy[s.workout_exercise_id] || []).push(s); });
      var exBy = {}; wex.forEach(function (x) { (exBy[x.session_id] = exBy[x.session_id] || []).push({ tt: x.tracking_type, sets: setsBy[x.id] || [] }); });
      var active = null;
      if (!ro()) rows.forEach(function (r) { if (!r.finished_at && (!active || r.started_at > active.started_at)) active = r; });
      if (active) {
        $('wo-active').hidden = false; $('wo-start').hidden = true;
        var n = (exBy[active.id] || []).length;
        var stale = Date.now() - Date.parse(active.started_at) > 12 * 3600 * 1000;
        $('wo-active-title').textContent = stale ? 'Unfinished workout' : 'Workout in progress';
        $('wo-active-sub').textContent = (stale ? dayText(active.session_date) + ' · ' : 'Started ' + timeOfDay(active.started_at) + ' · ') + n + (n === 1 ? ' exercise' : ' exercises');
        $('wo-continue').onclick = function () { openSession(active.id); };
      }
      if (api.splits()) api.splits().renderBlock(!!active);
      var list = $('wo-list'); list.textContent = '';
      var done = rows.filter(function (r) { return r !== active; });
      $('wo-empty').hidden = done.length > 0;
      // Group by This week / Last week / month. Only the newest group starts open; your taps are remembered until you sign out.
      var groups = [], byKey = {}, today = C.localDate();
      done.forEach(function (r) {
        var g = historyGroup(r.session_date, today);
        if (!byKey[g.key]) { byKey[g.key] = { key: g.key, label: g.label, rows: [] }; groups.push(byKey[g.key]); }
        byKey[g.key].rows.push(r);
      });
      groups.forEach(function (g, gi) {
        var gli = el('li', 'wo-group');
        var h = el('h4', 'wo-group-h');
        var hb = el('button', 'wo-group-btn'); hb.type = 'button'; hb.id = 'wo-g-' + gi;
        var lab = el('span', 'wo-group-label', g.label);
        lab.appendChild(el('span', 'wo-group-count', ' · ' + g.rows.length + (g.rows.length === 1 ? ' workout' : ' workouts')));
        hb.appendChild(lab);
        var c = el('span', 'chev'); c.setAttribute('aria-hidden', 'true'); hb.appendChild(c);
        h.appendChild(hb); gli.appendChild(h);
        var ul = el('ul', 'wo-group-list'); ul.id = 'wo-gl-' + gi;
        hb.setAttribute('aria-controls', ul.id);
        var isOpen = g.key in groupOpen ? groupOpen[g.key] : gi === 0;
        function set(o) { hb.setAttribute('aria-expanded', o ? 'true' : 'false'); ul.hidden = !o; }
        set(isOpen);
        hb.addEventListener('click', function () { var o = hb.getAttribute('aria-expanded') !== 'true'; groupOpen[g.key] = o; set(o); });
        g.rows.forEach(function (r) { ul.appendChild(historyRow(r, exBy, u)); });
        gli.appendChild(ul); list.appendChild(gli);
      });
    }
    function historyRow(r, exBy, u) {
      var t = summarise(exBy[r.id] || [], u);
      var li = el('li');
      var b = el('button', 'wo-item'); b.type = 'button';
      var left = el('span', 'entry-text');
      left.appendChild(el('span', 'entry-name', dayText(r.session_date) + (r.split_day ? ' · ' + r.split_day : '')));
      var bits = [t.exercises + (t.exercises === 1 ? ' exercise' : ' exercises'), t.sets + (t.sets === 1 ? ' set' : ' sets')];
      var mins = minutesBetween(r.started_at, r.finished_at);
      if (mins) bits.push(mins + ' min');
      left.appendChild(el('span', 'entry-meta', bits.join(' · ')));
      if (!r.finished_at) left.appendChild(el('span', 'wk-flag', 'Not finished'));
      b.appendChild(left);
      var right = el('span', 'wo-vol');
      right.textContent = t.volume ? fmt(t.volume) : '–';
      right.appendChild(el('small', null, t.volume ? u + ' lifted' : ''));
      b.appendChild(right);
      b.setAttribute('aria-label', C.longDate(r.session_date) + (r.split_day ? ', ' + r.split_day : '') + ': ' + bits.join(', ') + (t.volume ? ', ' + fmt(t.volume) + ' ' + u + ' lifted' : '') + '. Open.');
      b.addEventListener('click', function () { openSession(r.id); });
      li.appendChild(b);
      return li;
    }
    $('wo-retry').addEventListener('click', function () { open(''); });

    function startWorkout() {
      if (ro()) return;   // never change someone else's workout
      if (busy.start) return;
      if (offline('wo-err')) return;
      busy.start = true;
      var btn = $('wo-start');
      api.setBusy(btn, true, 'Starting…');
      // If a workout is already open (e.g. started on the other phone), continue that one instead of making a second.
      sb.from('workout_sessions').select('id,started_at').eq('user_id', me()).is('finished_at', null).order('started_at', { ascending: false }).limit(1)
        .then(function (res) {
          if (res.error) throw res.error;
          var open = (res.data || [])[0];
          if (open && Date.now() - Date.parse(open.started_at) < 12 * 3600 * 1000) return { data: open, reused: true };
          return sb.from('workout_sessions').insert({ user_id: me(), session_date: C.localDate(), started_at: new Date().toISOString() }).select().single();
        }).then(function (res) {
          if (res.error) throw res.error;
          return openSession(res.data.id, { fresh: !res.reused });
        }).catch(function (e) {
          console.warn('Start failed:', e && (e.code || e.message));
          api.setMsg('wo-err', api.friendly(e) + ' Try again.');
        }).finally(function () { busy.start = false; api.setBusy(btn, false); });
    }
    $('wo-start').addEventListener('click', startWorkout);

    /* Start a day of your split: the workout opens with that day's exercises and targets already in it. */
    function startSplitWorkout(split, dayNo, day) {
      var uid = me();
      return Promise.all([loadLibrary().catch(function () { return null; }), loadCustoms().catch(function () { return null; })]).then(function () {
        return sb.from('workout_sessions').select('id,started_at').eq('user_id', uid).is('finished_at', null).order('started_at', { ascending: false }).limit(1);
      }).then(function (res) {
        if (res.error) throw res.error;
        var openNow = (res.data || [])[0];
        if (openNow && Date.now() - Date.parse(openNow.started_at) < 12 * 3600 * 1000) {
          openSession(openNow.id, { note: 'You already have a workout going — finish or discard it before starting ' + day.name + '.' });
          return null;
        }
        return sb.from('workout_sessions').insert({ user_id: uid, session_date: C.localDate(), started_at: new Date().toISOString(),
          split_id: split.id, split_day_no: dayNo, split_name: String(split.name).slice(0, 60), split_day: String(day.name).slice(0, 60) }).select().single();
      }).then(function (res) {
        if (!res) return null;
        if (res.error) throw res.error;
        var sid = res.data.id;
        var rows = day.items.slice(0, MAX_EXERCISES).map(function (it, i) {
          var x = findEx(it.ref) || {};
          return { session_id: sid, user_id: uid, exercise_ref: it.ref, exercise_name: String(x.n || it.name).slice(0, 80),
            muscle_group: GROUPS.indexOf(x.g) !== -1 ? x.g : null, tracking_type: TRACK[x.tt] ? x.tt : 'weight_reps', position: i + 1,
            target_sets: it.sets >= 1 && it.sets <= 10 ? it.sets : null, target_reps: it.reps ? String(it.reps).slice(0, 20) : null, target_rest: it.rest ? String(it.rest).slice(0, 20) : null };
        });
        if (!rows.length) return openSession(sid, { fresh: true });
        return sb.from('workout_exercises').insert(rows).select().then(function (r2) {
          if (r2.error) {
            console.warn('Split exercises not added:', r2.error.code || r2.error.message);
            return openSession(sid, { note: 'The workout started, but its exercises didn’t load in. Add them with + Add exercise, or discard and try again.' });
          }
          return openSession(sid);
        });
      });
    }

    /* Called once after logging in: if a workout is still going (started in the last 12 h), go straight back to it. */
    function resumeIfActive() {
      if (ro()) return Promise.resolve(false);
      var uid = me();
      return sb.from('workout_sessions').select('id,started_at').eq('user_id', uid).is('finished_at', null).order('started_at', { ascending: false }).limit(1)
        .then(function (res) {
          if (res.error || !api.me() || api.me().id !== uid) return false;
          var r = (res.data || [])[0];
          if (!r || Date.now() - Date.parse(r.started_at) > 12 * 3600 * 1000) return false;
          if (api.current() !== 'home') return false;     // they've already moved on; don't yank them
          openSession(r.id, { note: 'Welcome back — your workout is still going.' });
          return true;
        }).catch(function () { return false; });
    }

    /* ======================= one workout ======================= */
    function openSession(id, opts) {
      opts = opts || {};
      var token = ++sessToken;
      session = null; exs = [];
      api.show('session');
      $('ws-title').textContent = 'Workout';
      $('ws-sub').textContent = 'Loading…';
      $('ws-list').textContent = '';
      $('ws-tools').hidden = true;
      api.setMsg('ws-msg', opts.note || '', 'ok');
      api.setMsg('ws-err', ''); $('ws-retry').hidden = true;
      $('ws-retry').onclick = function () { openSession(id, opts); };
      api.focusQuiet($('ws-title'));
      return Promise.all([
        sb.from('workout_sessions').select('*').eq('id', id).eq('user_id', owner()).single(),
        sb.from('workout_exercises').select('*').eq('session_id', id).eq('user_id', owner()).order('position', { ascending: true }).order('id', { ascending: true }),
        loadLibrary().catch(function () { return null; }),
        loadCustoms().catch(function () { return null; })
      ]).then(function (r) {
        if (token !== sessToken) return null;
        if (r[0].error) throw r[0].error;
        if (r[1].error) throw r[1].error;
        var s = r[0].data, wex = r[1].data || [];
        var eids = wex.map(function (x) { return x.id; });
        var setsQ = eids.length ? sb.from('workout_sets').select('*').in('workout_exercise_id', eids).order('set_number', { ascending: true }) : Promise.resolve({ data: [] });
        return Promise.all([s, wex, setsQ, ro() ? {} : lastTimes(wex.map(function (x) { return x.exercise_ref; }), id)]);
      }).then(function (r) {
        if (!r || token !== sessToken) return;
        if (r[2].error) throw r[2].error;
        session = r[0];
        var setsBy = {}; (r[2].data || []).forEach(function (st) { (setsBy[st.workout_exercise_id] = setsBy[st.workout_exercise_id] || []).push(st); });
        exs = r[1].map(function (x) { return buildEx(x, setsBy[x.id] || [], r[3][x.exercise_ref] || null); });
        renderSession();
        if (opts.fresh && !exs.length && !ro()) openPicker();   // just started: go straight to choosing the first exercise
      }).catch(function (e) {
        if (token !== sessToken) return;
        console.warn('Workout load failed:', e && (e.code || e.message));
        $('ws-sub').textContent = '';
        api.setMsg('ws-err', (e && e.code === 'PGRST116') ? 'That workout no longer exists (it may have been deleted on another phone).' : api.friendly(e) + ' Your workout is safe.');
        $('ws-retry').hidden = !(e && e.code !== 'PGRST116');
      });
    }

    /* For each exercise ref: the sets from the most recent OTHER workout that had it. → { ref: [sets] } */
    function lastTimes(refs, exceptSessionId) {
      var uniq = refs.filter(function (r, i) { return r && refs.indexOf(r) === i; });
      if (!uniq.length) return Promise.resolve({});
      return sb.from('workout_exercises').select('id,exercise_ref,session_id,created_at').eq('user_id', me()).in('exercise_ref', uniq)
        .neq('session_id', exceptSessionId).order('created_at', { ascending: false }).limit(300)
        .then(function (res) {
          if (res.error) return {};
          var pickId = {}, ids = [];
          (res.data || []).forEach(function (x) { if (!pickId[x.exercise_ref]) { pickId[x.exercise_ref] = x.id; ids.push(x.id); } });
          if (!ids.length) return {};
          return sb.from('workout_sets').select('workout_exercise_id,set_number,weight,weight_unit,reps,duration_sec').in('workout_exercise_id', ids).order('set_number', { ascending: true })
            .then(function (r2) {
              if (r2.error) return {};
              var out = {};
              Object.keys(pickId).forEach(function (ref) {
                var s = (r2.data || []).filter(function (st) { return st.workout_exercise_id === pickId[ref]; });
                if (s.length) out[ref] = s;
              });
              return out;
            });
        }).catch(function () { return {}; });
    }

    function rowFromSet(st, u) {
      return { id: st.id, done: true, touched: true,
        w: st.weight != null ? fmtW(convert(st.weight, st.weight_unit || 'lb', u)) : '',
        r: st.reps != null ? String(st.reps) : '', t: st.duration_sec != null ? fmtTime(st.duration_sec) : '' };
    }
    function plannedRow(src, u) {
      if (!src) return { id: null, done: false, touched: false, w: '', r: '', t: '' };
      if (src.done !== undefined) return { id: null, done: false, touched: false, w: src.w, r: src.r, t: src.t };   // copy of a row on screen
      var x = rowFromSet(src, u); x.id = null; x.done = false; x.touched = false; return x;
    }
    function buildEx(x, saved, last) {
      var info = findEx(x.exercise_ref) || {};
      var u = unit();
      var e = { id: x.id, ref: x.exercise_ref, name: x.exercise_name, group: x.muscle_group || info.g || '', tt: TRACK[x.tracking_type] ? x.tracking_type : 'weight_reps',
        position: x.position, eq: info.eq || '', one: !!info.one, note: info.note || '', last: last, rows: [], msg: '', armed: false,
        tSets: x.target_sets || null, tReps: x.target_reps || '', tRest: x.target_rest || '' };
      e.saved = saved;
      saved.forEach(function (st) { e.rows.push(rowFromSet(st, u)); });
      if (!session || !session.finished_at) {
        var target = e.tSets || (last ? Math.min(last.length, 10) : 3);
        while (e.rows.length < target) {
          var i = e.rows.length;
          e.rows.push(plannedRow(last && last[i] ? last[i] : (e.rows[i - 1] || null), u));
        }
      } else if (!e.rows.length) {
        e.rows.push(plannedRow(null, u));
      }
      return e;
    }

    function renderSession() {
      var s = session, u = unit();
      var finished = !!s.finished_at;
      $('ws-title').textContent = s.split_day ? s.split_day : (finished ? 'Workout' : 'Workout in progress');
      var mins = minutesBetween(s.started_at, s.finished_at);
      $('ws-sub').textContent = (s.split_name ? s.split_name + (s.split_day_no ? ' · day ' + s.split_day_no : '') + ' · ' : '') +
        (finished ? C.longDate(s.session_date) + (mins ? ' · ' + mins + ' min' : '') : (s.split_day ? 'In progress · ' : '') + 'started ' + timeOfDay(s.started_at));
      var view = ro();
      $('ws-tools').hidden = view;
      $('ws-notes-ro').hidden = !(view && s.notes);
      $('ws-notes-ro').textContent = view && s.notes ? 'Notes: ' + s.notes : '';
      if (view) $('ws-sub').textContent = api.ownerName() + ' · ' + $('ws-sub').textContent;
      $('ws-finish').hidden = finished;
      $('ws-notes').value = s.notes || '';
      $('ws-delete').textContent = finished ? 'Delete this workout' : 'Discard this workout';
      $('ws-delete').dataset.armed = '';
      $('ws-back').textContent = '‹ Training';
      var list = $('ws-list'); list.textContent = '';
      if (!exs.length) list.appendChild(el('p', 'muted ws-none', finished ? 'No exercises in this workout.' : 'Add your first exercise to get going.'));
      exs.forEach(function (e, i) { list.appendChild(view ? roCard(e, u) : exCard(e, i, u)); });
      $('ws-add').textContent = exs.length ? '+ Add another exercise' : '+ Add exercise';
    }

    /* Someone else's workout: what they did, nothing to tap or type. */
    function roCard(e, u) {
      var card = el('div', 'card ws-ex ws-ex-ro'); card.setAttribute('data-ex', String(e.id));
      var head = el('div', 'ws-ex-head');
      var ht = el('div', 'ws-ex-titles');
      ht.appendChild(el('h3', 'ws-ex-name', e.name));
      var meta = [e.group, e.eq].filter(Boolean);
      if (e.one) meta.push('one side at a time');
      ht.appendChild(el('span', 'ws-ex-meta', meta.join(' · ')));
      head.appendChild(ht); card.appendChild(head);
      if (e.tSets) card.appendChild(el('p', 'ws-target', 'Target ' + e.tSets + ' × ' + (e.tReps || '—') + (e.tRest ? ' · rest ' + e.tRest : '')));
      var sets = (e.saved || []).slice().sort(function (a, b) { return a.set_number - b.set_number; });
      if (!sets.length) { card.appendChild(el('p', 'muted small', 'No sets logged.')); return card; }
      var ol = el('ol', 'ws-ro-sets');
      sets.forEach(function (st, i) {
        var li = el('li');
        li.appendChild(el('span', 'ws-ro-n', String(i + 1)));
        li.appendChild(el('span', 'ws-ro-v', setText(st, e.tt, u) + (TRACK[e.tt] && TRACK[e.tt].w && TRACK[e.tt].r ? ' ' + unitHint(e, u) : '')));
        ol.appendChild(li);
      });
      card.appendChild(ol);
      return card;
    }

    function unitHint(e, u) {
      var tr = TRACK[e.tt];
      if (!tr.w) return '';
      if (/dumbbell|kettlebell/i.test(e.eq)) return u + ' per dumbbell';
      if (e.one) return u + ' per side';
      return u;
    }

    function exCard(e, idx, u) {
      var tr = TRACK[e.tt];
      var card = el('div', 'card ws-ex'); card.setAttribute('data-ex', String(e.id));
      var head = el('div', 'ws-ex-head');
      var ht = el('div', 'ws-ex-titles');
      var hn = el('h3', 'ws-ex-name');
      var nb = el('button', 'ws-ex-link', e.name); nb.type = 'button';
      nb.setAttribute('aria-label', e.name + ' — how to do it');
      nb.addEventListener('click', function () { showInfo(infoFor(e), '\u2039 Workout', function () { api.show('session'); }); });
      hn.appendChild(nb); ht.appendChild(hn);
      var meta = [e.group, e.eq].filter(Boolean);
      if (e.one) meta.push('one side at a time');
      ht.appendChild(el('span', 'ws-ex-meta', meta.join(' · ')));
      head.appendChild(ht);
      var rm = el('button', 'btn-link danger-link ws-ex-remove', e.armed ? 'Tap again to remove' : 'Remove'); rm.type = 'button';
      rm.setAttribute('aria-label', e.armed ? 'Tap again to remove ' + e.name : 'Remove ' + e.name);
      rm.addEventListener('click', function () { removeExercise(e); });
      head.appendChild(rm);
      card.appendChild(head);
      if (e.tSets) card.appendChild(el('p', 'ws-target', 'Target ' + e.tSets + ' × ' + (e.tReps || '—') + (e.tRest ? ' · rest ' + e.tRest : '')));
      if (e.note) card.appendChild(el('p', 'ws-ex-note', e.note));
      if (e.last && e.last.length) {
        card.appendChild(el('p', 'ws-last', 'Last time: ' + e.last.map(function (s) { return setText(s, e.tt, u); }).join(' · ')));
      } else {
        card.appendChild(el('p', 'ws-last', 'First time logging this — enjoy!'));
      }
      var table = el('div', 'ws-sets'); table.setAttribute('role', 'group'); table.setAttribute('aria-label', e.name + ' sets');
      var hr = el('div', 'ws-row ws-row-head cols-' + e.tt); hr.setAttribute('aria-hidden', 'true');
      hr.appendChild(el('span', null, '#'));
      if (tr.w) hr.appendChild(el('span', null, unitHint(e, u)));
      if (tr.r) hr.appendChild(el('span', null, 'Reps'));
      if (tr.t) hr.appendChild(el('span', null, 'Time'));
      hr.appendChild(el('span', null, 'Done'));
      table.appendChild(hr);
      e.rows.forEach(function (row, i) { table.appendChild(setRow(e, row, i, u)); });
      card.appendChild(table);
      var msg = el('p', 'msg error ws-ex-msg', e.msg || ''); msg.setAttribute('role', 'alert'); msg.hidden = !e.msg;
      card.appendChild(msg);
      var tools = el('div', 'ws-ex-tools');
      var add = el('button', 'btn-link ws-add-set', '+ Add set'); add.type = 'button';
      add.setAttribute('aria-label', 'Add a set to ' + e.name);
      add.disabled = e.rows.length >= MAX_SETS;
      add.addEventListener('click', function () { addSet(e); });
      tools.appendChild(add);
      if (!session.finished_at && !e.rows.some(function (r) { return r.done; })) {
        var sw = el('button', 'btn-link ws-swap', 'Swap'); sw.type = 'button';
        sw.setAttribute('aria-label', 'Swap ' + e.name + ' for another exercise');
        sw.addEventListener('click', function () { openPicker({ type: 'swap', e: e }); });
        tools.appendChild(sw);
      }
      if (e.rows.length > 1 || (e.rows.length === 1 && e.rows[0].done)) {
        var del = el('button', 'btn-link ws-del-set', '− Remove set'); del.type = 'button';
        del.setAttribute('aria-label', 'Remove the last set of ' + e.name);
        del.addEventListener('click', function () { removeLastSet(e); });
        tools.appendChild(del);
      }
      card.appendChild(tools);
      return card;
    }

    function setRow(e, row, i, u) {
      var tr = TRACK[e.tt];
      var r = el('div', 'ws-row cols-' + e.tt + (row.done ? ' done' : ''));
      r.appendChild(el('span', 'ws-num', String(i + 1)));
      function box(key, label, mode, maxlen, ph) {
        var inp = document.createElement('input');
        inp.type = 'text'; inp.inputMode = mode; inp.maxLength = maxlen; inp.autocomplete = 'off';
        inp.className = 'ws-in'; inp.value = row[key];
        inp.setAttribute('aria-label', 'Set ' + (i + 1) + ' ' + label);
        if (ph) inp.placeholder = ph;
        inp.addEventListener('input', function () { row[key] = inp.value; row.touched = true; clearMsg(e); });
        inp.addEventListener('change', function () { if (row.done) updateSet(e, row, i); });
        r.appendChild(inp);
      }
      if (tr.w) box('w', unitHint(e, u) || u, 'decimal', 6, '0');
      if (tr.r) box('r', 'reps', 'numeric', 4, '0');
      if (tr.t) box('t', 'time (seconds, or minutes:seconds)', 'text', 8, '0:30');
      var ok = el('button', 'ws-tick' + (row.done ? ' on' : ''), row.done ? '✓' : ''); ok.type = 'button';
      ok.setAttribute('aria-pressed', row.done ? 'true' : 'false');
      ok.setAttribute('aria-label', (row.done ? 'Set ' + (i + 1) + ' done. Tap to undo' : 'Mark set ' + (i + 1) + ' done'));
      if (row.busy) { ok.disabled = true; ok.textContent = '…'; }
      ok.addEventListener('click', function () { toggleSet(e, row, i); });
      r.appendChild(ok);
      return r;
    }

    function redrawEx(e) {
      var old = document.querySelector('.ws-ex[data-ex="' + e.id + '"]');
      if (!old) { renderSession(); return; }
      var idx = exs.indexOf(e);
      var focusedLabel = document.activeElement && old.contains(document.activeElement) ? document.activeElement.getAttribute('aria-label') : null;
      var fresh = exCard(e, idx, unit());
      old.parentNode.replaceChild(fresh, old);
      if (focusedLabel) {
        var again = fresh.querySelector('[aria-label="' + focusedLabel.replace(/"/g, '\\"') + '"]');
        if (again && again.tagName === 'BUTTON') api.focusQuiet(again);
      }
    }
    function clearMsg(e) {
      if (!e.msg) return;
      e.msg = '';
      var card = document.querySelector('.ws-ex[data-ex="' + e.id + '"] .ws-ex-msg');
      if (card) { card.hidden = true; card.textContent = ''; }
    }
    function showExMsg(e, text) { e.msg = text; redrawEx(e); }

    /* Read + check one row. → { ok, values } or { ok:false, problem } */
    function readRow(e, row) {
      var tr = TRACK[e.tt], v = { weight: null, weight_unit: unit(), reps: null, duration_sec: null };
      if (tr.w) {
        var w = C.parseNumber(row.w);
        if (w === null || w < 0 || w > (unit() === 'kg' ? 900 : 2000)) return { ok: false, problem: 'Enter the weight (0 to ' + (unit() === 'kg' ? '900 kg' : '2,000 lb') + ').' };
        v.weight = Math.round(w * 100) / 100;
      }
      if (tr.r) {
        var r = parseReps(row.r);
        if (r === null || r < 1 || r > 1000) return { ok: false, problem: 'Enter the reps (1 to 1,000).' };
        v.reps = r;
      }
      if (tr.t) {
        var t = parseTime(row.t);
        if (t === null || t < 1 || t > 36000) return { ok: false, problem: 'Enter the time, like 45 (seconds) or 1:30.' };
        v.duration_sec = t;
      }
      return { ok: true, values: v };
    }

    function toggleSet(e, row, i) {
      if (ro()) return;   // never change someone else's workout
      if (row.busy || !session) return;
      if (offline('ws-err')) { showExMsg(e, "You're offline — this set isn't saved yet. Tap ✓ again when you're back online."); return; }
      if (!row.done) {
        var chk = readRow(e, row);
        if (!chk.ok) { showExMsg(e, chk.problem); return; }
        row.busy = true; e.msg = ''; redrawEx(e);
        var ins = Object.assign({ workout_exercise_id: e.id, user_id: me(), set_number: i + 1 }, chk.values);
        sb.from('workout_sets').insert(ins).select().single().then(function (res) {
          if (res.error) throw res.error;
          row.id = res.data.id; row.done = true; row.touched = true;
          // Fill the next set with what you just did (unless you've already typed in it).
          var next = e.rows[i + 1];
          if (next && !next.done && !next.touched) { next.w = row.w; next.r = row.r; next.t = row.t; }
        }).catch(function (err) {
          console.warn('Set save failed:', err && (err.code || err.message));
          e.msg = api.friendly(err) + ' This set isn’t saved yet — tap ✓ again.';
        }).finally(function () { row.busy = false; redrawEx(e); });
      } else {
        row.busy = true; redrawEx(e);
        sb.from('workout_sets').delete().eq('id', row.id).then(function (res) {
          if (res.error) throw res.error;
          row.id = null; row.done = false;
        }).catch(function (err) {
          console.warn('Set undo failed:', err && (err.code || err.message));
          e.msg = api.friendly(err) + ' The set is still saved.';
        }).finally(function () { row.busy = false; redrawEx(e); });
      }
    }

    /* Changed the numbers of a set you'd already ticked → save the change. */
    function updateSet(e, row, i) {
      if (ro()) return;   // never change someone else's workout
      if (row.busy || !row.id) return;
      var chk = readRow(e, row);
      if (!chk.ok) { showExMsg(e, chk.problem + ' (The set keeps its old numbers until you fix this.)'); return; }
      if (offline('ws-err')) { showExMsg(e, "You're offline — that change isn't saved yet."); return; }
      row.busy = true;
      sb.from('workout_sets').update(chk.values).eq('id', row.id).then(function (res) {
        if (res.error) throw res.error;
        e.msg = '';
      }).catch(function (err) {
        console.warn('Set update failed:', err && (err.code || err.message));
        e.msg = api.friendly(err) + ' That change isn’t saved — try again.';
      }).finally(function () { row.busy = false; redrawEx(e); });
    }

    function addSet(e) {
      if (ro()) return;   // never change someone else's workout
      if (e.rows.length >= MAX_SETS) return;
      e.rows.push(plannedRow(e.rows[e.rows.length - 1] || null, unit()));
      e.msg = '';
      redrawEx(e);
      var inputs = document.querySelectorAll('.ws-ex[data-ex="' + e.id + '"] .ws-row:last-child .ws-in');
      if (inputs[0]) inputs[0].scrollIntoView({ block: 'nearest' });
    }
    function removeLastSet(e) {
      if (ro()) return;   // never change someone else's workout
      var row = e.rows[e.rows.length - 1];
      if (!row || row.busy) return;
      if (!row.done) { e.rows.pop(); redrawEx(e); return; }
      if (offline('ws-err')) { showExMsg(e, "You're offline — can't remove a saved set right now."); return; }
      row.busy = true; redrawEx(e);
      sb.from('workout_sets').delete().eq('id', row.id).then(function (res) {
        if (res.error) throw res.error;
        e.rows.splice(e.rows.indexOf(row), 1);
      }).catch(function (err) {
        console.warn('Set delete failed:', err && (err.code || err.message));
        e.msg = api.friendly(err);
      }).finally(function () { row.busy = false; redrawEx(e); });
    }

    var armTimer = null;
    function removeExercise(e) {
      if (ro()) return;   // never change someone else's workout
      if (busy['rm' + e.id]) return;
      if (!e.armed) {
        exs.forEach(function (x) { x.armed = false; });
        e.armed = true; redrawEx(e);
        clearTimeout(armTimer);
        armTimer = setTimeout(function () { if (e.armed) { e.armed = false; if (exs.indexOf(e) !== -1) redrawEx(e); } }, 4000);
        return;
      }
      e.armed = false;
      if (offline('ws-err')) { redrawEx(e); return; }
      busy['rm' + e.id] = true;
      sb.from('workout_exercises').delete().eq('id', e.id).then(function (res) {
        if (res.error) throw res.error;
        exs.splice(exs.indexOf(e), 1);
        renderSession();
        api.setMsg('ws-msg', 'Removed ' + e.name + '.', 'ok');
      }).catch(function (err) {
        console.warn('Remove failed:', err && (err.code || err.message));
        showExMsg(e, api.friendly(err));
      }).finally(function () { busy['rm' + e.id] = false; });
    }

    /* Notes save when you leave the box (and again on Finish). */
    $('ws-notes').addEventListener('change', function () {
      if (!session) return;
      var text = $('ws-notes').value.slice(0, 2000);
      if ((session.notes || '') === text) return;
      if (!navigator.onLine) { api.setMsg('ws-err', "You're offline — your note isn't saved yet."); return; }
      var sid = session.id;
      sb.from('workout_sessions').update({ notes: text || null }).eq('id', sid).then(function (res) {
        if (res.error) throw res.error;
        if (session && session.id === sid) { session.notes = text || null; api.setMsg('ws-err', ''); }
      }).catch(function (err) { api.setMsg('ws-err', api.friendly(err) + ' Your note isn’t saved yet.'); });
    });

    function finish() {
      if (ro()) return;   // never change someone else's workout
      if (!session || busy.finish) return;
      api.setMsg('ws-err', '');
      var doneCount = 0; exs.forEach(function (e) { e.rows.forEach(function (r) { if (r.done) doneCount++; }); });
      var pending = exs.some(function (e) { return e.rows.some(function (r) { return r.busy; }); });
      if (pending) { api.setMsg('ws-err', 'Still saving a set — give it a second and tap Finish again.'); return; }
      if (!doneCount) { api.setMsg('ws-err', 'Nothing is ticked yet. Tick ✓ on the sets you did — or tap “Discard this workout” below.'); return; }
      if (offline('ws-err')) return;
      busy.finish = true;
      var btn = $('ws-finish');
      api.setBusy(btn, true, 'Saving…');
      var sid = session.id;
      var change = { finished_at: new Date().toISOString(), notes: $('ws-notes').value.slice(0, 2000) || null };
      if (Date.parse(change.finished_at) < Date.parse(session.started_at)) change.finished_at = session.started_at;   // phone clock behind
      sb.from('workout_sessions').update(change).eq('id', sid).select().single().then(function (res) {
        if (res.error) throw res.error;
        session = res.data;
        showDone();
      }).catch(function (err) {
        console.warn('Finish failed:', err && (err.code || err.message));
        api.setMsg('ws-err', api.friendly(err) + ' Your sets are saved — tap Finish again.');
      }).finally(function () { busy.finish = false; api.setBusy(btn, false); });
    }
    $('ws-finish').addEventListener('click', finish);

    function showDone() {
      var u = unit();
      var data = exs.map(function (e) {
        return { tt: e.tt, name: e.name, sets: e.rows.filter(function (r) { return r.done; }).map(function (r) {
          var rr = readRow(e, r); return rr.ok ? rr.values : null; }).filter(Boolean) };
      });
      var t = summarise(data, u);
      var p = api.profile();
      $('wd-title').textContent = 'Nice work' + (p && p.display_name ? ', ' + p.display_name : '') + '!';
      $('wd-ex').textContent = String(t.exercises);
      $('wd-sets').textContent = String(t.sets);
      var vol = $('wd-vol'); vol.textContent = t.volume ? fmt(t.volume) : '–'; vol.appendChild(el('small', null, t.volume ? u : ''));
      var mins = minutesBetween(session.started_at, session.finished_at);
      var tm = $('wd-time'); tm.textContent = mins ? String(mins) : '–'; tm.appendChild(el('small', null, mins ? 'min' : ''));
      var list = $('wd-list'); list.textContent = '';
      data.forEach(function (x) {
        if (!x.sets.length) return;
        var li = el('li');
        li.appendChild(el('b', null, x.name));
        li.appendChild(el('span', 'muted', x.sets.map(function (s) { return setText(s, x.tt, u); }).join(' · ')));
        list.appendChild(li);
      });
      api.show('wdone');
      api.focusQuiet($('wd-title'));
    }
    $('wd-done').addEventListener('click', function () { open(''); });

    var delTimer = null;
    $('ws-delete').addEventListener('click', function () {
      var b = $('ws-delete');
      if (!session || busy.del) return;
      if (b.dataset.armed !== '1') {
        b.dataset.armed = '1';
        b.textContent = 'Tap again to ' + (session.finished_at ? 'delete' : 'discard') + ' (this can’t be undone)';
        clearTimeout(delTimer);
        delTimer = setTimeout(function () { if (session) { b.dataset.armed = ''; b.textContent = session.finished_at ? 'Delete this workout' : 'Discard this workout'; } }, 4000);
        return;
      }
      if (offline('ws-err')) return;
      busy.del = true;
      var wasFinished = !!session.finished_at;
      api.setBusy(b, true, wasFinished ? 'Deleting…' : 'Discarding…');
      sb.from('workout_sessions').delete().eq('id', session.id).then(function (res) {
        if (res.error) throw res.error;
        session = null; exs = [];
        open(wasFinished ? 'Workout deleted.' : 'Workout discarded.');
      }).catch(function (err) {
        console.warn('Delete workout failed:', err && (err.code || err.message));
        api.setMsg('ws-err', api.friendly(err));
      }).finally(function () { busy.del = false; api.setBusy(b, false); b.dataset.armed = ''; });
    });
    $('ws-back').addEventListener('click', function () { open(''); });
    $('ws-add').addEventListener('click', function () { if (session) openPicker(); });

    /* ======================= add an exercise ======================= */
    var pickTimer = null;
    var recentRefs = [];
    var pickMode = { type: 'session' };    // 'session' = add to workout · 'swap' = replace one exercise · 'ext' = someone else (split editor) wants an exercise
    function openPicker(mode) {
      pickMode = mode || { type: 'session' };
      if (pickMode.type === 'session' && exs.length >= MAX_EXERCISES) { api.setMsg('ws-err', 'That’s the most exercises one workout can hold (' + MAX_EXERCISES + ').'); return; }
      if (pickMode.type === 'session' || pickMode.type === 'swap') pickerFor = session.id;
      $('xp-search').value = '';
      var g0 = pickMode.type === 'swap' && GROUPS.indexOf(pickMode.e.group) !== -1 ? pickMode.e.group : 'all';
      setRadio('xp-group', g0);
      $('xp-title').textContent = pickMode.type === 'swap' ? 'Swap ' + pickMode.e.name : (pickMode.type === 'browse' ? 'Exercises' : (pickMode.title || 'Add exercise'));
      $('xp-back').textContent = pickMode.type === 'ext' ? '\u2039 Split' : (pickMode.type === 'browse' ? '\u2039 Training' : '\u2039 Workout');
      var planOk = pickMode.type === 'swap' && session && session.split_id && session.split_day_no && api.splits();
      $('xp-plan-wrap').hidden = !planOk;
      $('xp-plan').checked = false;
      $('xn-save').textContent = pickMode.type === 'ext' ? 'Save & add to split' : (pickMode.type === 'swap' ? 'Save & swap it in' : (pickMode.type === 'browse' ? 'Save & open it' : 'Save & add to workout'));
      api.setMsg('xp-msg', '');
      $('xp-results').textContent = '';
      $('xp-status').textContent = 'Loading exercises…';
      api.show('expick');
      api.focusQuiet($('xp-title'));
      Promise.all([loadLibrary(), loadCustoms().catch(function () { return customs; }), loadRecent()]).then(function () {
        if (api.current() === 'expick') runPick();
      }).catch(function (e) {
        console.warn('Exercise list failed:', e && e.message);
        $('xp-status').textContent = 'Couldn’t load the exercise list. Check your internet and go back to try again — or add your own below.';
      });
    }
    function loadRecent() {
      return sb.from('workout_exercises').select('exercise_ref,created_at').eq('user_id', me()).order('created_at', { ascending: false }).limit(80)
        .then(function (res) {
          if (res.error) return;
          recentRefs = [];
          (res.data || []).forEach(function (x) { if (recentRefs.indexOf(x.exercise_ref) === -1 && recentRefs.length < 10) recentRefs.push(x.exercise_ref); });
        }).catch(function () { /* recent is a nice-to-have */ });
    }
    var fingerOnList = false, pickWaiting = false;
    $('xp-results').addEventListener('touchstart', function () { fingerOnList = true; }, { passive: true });
    function fingerUp() { if (!fingerOnList) return; fingerOnList = false; if (pickWaiting) { pickWaiting = false; setTimeout(runPick, 0); } }
    document.addEventListener('touchend', fingerUp, { passive: true });
    document.addEventListener('touchcancel', fingerUp, { passive: true });

    function runPick() {
      if (fingerOnList) { pickWaiting = true; return; }
      var list = $('xp-results'); list.textContent = '';
      if (!library) return;
      var q = $('xp-search').value, g = radio('xp-group') || 'all';
      var all = customs.concat(library);
      var items, status;
      if (!q.trim() && g === 'all' && recentRefs.length) {
        items = recentRefs.map(findEx).filter(Boolean);
        status = 'Recent';
        if (!items.length) { items = null; }
      }
      if (!items) {
        var r = searchExercises(all, q, g, q.trim() ? 60 : 200);
        items = r.items;
        status = r.total === 0 ? 'No matches. Try another word, or add your own exercise below.'
          : (q.trim() ? (r.total > items.length ? 'Showing ' + items.length + ' of ' + r.total : r.total + (r.total === 1 ? ' match' : ' matches'))
            : (g === 'all' ? 'All exercises' : g) + ' · ' + r.total);
      }
      $('xp-status').textContent = status;
      items.forEach(function (x) {
        var li = el('li');
        var b = el('button', 'result'); b.type = 'button';
        var txt = el('span', 'entry-text');
        txt.appendChild(el('span', 'entry-name', x.n));
        txt.appendChild(el('span', 'entry-meta', [x.g, x.a, x.eq, x.custom ? 'your own' : ''].filter(Boolean).join(' · ')));
        b.appendChild(txt);
        b.addEventListener('click', function () { handlePick(x); });
        li.appendChild(b); list.appendChild(li);
      });
    }
    $('xp-search').addEventListener('input', function () { clearTimeout(pickTimer); pickTimer = setTimeout(runPick, 120); });
    $('xp-search').addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); runPick(); $('xp-search').blur(); } });
    $('xp-groups').addEventListener('change', runPick);
    $('xp-back').addEventListener('click', function () {
      if (pickMode.type === 'ext') { var m = pickMode; pickMode = { type: 'session' }; if (m.onBack) m.onBack(); return; }
      if (pickMode.type === 'browse') { pickMode = { type: 'session' }; open(''); return; }
      backToSession();
    });
    function handlePick(x) {
      if (pickMode.type === 'browse') { showInfo(x, '\u2039 Exercises', function () { pickMode = { type: 'browse' }; api.show('expick'); }); return; }
      if (pickMode.type === 'ext') { var m = pickMode; pickMode = { type: 'session' }; m.onPick(x); return; }
      if (pickMode.type === 'swap') { swapExercise(pickMode.e, x, $('xp-plan').checked && !$('xp-plan-wrap').hidden); return; }
      addExercise(x);
    }
    /* An exercise's own page (muscles, safety tips, "watch how", later your progress). */
    function showInfo(x, backLabel, onBack) {
      var info = api.exinfo && api.exinfo();
      if (!info || !x) return;
      info.open(x, { backLabel: backLabel, onBack: onBack });
    }
    function infoFor(e) {
      return findEx(e.ref) || { id: e.ref, n: e.name, g: e.group || '', eq: e.eq || '', tt: e.tt, custom: /^C\d+$/.test(String(e.ref || '')) };
    }
    $('wo-exlib').addEventListener('click', function () { openPicker({ type: 'browse' }); });

    /* Someone else (the split editor) needs an exercise chosen. */
    function pickExercise(opts) { openPicker({ type: 'ext', title: opts.title, onPick: opts.onPick, onBack: opts.onBack }); }

    /* Swap one exercise in the workout for another (only before any of its sets are ticked). */
    function swapExercise(e, x, alsoPlan) {
      if (busy.swap) return;
      if (offline('xp-msg')) return;
      if (!session || session.id !== pickerFor || exs.indexOf(e) === -1) { api.setMsg('xp-msg', 'That workout isn’t open any more. Go back and open it again.'); return; }
      if (e.rows.some(function (r) { return r.done; })) { api.setMsg('xp-msg', 'You’ve already ticked sets for ' + e.name + ' — add the new exercise instead.'); return; }
      if (x.id === e.ref) { backToSession(); return; }
      busy.swap = true;
      api.setMsg('xp-msg', 'Swapping…', 'ok');
      var oldRef = e.ref, oldName = e.name;
      var change = { exercise_ref: x.id, exercise_name: String(x.n).slice(0, 80), muscle_group: GROUPS.indexOf(x.g) !== -1 ? x.g : null, tracking_type: x.tt || 'weight_reps' };
      Promise.all([sb.from('workout_exercises').update(change).eq('id', e.id).select().single(), lastTimes([x.id], session.id)]).then(function (r) {
        if (r[0].error) throw r[0].error;
        var fresh = buildEx(r[0].data, [], r[1][x.id] || null);
        exs[exs.indexOf(e)] = fresh;
        api.setMsg('xp-msg', '');
        var note = 'Swapped ' + oldName + ' for ' + x.n + '.';
        backToSession(note);
        if (alsoPlan) {
          api.splits().swapInPlan(session.split_id, session.split_day_no, oldRef, x).then(function () {
            api.setMsg('ws-msg', note + ' Your plan is updated too.', 'ok');
          }).catch(function (err) {
            api.setMsg('ws-msg', note + ' (Your plan wasn’t changed: ' + (err && err.message && !err.code ? err.message : api.friendly(err)) + ')', 'ok');
          });
        }
      }).catch(function (err) {
        console.warn('Swap failed:', err && (err.code || err.message));
        api.setMsg('xp-msg', api.friendly(err) + ' Nothing changed — try again.');
      }).finally(function () { busy.swap = false; });
    }

    function backToSession(note) {
      if (session && pickerFor === session.id) {
        api.show('session');
        renderSession();
        if (note) api.setMsg('ws-msg', note, 'ok');
      } else if (pickerFor) openSession(pickerFor, { note: note });
      else open('');
    }

    function addExercise(x) {
      if (busy.add) return;
      if (offline('xp-msg')) return;
      if (!session || session.id !== pickerFor) { api.setMsg('xp-msg', 'That workout isn’t open any more. Go back and open it again.'); return; }
      busy.add = true;
      api.setMsg('xp-msg', 'Adding ' + x.n + '…', 'ok');
      var pos = exs.reduce(function (m, e) { return Math.max(m, e.position || 0); }, 0) + 1;
      var row = { session_id: session.id, user_id: me(), exercise_ref: x.id, exercise_name: String(x.n).slice(0, 80),
        muscle_group: GROUPS.indexOf(x.g) !== -1 ? x.g : null, tracking_type: x.tt || 'weight_reps', position: Math.min(100, pos) };
      Promise.all([sb.from('workout_exercises').insert(row).select().single(), lastTimes([x.id], session.id)]).then(function (r) {
        if (r[0].error) throw r[0].error;
        var e = buildEx(r[0].data, [], r[1][x.id] || null);
        exs.push(e);
        if (recentRefs.indexOf(x.id) === -1) recentRefs.unshift(x.id);
        api.setMsg('xp-msg', '');
        backToSession('Added ' + x.n + '.');
        var card = document.querySelector('.ws-ex[data-ex="' + e.id + '"]');
        if (card && card.scrollIntoView) card.scrollIntoView({ block: 'start' });
      }).catch(function (err) {
        console.warn('Add exercise failed:', err && (err.code || err.message));
        api.setMsg('xp-msg', api.friendly(err) + ' Nothing was added — try again.');
      }).finally(function () { busy.add = false; });
    }

    /* ======================= your own exercise ======================= */
    $('xp-custom').addEventListener('click', function () {
      $('xn-name').value = $('xp-search').value.trim().slice(0, 80);
      var g = radio('xp-group'); setRadio('xn-group', GROUPS.indexOf(g) !== -1 ? g : '');
      setRadio('xn-type', 'weight_reps');
      $('xn-eq').value = '';
      api.setMsg('xn-msg', '');
      api.show('exnew');
      api.focusQuiet($('xn-title'));
    });
    $('xn-back').addEventListener('click', function () { api.show('expick'); });
    $('xn-form').addEventListener('input', function () { api.setMsg('xn-msg', ''); });
    $('xn-form').addEventListener('submit', function (ev) {
      ev.preventDefault();
      if (busy.custom) return;
      var name = $('xn-name').value.replace(/\s+/g, ' ').trim();
      if (!name || name.length > 80) { api.setMsg('xn-msg', 'Give the exercise a name (up to 80 characters).'); $('xn-name').focus(); return; }
      var g = radio('xn-group');
      if (GROUPS.indexOf(g) === -1) { api.setMsg('xn-msg', 'Pick the main muscle group.'); return; }
      var tt = radio('xn-type'); if (!TRACK[tt]) tt = 'weight_reps';
      var eq = $('xn-eq').value.replace(/\s+/g, ' ').trim().slice(0, 40) || null;
      var clash = customs.concat(library || []).filter(function (x) { return norm(x.n) === norm(name); })[0];
      if (clash) { api.setMsg('xn-msg', '“' + clash.n + '” is already in the list — search for it instead.'); return; }
      if (offline('xn-msg')) return;
      busy.custom = true;
      var btn = $('xn-save');
      api.setBusy(btn, true, 'Saving…');
      sb.from('custom_exercises').insert({ user_id: me(), name: name, muscle_group: g, equipment: eq, tracking_type: tt }).select().single().then(function (res) {
        if (res.error) throw res.error;
        var x = customToEx(res.data);
        customs.push(x);
        api.show('expick');
        busy.custom = false; api.setBusy(btn, false);
        handlePick(x);
      }).catch(function (err) {
        console.warn('Custom exercise failed:', err && (err.code || err.message));
        api.setMsg('xn-msg', api.friendly(err) + ' Nothing was saved — try again.');
      }).finally(function () { busy.custom = false; api.setBusy(btn, false); });
    });

    /* Units changed in Profile: redraw what's on screen. */
    function unitsChanged() { if (session && api.current() === 'session') renderSession(); }

    return {
      open: open,
      openSession: openSession,
      startSplitWorkout: startSplitWorkout,
      pickExercise: pickExercise,
      resumeIfActive: resumeIfActive,
      unitsChanged: unitsChanged,
      clear: function () { groupOpen = {}; session = null; exs = []; customs = []; recentRefs = []; pickerFor = null; pickMode = { type: 'session' }; sessToken++; listToken++; busy = {}; }
    };
  }

  TaakatWorkouts.pure = pure;
  if (typeof module !== 'undefined' && module.exports) module.exports = pure;
  else root.TaakatWorkouts = TaakatWorkouts;
})(this);
