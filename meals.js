/* Taakat — Stage 4a: meals. Food search, amounts, logging, the daily card and meal cards.
   app.js calls window.TaakatMeals(api) once, after login code is ready. */
(function (root) {
  'use strict';

  var MEALS = [
    { key: 'breakfast', label: 'Breakfast' },
    { key: 'lunch', label: 'Lunch' },
    { key: 'dinner', label: 'Dinner' },
    { key: 'snacks', label: 'Snacks' }
  ];
  var SRC_LABEL = { whole_food: 'Whole food', fast_food: 'Fast food', indian: 'Indian', custom: 'Your own' };
  var ALIASES = {
    roti: ['chapati', 'phulka'], chapati: ['roti'], phulka: ['roti', 'chapati'], dahi: ['yogurt', 'curd'], curd: ['yogurt', 'dahi'],
    yoghurt: ['yogurt'], chana: ['chole', 'chickpea'], chole: ['chana', 'chickpea'], chickpeas: ['chickpea', 'chana'],
    aloo: ['potato'], gobi: ['cauliflower'], palak: ['spinach'], mcd: ['mcdonald'], mcdonalds: ['mcdonald'], maccas: ['mcdonald'],
    naan: ['nan'], nan: ['naan'], kfc: ['kfc'], pizzapizza: ['pizza pizza'], omelette: ['omelet'], omelet: ['omelette']
  };

  /* ---------- search (pure functions, also used by tests) ---------- */
  function norm(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  }
  function tokenVariants(t) {
    var v = [t];
    if (t.length > 3 && /s$/.test(t)) v.push(t.slice(0, -1));
    if (t.length > 4 && /es$/.test(t)) v.push(t.slice(0, -2));
    if (t.length > 4 && /ies$/.test(t)) v.push(t.slice(0, -3) + 'y');
    (ALIASES[t] || []).forEach(function (a) { v.push(norm(a)); });
    return v;
  }
  function prepare(foods) {
    foods.forEach(function (f) {
      f._name = norm(f.n);
      f._hay = ' ' + norm([f.n, f.b || '', f.st || '', f.cat || '', SRC_LABEL[f.src] || ''].join(' ')) + ' ';
    });
    return foods;
  }
  function search(foods, query, filter, limit) {
    var q = norm(query);
    var pool = filter && filter !== 'all' ? foods.filter(function (f) { return f.src === filter; }) : foods;
    if (!q) return { total: 0, items: [] };
    var tokens = q.split(' ').filter(Boolean).slice(0, 8);
    var scored = [];
    function best(hay, vs) {         // 3 = whole word, 2 = start of a word, 1 = inside a word, 0 = missing
      var b = 0;
      for (var j = 0; j < vs.length; j++) {
        var v = vs[j];
        if (hay.indexOf(' ' + v + ' ') !== -1) return 3;
        var at = hay.indexOf(v);
        while (at !== -1) {
          b = Math.max(b, hay.charAt(at - 1) === ' ' ? 2 : 1);
          at = hay.indexOf(v, at + 1);
        }
      }
      return b;
    }
    pool.forEach(function (f) {
      var score = 0, name = ' ' + f._name + ' ';
      for (var i = 0; i < tokens.length; i++) {
        var vs = tokenVariants(tokens[i]);
        var inHay = best(f._hay, vs);
        if (!inHay) return;                                  // every word must match somewhere
        var inName = best(name, vs);
        score += [0, 2, 8, 12][inHay] + [0, 3, 10, 16][inName];   // the food's own name counts most
      }
      if (name.indexOf(' ' + q + ' ') === 0) score += 30;            // name starts with exactly what you typed
      else if (name.indexOf(' ' + q + ' ') !== -1) score += 18;      // ...or contains it as whole words
      else if (name.indexOf(' ' + q) === 0) score += 8;              // ...or starts with it as part of a word
      if (f.src === 'whole_food') score += 4;                      // you two mostly eat whole foods
      score -= f._name.length / 40;                                // shorter names first ("Egg" before "Egg McMuffin")
      scored.push({ f: f, s: score });
    });
    scored.sort(function (a, b) { return b.s - a.s; });
    return { total: scored.length, items: scored.slice(0, limit || 40).map(function (x) { return x.f; }) };
  }

  /* Nutrition for a catalogue food at a chosen amount. Returns [kcal, protein, carbs, fat, fibre] and grams. */
  function portion(food, servingIndex, qty, gramsTyped) {
    var sv = food.sv[servingIndex] || food.sv[0];
    var r = function (x) { return Math.round(x * 10) / 10; };
    if (food.p100) {
      var grams = gramsTyped ? gramsTyped : sv[1] * qty;
      return { grams: r(grams), m: food.p100.map(function (v) { return r(v * grams / 100); }) };
    }
    return { grams: sv[1] ? r(sv[1] * qty) : null, m: sv[2].map(function (v) { return r(v * qty); }) };
  }

  function defaultMeal(d) {
    var h = (d || new Date()).getHours() + (d || new Date()).getMinutes() / 60;
    if (h >= 4 && h < 10.5) return 'breakfast';
    if (h >= 10.5 && h < 15.5) return 'lunch';
    if (h >= 15.5 && h < 21.5) return 'dinner';
    return 'snacks';
  }

  function totals(entries) {
    var t = { kcal: 0, p: 0, c: 0, f: 0, fib: 0, byMeal: {} };
    MEALS.forEach(function (m) { t.byMeal[m.key] = { kcal: 0, items: [] }; });
    entries.forEach(function (e) {
      var k = Number(e.kcal) || 0;
      t.kcal += k; t.p += Number(e.protein_g) || 0; t.c += Number(e.carbs_g) || 0; t.f += Number(e.fat_g) || 0; t.fib += Number(e.fibre_g) || 0;
      var bucket = t.byMeal[e.meal] || t.byMeal.snacks;
      bucket.kcal += k; bucket.items.push(e);
    });
    return t;
  }

  var pure = { norm: norm, search: search, portion: portion, defaultMeal: defaultMeal, totals: totals, prepare: prepare, MEALS: MEALS };

  /* ====================================================================== */
  function TaakatMeals(api) {
    var $ = api.$, C = api.C, sb = api.sb;
    var foods = null, foodsLoading = null;
    var day = null;              // YYYY-MM-DD being shown
    var entries = [];            // food_log rows for that day
    var dayTarget = null;        // that day's saved daily_targets row (used for earlier days), or null
    var dayToken = 0;
    var editing = null;          // food_log row being edited, or null for a new entry
    var chosen = null;           // { food, servingIndex }
    var recents = [];

    function fmt(n) { return Math.round(Number(n) || 0).toLocaleString('en-CA'); }
    function g1(n) { var v = Math.round((Number(n) || 0) * 10) / 10; return (v % 1 === 0 ? v.toFixed(0) : v.toFixed(1)) + ' g'; }
    function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
    function radio(name) { var r = document.querySelector('input[name="' + name + '"]:checked'); return r ? r.value : ''; }
    function setRadio(name, v) { Array.prototype.forEach.call(document.querySelectorAll('input[name="' + name + '"]'), function (r) { r.checked = r.value === v; }); }
    function mealLabel(k) { for (var i = 0; i < MEALS.length; i++) if (MEALS[i].key === k) return MEALS[i].label; return 'Snacks'; }

    function loadFoods() {
      if (foods) return Promise.resolve(foods);
      if (foodsLoading) return foodsLoading;
      foodsLoading = window.fetch('foods.json?v=' + encodeURIComponent(api.version)).then(function (r) {
        if (!r.ok) throw new Error('foods ' + r.status);
        return r.json();
      }).then(function (j) {
        if (!j || !Array.isArray(j.foods)) throw new Error('foods file broken');
        foods = prepare(j.foods);
        return foods;
      }).catch(function (e) { foodsLoading = null; throw e; });
      return foodsLoading;
    }
    function findFood(id) { if (!foods) return null; for (var i = 0; i < foods.length; i++) if (foods[i].id === id) return foods[i]; return null; }

    /* ---------- the day: load + render ---------- */
    function showDay(d) {
      day = d || C.localDate();
      var token = ++dayToken;
      var isPast = day !== C.localDate();
      if (!isPast) dayTarget = null;
      else if (!dayTarget || dayTarget.log_date !== day) dayTarget = null;
      renderDay(true);
      api.setMsg('day-msg', ''); $('day-retry').hidden = true;
      // For an earlier day, also fetch the target that was saved that day (a missing one is fine).
      var targetQ = isPast
        ? sb.from('daily_targets').select('log_date,goal,weight_kg,maintenance_kcal,target_kcal').eq('user_id', api.me().id).eq('log_date', day).maybeSingle()
          .then(function (r) { return r && !r.error ? r.data : null; }, function () { return null; })
        : Promise.resolve(null);
      var foodQ = sb.from('food_log').select('*').eq('user_id', api.me().id).eq('log_date', day).order('created_at', { ascending: true });
      return Promise.all([foodQ, targetQ])
        .then(function (both) {
          var res = both[0];
          if (token !== dayToken) return;
          if (res.error) throw res.error;
          entries = res.data || [];
          dayTarget = both[1] || null;
          renderDay(false);
        }).catch(function (e) {
          if (token !== dayToken) return;
          console.warn('Food log load failed:', e && (e.code || e.message));
          entries = [];
          renderDay(false, true);
          api.setMsg('day-msg', api.friendly(e) + ' Your logged food is safe.');
          $('day-retry').hidden = false;
        });
    }
    $('day-retry').addEventListener('click', function () { showDay(day); });

    /* Target + maintenance for the day on screen: today = your profile now; an earlier day = what was
       saved that day (falls back to your current numbers if nothing was saved). */
    function dayNumbers() {
      var p = api.profile();
      var isPast = day && day !== C.localDate();
      var row = isPast && dayTarget && dayTarget.log_date === day ? dayTarget : null;
      var n = C.numbers(row ? Object.assign({}, p, { weight_kg: Number(row.weight_kg) || p.weight_kg, goal: row.goal || p.goal }) : p);
      if (n.ok && row) { n.target = Number(row.target_kcal) || n.target; n.maintenance = Number(row.maintenance_kcal) || n.maintenance; }
      return { n: n, isPast: !!isPast, fromSaved: !!row };
    }
    function renderDay(loading, failed) {
      var dn = dayNumbers(), n = dn.n, isPast = dn.isPast;
      var t = totals(entries);
      var target = n.ok ? n.target : 0, maint = n.ok ? n.maintenance : 0;
      var note = $('day-note');
      note.hidden = loading || !isPast || dn.fromSaved;
      note.textContent = 'No target was saved for this day, so your current target is used.';
      // gauge: eaten vs target
      var left = target - t.kcal, over = left < 0;
      var frac = target > 0 ? Math.min(1, t.kcal / target) : 0;
      var fill = $('gauge-fill');
      var len = 282.7;   // half-circle with r = 90
      fill.style.strokeDasharray = (len * frac).toFixed(1) + ' ' + len;
      fill.classList.toggle('over', over);
      var bar = $('home-bar');
      if (bar) { bar.style.width = (frac * 100).toFixed(1) + '%'; bar.classList.toggle('over', over); }
      $('home-left').textContent = loading ? '…' : fmt(Math.abs(left));
      $('home-left-label').textContent = over ? 'kcal over target' : (isPast ? 'kcal under target' : 'kcal left');
      $('home-eaten-line').textContent = loading ? (isPast ? 'Loading that day’s food…' : 'Loading today’s food…') : 'Eaten ' + fmt(t.kcal) + ' of ' + fmt(target) + ' kcal';
      var overEl = $('home-over');
      overEl.hidden = !over || loading;
      if (over) overEl.textContent = isPast ? 'You were ' + fmt(-left) + ' kcal over that day’s target.' : 'You’re ' + fmt(-left) + ' kcal over today’s target.';
      // deficit / surplus vs maintenance
      var vsMaint = maint - t.kcal;
      $('home-def-label').textContent = (vsMaint >= 0 ? 'Deficit' : 'Surplus') + (isPast ? '' : ' so far');
      var defEl = $('home-def'); defEl.textContent = fmt(Math.abs(vsMaint)); defEl.appendChild(el('small', null, 'kcal'));
      $('home-carbs').textContent = g1(t.c);
      $('home-fat').textContent = g1(t.f);
      renderProtein(t.p, n);
      renderMeals(t, loading, failed);
    }

    function renderProtein(eaten, n) {
      var box = $('home-protein'); box.textContent = '';
      if (!n.ok) return;
      var pr = n.protein, top = pr.perfect || pr.rec;
      var head = el('div', 'protein-head');
      head.appendChild(el('span', 'protein-title', 'Protein'));
      head.appendChild(el('b', 'protein-eaten', g1(eaten) + ' eaten'));
      box.appendChild(head);
      var bar = el('div', 'pbar'); bar.setAttribute('role', 'img');
      bar.setAttribute('aria-label', 'Protein ' + Math.round(eaten) + ' grams eaten. Minimum ' + pr.min + ', recommended ' + pr.rec + (pr.perfect ? ', perfect ' + pr.perfect : '') + ' grams.');
      var scale = top * 1.1;
      var fill = el('div', 'pbar-fill'); fill.style.width = Math.min(100, eaten / scale * 100).toFixed(1) + '%'; bar.appendChild(fill);
      [['min', pr.min], ['rec', pr.rec], ['perfect', pr.perfect]].forEach(function (m) {
        if (m[1] == null) return;
        var mk = el('span', 'pbar-mark'); mk.style.left = Math.min(100, m[1] / scale * 100).toFixed(1) + '%'; bar.appendChild(mk);
      });
      box.appendChild(bar);
      var legend = el('div', 'protein-legend');
      [['Min', pr.min], ['Rec', pr.rec], ['Perfect', pr.perfect]].forEach(function (m) {
        if (m[1] == null) return;
        var s = el('span', eaten >= m[1] ? 'hit' : '', (eaten >= m[1] ? '✓ ' : '') + m[0] + ' ' + m[1] + ' g');
        legend.appendChild(s);
      });
      box.appendChild(legend);
    }

    function entryMeta(e) {
      var parts = [];
      if (e.brand) parts.push(e.brand);
      var q = Number(e.quantity) || 1;
      if (e.serving_label) parts.push((q !== 1 ? (Math.round(q * 100) / 100) + ' × ' : '') + e.serving_label);
      if (e.is_estimate) parts.push('estimate');
      return parts.join(' · ');
    }

    function renderMeals(t, loading, failed) {
      var box = $('meals'); box.textContent = '';
      MEALS.forEach(function (m) {
        var b = t.byMeal[m.key];
        var card = el('div', 'card meal'); card.setAttribute('data-meal', m.key);
        var head = el('div', 'meal-head');
        head.appendChild(el('h3', 'meal-title', m.label));
        head.appendChild(el('span', 'meal-kcal', loading ? '' : fmt(b.kcal) + ' kcal'));
        var add = el('button', 'meal-add', '+ Add'); add.type = 'button';
        add.setAttribute('aria-label', 'Add food to ' + m.label);
        add.addEventListener('click', function () { openAdd(m.key); });
        head.appendChild(add);
        card.appendChild(head);
        if (!loading && !failed && b.items.length === 0) card.appendChild(el('p', 'meal-empty', 'Nothing logged yet'));
        if (b.items.length) {
          var ul = el('ul', 'entries');
          b.items.forEach(function (e) {
            var li = el('li');
            var btn = el('button', 'entry'); btn.type = 'button';
            btn.setAttribute('data-id', e.id);
            var txt = el('span', 'entry-text');
            txt.appendChild(el('span', 'entry-name', e.food_name));
            txt.appendChild(el('span', 'entry-meta', entryMeta(e)));
            btn.appendChild(txt);
            var right = el('span', 'entry-right');
            right.appendChild(el('span', 'entry-kcal', fmt(e.kcal)));
            right.appendChild(el('span', 'entry-p', g1(e.protein_g) + ' P'));
            btn.appendChild(right);
            btn.setAttribute('aria-label', 'Edit ' + e.food_name + ', ' + fmt(e.kcal) + ' kilocalories');
            btn.addEventListener('click', function () { openEdit(e); });
            li.appendChild(btn); ul.appendChild(li);
          });
          card.appendChild(ul);
        }
        box.appendChild(card);
      });
    }

    /* "Adding to Tuesday, September 29" on the logging screens when it isn't today. */
    function setForDay(id, editingRow) {
      var box = $(id), past = day && day !== C.localDate();
      box.hidden = !past;
      box.textContent = past ? (editingRow ? 'From ' : 'Adding to ') + C.longDate(day) : '';
    }

    /* ---------- Log food: search ---------- */
    var searchTimer = null;
    function openAdd(meal) {
      editing = null;
      setRadio('af-meal', meal || defaultMeal());
      $('af-search').value = '';
      $('af-results').textContent = '';
      if (!day) day = api.viewedDay();
      setForDay('af-day', null);
      api.show('addfood');
      api.focusQuiet($('af-title'));
      $('af-status').textContent = 'Loading foods…';
      loadFoods().then(function () { runSearch(); }).catch(function (e) {
        console.warn('Foods load failed:', e && e.message);
        $('af-status').textContent = 'Couldn’t load the food list. Check your internet and go back to try again — or add your own food below.';
      });
      loadRecents();
    }
    function loadRecents() {
      sb.from('food_log').select('source,source_ref,brand,food_name,serving_label,quantity,grams,kcal,protein_g,carbs_g,fat_g,fibre_g,is_estimate,meal')
        .eq('user_id', api.me().id).order('created_at', { ascending: false }).limit(40)
        .then(function (res) {
          if (res.error) return;
          var seen = {}; recents = [];
          (res.data || []).forEach(function (r) {
            var key = (r.source_ref || '') + '|' + r.food_name + '|' + (r.serving_label || '') + '|' + r.quantity;
            if (seen[key] || recents.length >= 8) return;
            seen[key] = true; recents.push(r);
          });
          if (!$('af-search').value.trim() && api.current() === 'addfood') runSearch();
        });
    }
    $('af-back').addEventListener('click', function () { api.showToday(''); });
    $('af-search').addEventListener('input', function () { clearTimeout(searchTimer); searchTimer = setTimeout(runSearch, 120); });
    $('af-search').addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); runSearch(); $('af-search').blur(); } });
    $('af-filters').addEventListener('change', runSearch);

    function resultButton(title, sub, kcal, onPick) {
      var li = el('li');
      var b = el('button', 'result'); b.type = 'button';
      var txt = el('span', 'entry-text');
      txt.appendChild(el('span', 'entry-name', title));
      txt.appendChild(el('span', 'entry-meta', sub));
      b.appendChild(txt);
      b.appendChild(el('span', 'entry-kcal', kcal));
      b.addEventListener('click', onPick);
      li.appendChild(b);
      return li;
    }
    function foodSub(f) {
      var sv = f.sv[f.d] || f.sv[0];
      var bits = [];
      if (f.b) bits.push(f.b);
      if (f.st) bits.push(f.st);
      bits.push(sv[0]);
      if (f.est) bits.push('estimate');
      return bits.join(' · ');
    }
    // Never rebuild the list while a finger is on it (the button under the finger would vanish).
    var fingerOnList = false, searchWaiting = false;
    $('af-results').addEventListener('touchstart', function () { fingerOnList = true; }, { passive: true });
    function fingerUp() {
      if (!fingerOnList) return;
      fingerOnList = false;
      if (searchWaiting) { searchWaiting = false; setTimeout(runSearch, 0); }
    }
    document.addEventListener('touchend', fingerUp, { passive: true });
    document.addEventListener('touchcancel', fingerUp, { passive: true });
    function runSearch() {
      if (fingerOnList) { searchWaiting = true; return; }
      var list = $('af-results'); list.textContent = '';
      var q = $('af-search').value;
      if (!q.trim()) {
        if (recents.length) {
          $('af-status').textContent = 'Recent';
          recents.forEach(function (r) {
            list.appendChild(resultButton(r.food_name, entryMeta(r), fmt(r.kcal), function () { relog(r); }));
          });
        } else {
          $('af-status').textContent = foods ? 'Type a food, a dish or a restaurant (e.g. “butter chicken”, “egg”, “Subway”).' : $('af-status').textContent;
        }
        return;
      }
      if (!foods) return;
      var r = search(foods, q, radio('af-filter') || 'all', 40);
      $('af-status').textContent = r.total === 0 ? 'No matches. Try another word, or add your own food below.'
        : (r.total > r.items.length ? 'Showing ' + r.items.length + ' of ' + r.total + ' — type more to narrow it down' : r.total + (r.total === 1 ? ' match' : ' matches'));
      r.items.forEach(function (f) {
        var pr = portion(f, f.d, 1, null);
        list.appendChild(resultButton(f.n, foodSub(f), fmt(pr.m[0]), function () { openPortion(f, null); }));
      });
    }

    /* Re-log a recent item exactly as before (one tap, then confirm on the amount screen). */
    function relog(r) {
      var meal = radio('af-meal') || defaultMeal();
      if (!r.source_ref || r.source === 'custom') { openCustom(null, r, meal); return; }
      loadFoods().then(function () {
        var f = findFood(r.source_ref);
        if (f) openPortion(f, null, r, meal); else openCustom(null, r, meal);
      }).catch(function () { openCustom(null, r, meal); });
    }

    /* ---------- Log food: amount ---------- */
    var pfFood = null;
    function openPortion(food, entry, recentRow, mealOverride) {
      pfFood = food;
      editing = entry || null;
      var meal = entry ? entry.meal : (mealOverride || radio('af-meal') || defaultMeal());
      $('pf-title').textContent = food.n;
      var chips = $('pf-chips'); chips.textContent = '';
      if (food.b) chips.appendChild(el('span', 'chip', food.b));
      if (food.st) chips.appendChild(el('span', 'chip chip-state', food.st));
      if (food.veg === true) chips.appendChild(el('span', 'chip', 'Veg'));
      if (food.veg === false) chips.appendChild(el('span', 'chip', 'Non-veg'));
      if (food.est) chips.appendChild(el('span', 'chip chip-est', 'Estimate'));
      $('pf-source').textContent = 'Source: ' + (food.s || SRC_LABEL[food.src]);
      $('pf-note').hidden = !food.note; $('pf-note').textContent = food.note || '';
      // servings
      var fs = $('pf-servings');
      Array.prototype.slice.call(fs.querySelectorAll('label')).forEach(function (l) { l.remove(); });
      food.sv.forEach(function (sv, i) {
        var lab = el('label', 'choice');
        var inp = document.createElement('input'); inp.type = 'radio'; inp.name = 'pf-serving'; inp.value = String(i);
        var body = el('span', 'choice-body');
        body.appendChild(el('b', null, sv[0]));
        var pr = portion(food, i, 1, null);
        body.appendChild(el('small', null, fmt(pr.m[0]) + ' kcal' + (pr.grams ? ' · ' + Math.round(pr.grams) + ' g' : '')));
        lab.appendChild(inp); lab.appendChild(body); fs.appendChild(lab);
      });
      var hasGrams = !!food.p100;
      $('pf-grams-wrap').hidden = !hasGrams;
      // starting values
      var si = food.d || 0, qty = 1, grams = '';
      var src = entry || recentRow;
      if (src) {
        var idx = -1;
        food.sv.forEach(function (sv, i) { if (sv[0] === src.serving_label) idx = i; });
        var gm = /^(\d+(?:\.\d+)?) g$/.exec(src.serving_label || '');
        if (idx >= 0) { si = idx; qty = Number(src.quantity) || 1; }
        else if (gm && hasGrams) { grams = gm[1]; qty = 1; }
      }
      setRadio('pf-serving', String(si));
      $('pf-qty').value = String(qty);
      $('pf-grams').value = grams;
      setRadio('pf-meal', meal);
      $('pf-save').textContent = entry ? 'Save changes' : 'Add to ' + mealLabel(meal);
      $('pf-save').dataset.label = $('pf-save').textContent;
      $('pf-delete').hidden = !entry; resetDelete('pf-delete');
      api.setMsg('pf-msg', '');
      setForDay('pf-day', entry);
      updatePreview();
      api.show('portion');
      api.focusQuiet($('pf-title'));
    }
    function readPortion() {
      var si = parseInt(radio('pf-serving') || '0', 10);
      var gRaw = $('pf-grams').value.trim();
      var grams = gRaw ? C.parseNumber(gRaw) : null;
      var qty = C.parseNumber($('pf-qty').value);
      return { si: si, gRaw: gRaw, grams: grams, qty: qty };
    }
    function portionProblem(r) {
      if (r.gRaw) {
        if (r.grams === null || r.grams <= 0 || r.grams > 5000) return 'Enter a weight between 1 and 5,000 g, or clear the box to use the amount above.';
        return '';
      }
      if (r.qty === null || r.qty <= 0 || r.qty > 50) return 'Enter how many, between 0.25 and 50.';
      if (r.qty < 0.25) return 'Enter how many, between 0.25 and 50.';
      return '';
    }
    function updatePreview() {
      if (!pfFood) return;
      var r = readPortion();
      var bad = portionProblem(r);
      $('pf-qty').disabled = !!r.gRaw;
      $('pf-minus').disabled = !!r.gRaw; $('pf-plus').disabled = !!r.gRaw;
      if (bad) { ['pf-kcal', 'pf-p', 'pf-c', 'pf-f', 'pf-fib'].forEach(function (id) { $(id).textContent = '–'; }); return; }
      var pr = portion(pfFood, r.si, r.gRaw ? 1 : r.qty, r.gRaw ? r.grams : null);
      $('pf-kcal').textContent = fmt(pr.m[0]);
      $('pf-p').textContent = g1(pr.m[1]); $('pf-c').textContent = g1(pr.m[2]); $('pf-f').textContent = g1(pr.m[3]); $('pf-fib').textContent = g1(pr.m[4]);
    }
    $('pf-form').addEventListener('input', function (ev) {
      if (ev.target && ev.target.id !== 'pf-grams' && ev.target.id !== 'pf-qty') return;
      api.setMsg('pf-msg', ''); updatePreview();
    });
    $('pf-form').addEventListener('change', function (ev) {
      if (ev.target && ev.target.name === 'pf-serving') { $('pf-grams').value = ''; }
      if (ev.target && ev.target.name === 'pf-meal' && !editing) {
        $('pf-save').textContent = 'Add to ' + mealLabel(ev.target.value); $('pf-save').dataset.label = $('pf-save').textContent;
      }
      if (ev.target && (ev.target.type === 'radio')) api.setMsg('pf-msg', '');
      updatePreview();
    });
    function stepQty(dir) {
      var q = C.parseNumber($('pf-qty').value) || 1;
      var step = q < 1 || (q === 1 && dir < 0) ? 0.25 : 0.5;
      q = Math.round((q + dir * step) * 100) / 100;
      q = Math.min(50, Math.max(0.25, q));
      $('pf-qty').value = String(q);
      api.setMsg('pf-msg', ''); updatePreview();
    }
    $('pf-minus').addEventListener('click', function () { stepQty(-1); });
    $('pf-plus').addEventListener('click', function () { stepQty(1); });
    $('pf-back').addEventListener('click', function () {
      if (editing) api.showToday(''); else { api.show('addfood'); }
    });

    function rowFromPortion(food, r, meal) {
      var pr = portion(food, r.si, r.gRaw ? 1 : r.qty, r.gRaw ? r.grams : null);
      var sv = food.sv[r.si] || food.sv[0];
      var name = food.n + (food.st ? ' \u2014 ' + food.st.toLowerCase() : '');
      return {
        user_id: api.me().id, log_date: day, meal: meal, source: food.src, source_ref: food.id,
        brand: food.b || null, food_name: name.slice(0, 120),
        serving_label: (r.gRaw ? (Math.round(r.grams * 10) / 10) + ' g' : sv[0]).slice(0, 80),
        quantity: r.gRaw ? 1 : r.qty, grams: pr.grams,
        kcal: pr.m[0], protein_g: pr.m[1], carbs_g: pr.m[2], fat_g: pr.m[3], fibre_g: pr.m[4],
        is_estimate: !!food.est
      };
    }

    var saving = false;
    function saveRow(row, msgId, btnId) {
      if (saving) return;
      if (!navigator.onLine) { api.setMsg(msgId, "You're offline. Connect to the internet and try again — nothing was lost."); return; }
      saving = true;
      var btn = $(btnId);
      api.setBusy(btn, true, 'Saving…');
      var editId = editing ? editing.id : null;
      var wasEditing = editId !== null;
      var q = wasEditing
        ? sb.from('food_log').update(row).eq('id', editId).select().single()
        : sb.from('food_log').insert(row).select().single();
      q.then(function (res) {
        if (res.error) throw res.error;
        var saved = res.data || row;
        if (wasEditing) entries = entries.map(function (e) { return e.id === editId ? saved : e; });
        else entries.push(saved);
        if (wasEditing && saved.log_date !== day) entries = entries.filter(function (e) { return e.id !== saved.id; });
        editing = null;
        api.showToday(wasEditing ? 'Saved.' : 'Added to ' + mealLabel(row.meal) + '.', { keepEntries: true });
      }).catch(function (e) {
        console.warn('Food save failed:', e && (e.code || e.message));
        api.setMsg(msgId, api.friendly(e) + ' Nothing was lost — try again.');
      }).finally(function () {
        saving = false;
        api.setBusy(btn, false);
      });
    }

    $('pf-form').addEventListener('submit', function (ev) {
      ev.preventDefault();
      if (!pfFood || saving) return;
      var r = readPortion();
      var bad = portionProblem(r);
      if (bad) { api.setMsg('pf-msg', bad); return; }
      var meal = radio('pf-meal');
      if (!meal) { api.setMsg('pf-msg', 'Pick a meal.'); return; }
      saveRow(rowFromPortion(pfFood, r, meal), 'pf-msg', 'pf-save');
    });

    /* Delete needs two taps so a slip doesn't lose anything. */
    var deleteTimers = {};
    function resetDelete(id) {
      var b = $(id); clearTimeout(deleteTimers[id]);
      b.dataset.armed = ''; b.textContent = 'Delete this entry';
    }
    function wireDelete(id, msgId) {
      $(id).addEventListener('click', function () {
        var b = $(id);
        if (!editing || saving) return;
        if (b.dataset.armed !== '1') {
          b.dataset.armed = '1'; b.textContent = 'Tap again to delete';
          clearTimeout(deleteTimers[id]);
          deleteTimers[id] = setTimeout(function () { resetDelete(id); }, 4000);
          return;
        }
        if (!navigator.onLine) { api.setMsg(msgId, "You're offline. Connect to the internet and try again."); return; }
        saving = true;
        var target = editing;
        api.setBusy(b, true, 'Deleting…');
        sb.from('food_log').delete().eq('id', target.id).then(function (res) {
          if (res.error) throw res.error;
          entries = entries.filter(function (e) { return e.id !== target.id; });
          editing = null;
          api.showToday('Deleted.', { keepEntries: true });
        }).catch(function (e) {
          console.warn('Delete failed:', e && (e.code || e.message));
          api.setMsg(msgId, api.friendly(e));
        }).finally(function () { saving = false; api.setBusy(b, false); resetDelete(id); });
      });
    }
    wireDelete('pf-delete', 'pf-msg');
    wireDelete('cf-delete', 'cf-msg');

    /* ---------- edit an existing entry ---------- */
    function openEdit(e) {
      if (e.source !== 'custom' && e.source_ref) {
        loadFoods().then(function () {
          var f = findFood(e.source_ref);
          if (f) openPortion(f, e); else openCustom(e);
        }).catch(function () { openCustom(e); });
      } else {
        openCustom(e);
      }
    }

    /* ---------- your own food ---------- */
    $('af-custom').addEventListener('click', function () { openCustom(null, null, radio('af-meal') || defaultMeal()); });
    function numStr(v) { return v == null || v === '' ? '' : String(Math.round(Number(v) * 10) / 10); }
    function openCustom(entry, recentRow, meal) {
      editing = entry || null;
      var src = entry || recentRow || {};
      $('cf-title').textContent = entry ? 'Edit food' : 'Add your own food';
      $('cf-name').value = src.food_name || '';
      $('cf-serving').value = src.serving_label || '';
      var q = Number(src.quantity) || 1;
      // Custom entries are stored as totals; show totals (quantity folded in).
      $('cf-kcal').value = numStr(src.kcal);
      $('cf-p').value = numStr(src.protein_g); $('cf-c').value = numStr(src.carbs_g); $('cf-f').value = numStr(src.fat_g); $('cf-fib').value = numStr(src.fibre_g);
      if (q !== 1 && src.serving_label) $('cf-serving').value = (Math.round(q * 100) / 100) + ' × ' + src.serving_label;
      setRadio('cf-meal', entry ? entry.meal : (meal || radio('af-meal') || defaultMeal()));
      $('cf-save').textContent = entry ? 'Save changes' : 'Add';
      $('cf-save').dataset.label = $('cf-save').textContent;
      $('cf-delete').hidden = !entry; resetDelete('cf-delete');
      api.setMsg('cf-msg', '');
      setForDay('cf-day', entry);
      Array.prototype.forEach.call(document.querySelectorAll('#cf-form [aria-invalid]'), function (x) { x.removeAttribute('aria-invalid'); });
      api.show('custom');
      api.focusQuiet($('cf-title'));
    }
    $('cf-back').addEventListener('click', function () { if (editing) api.showToday(''); else api.show('addfood'); });
    $('cf-form').addEventListener('input', function () { api.setMsg('cf-msg', ''); });

    $('cf-form').addEventListener('submit', function (ev) {
      ev.preventDefault();
      if (saving) return;
      Array.prototype.forEach.call(document.querySelectorAll('#cf-form [aria-invalid]'), function (x) { x.removeAttribute('aria-invalid'); });
      var bad = function (id, text) { $(id).setAttribute('aria-invalid', 'true'); $(id).focus(); api.setMsg('cf-msg', text); };
      var name = $('cf-name').value.trim();
      if (!name || name.length > 120) return bad('cf-name', 'Give the food a name (up to 120 characters).');
      var kcalRaw = $('cf-kcal').value.trim();
      var kcal = C.parseNumber(kcalRaw);
      if (kcal === null || kcal > 10000) return bad('cf-kcal', 'Enter the calories (0 to 10,000).');
      var macros = {};
      var fields = [['cf-p', 'protein_g', 'protein'], ['cf-c', 'carbs_g', 'carbs'], ['cf-f', 'fat_g', 'fat'], ['cf-fib', 'fibre_g', 'fibre']];
      for (var i = 0; i < fields.length; i++) {
        var raw = $(fields[i][0]).value.trim();
        if (!raw) { macros[fields[i][1]] = null; continue; }
        var v = C.parseNumber(raw);
        if (v === null || v > 2000) return bad(fields[i][0], 'Check the ' + fields[i][2] + ' (0 to 2,000 g), or leave it empty.');
        macros[fields[i][1]] = Math.round(v * 10) / 10;
      }
      var meal = radio('cf-meal');
      if (!meal) return api.setMsg('cf-msg', 'Pick a meal.');
      var serving = $('cf-serving').value.trim().slice(0, 80) || '1 serving';
      saveRow({
        user_id: api.me().id, log_date: day, meal: meal, source: 'custom', source_ref: null, brand: null,
        food_name: name, serving_label: serving, quantity: 1, grams: null,
        kcal: Math.round(kcal * 10) / 10, protein_g: macros.protein_g, carbs_g: macros.carbs_g, fat_g: macros.fat_g, fibre_g: macros.fibre_g,
        is_estimate: false
      }, 'cf-msg', 'cf-save');
    });

    $('log-food').addEventListener('click', function () { openAdd(null); });

    /* ---------- Past 7 days ---------- */
    var weekToken = 0;
    function openWeek() {
      var token = ++weekToken;
      var today = C.localDate(), last = C.addDays(today, -1), first = C.addDays(today, -7);
      $('wk-range').textContent = C.shortDate(first) + ' – ' + C.shortDate(last) + ' (today isn’t counted yet)';
      $('wk-headline').textContent = 'Working it out…';
      $('wk-sub').textContent = '';
      $('wk-result').className = 'wk-result';
      $('wk-days').textContent = '';
      api.setMsg('wk-msg', ''); $('wk-retry').hidden = true;
      api.show('week');
      api.focusQuiet($('wk-title'));
      var uid = api.me().id;
      Promise.all([
        sb.from('food_log').select('log_date,kcal').eq('user_id', uid).gte('log_date', first).lte('log_date', last).limit(5000),
        sb.from('daily_targets').select('log_date,maintenance_kcal').eq('user_id', uid).gte('log_date', first).lte('log_date', last)
      ]).then(function (both) {
        if (token !== weekToken) return;
        if (both[0].error) throw both[0].error;
        var eaten = {}, maint = {};
        (both[0].data || []).forEach(function (r) { eaten[r.log_date] = (eaten[r.log_date] || 0) + (Number(r.kcal) || 0); });
        if (!both[1].error) (both[1].data || []).forEach(function (r) { maint[r.log_date] = Number(r.maintenance_kcal) || 0; });
        var now = C.numbers(api.profile());
        var fallback = now.ok ? now.maintenance : 0;
        var days = [];
        for (var i = 7; i >= 1; i--) {
          var d = C.addDays(today, -i);
          days.push({ date: d, eaten: d in eaten ? eaten[d] : null, maintenance: maint[d] || fallback, savedTarget: !!maint[d] });
        }
        renderWeek(days, today);
      }).catch(function (e) {
        if (token !== weekToken) return;
        console.warn('Week load failed:', e && (e.code || e.message));
        $('wk-headline').textContent = 'Couldn’t load your past 7 days.';
        api.setMsg('wk-msg', api.friendly(e) + ' Your logged food is safe.');
        $('wk-retry').hidden = false;
      });
    }
    function signed(n) { return (n > 0 ? '+' : n < 0 ? '−' : '') + fmt(Math.abs(n)); }
    function renderWeek(days, today) {
      var est = C.weekEstimate(days);
      var res = $('wk-result');
      if (!est.ready) {
        res.className = 'wk-result waiting';
        $('wk-headline').textContent = 'Log at least ' + C.WEEK_MIN_DAYS + ' days to see your estimate.';
        $('wk-sub').textContent = 'You have ' + est.loggedDays + ' of the last 7 days logged so far.';
      } else {
        res.className = 'wk-result ready ' + est.direction;
        $('wk-headline').textContent = est.direction === 'same'
          ? 'Based on the past 7 days, your weight has likely stayed about the same.'
          : 'Based on the past 7 days, you have likely ' + est.direction + ' about ' + est.kg + ' kg.';
        var tot = est.totalDiff;
        $('wk-sub').textContent = 'From ' + est.loggedDays + ' logged day' + (est.loggedDays === 1 ? '' : 's') + ' · ' +
          (tot < 0 ? fmt(-tot) + ' kcal below maintenance in total' : tot > 0 ? fmt(tot) + ' kcal above maintenance in total' : 'right on maintenance');
      }
      var list = $('wk-days'); list.textContent = '';
      var anyFallback = false;
      days.slice().reverse().forEach(function (d) {
        var li = el('li');
        var b = el('button', 'wk-day'); b.type = 'button';
        var left = el('span', 'entry-text');
        var label = C.dayName(d.date, today);
        left.appendChild(el('span', 'entry-name', (label === 'Yesterday' ? 'Yesterday · ' : '') + C.shortDate(d.date)));
        var right = el('span', 'wk-diff');
        if (d.eaten === null) {
          left.appendChild(el('span', 'entry-meta', 'Nothing logged — not counted'));
          b.classList.add('skipped');
          right.textContent = '–';
        } else {
          var diff = Math.round(d.eaten - d.maintenance);
          if (!d.savedTarget) anyFallback = true;
          left.appendChild(el('span', 'entry-meta', 'Ate ' + fmt(d.eaten) + ' · maintenance ' + fmt(d.maintenance) + (d.savedTarget ? '' : '*')));
          if (d.maintenance > 0 && d.eaten < d.maintenance / 2) left.appendChild(el('span', 'wk-flag', 'Only ' + fmt(d.eaten) + ' kcal logged — anything missing?'));
          right.textContent = signed(diff);
          right.appendChild(el('small', null, 'kcal'));
        }
        b.appendChild(left); b.appendChild(right);
        b.setAttribute('aria-label', C.longDate(d.date) + ': ' + (d.eaten === null ? 'nothing logged' : 'ate ' + fmt(d.eaten) + ' kilocalories, maintenance ' + fmt(d.maintenance)) + '. Open this day.');
        b.addEventListener('click', function () { api.showToday('', { day: d.date }); });
        li.appendChild(b); list.appendChild(li);
      });
      if (anyFallback) {
        var li2 = el('li', 'wk-foot muted small', '* No numbers were saved that day, so your current maintenance is used.');
        list.appendChild(li2);
      }
    }
    $('wk-back').addEventListener('click', function () { api.showToday(''); });
    $('wk-retry').addEventListener('click', openWeek);

    return {
      showDay: showDay,
      redraw: function () { renderDay(false); },
      day: function () { return day; },
      openAdd: openAdd,
      openWeek: openWeek,
      clear: function () { entries = []; day = null; dayTarget = null; recents = []; editing = null; dayToken++; weekToken++; }
    };
  }

  TaakatMeals.pure = pure;
  if (typeof module !== 'undefined' && module.exports) module.exports = pure;
  else root.TaakatMeals = TaakatMeals;
})(this);
