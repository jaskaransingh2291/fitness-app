/* Taakat — Stage 5b: splits (ready-made + your own editable copies).
   A split = 1–7 days, each day = a list of exercises with a target (sets × reps, rest).
   Everything shown on screen uses textContent only. */
(function (root) {
  'use strict';

  var MAX_DAYS = 7, MAX_ITEMS = 15;
  var RESTS = ['', '60–90 sec', '2–3 min', '3–5 min'];

  function str(v, max) { return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : ''; }
  /* Make any stored/typed split safe to use: drop anything malformed, clamp sizes. */
  function cleanDays(days) {
    if (!Array.isArray(days)) return [];
    var out = [];
    days.slice(0, MAX_DAYS).forEach(function (d, i) {
      if (!d || typeof d !== 'object') return;
      var items = [];
      (Array.isArray(d.items) ? d.items : []).slice(0, MAX_ITEMS).forEach(function (it) {
        if (!it || typeof it !== 'object') return;
        var ref = str(it.ref, 40), name = str(it.name, 80);
        if (!ref || !name) return;
        var sets = parseInt(it.sets, 10); if (!(sets >= 1 && sets <= 10)) sets = 3;
        items.push({ ref: ref, name: name, sets: sets, reps: str(it.reps, 20), rest: str(it.rest, 20) });
      });
      out.push({ name: str(d.name, 40) || ('Day ' + (i + 1)), items: items });
    });
    return out;
  }
  /* Which day comes next: the one after the last finished day of this split (wraps round). */
  function nextDayNo(lastDayNo, dayCount) {
    if (!dayCount) return 1;
    var n = parseInt(lastDayNo, 10);
    if (!(n >= 1)) return 1;
    return n >= dayCount ? 1 : n + 1;
  }
  function targetText(it) {
    if (!it || !it.sets) return '';
    return it.sets + ' × ' + (it.reps || '—') + (it.rest ? ' · rest ' + it.rest : '');
  }
  /* Check a split before saving. → '' or a problem in plain words. */
  function splitProblem(name, days) {
    if (!str(name, 100) || str(name, 100).length > 60) return 'Give the split a name (up to 60 characters).';
    if (!days.length) return 'A split needs at least one day.';
    if (days.length > MAX_DAYS) return 'A split can have up to 7 days.';
    for (var i = 0; i < days.length; i++) {
      var d = days[i];
      if (!str(d.name, 100) || str(d.name, 100).length > 40) return 'Day ' + (i + 1) + ' needs a name (up to 40 characters).';
      if (!d.items.length) return '“' + d.name + '” has no exercises yet — add at least one.';
      if (d.items.length > MAX_ITEMS) return '“' + d.name + '” has more than ' + MAX_ITEMS + ' exercises.';
      for (var j = 0; j < d.items.length; j++) {
        var it = d.items[j], s = parseInt(it.sets, 10);
        if (!(s >= 1 && s <= 10) || String(it.sets).trim() !== String(s)) return '“' + it.name + '” on ' + d.name + ': sets must be a whole number from 1 to 10.';
        if (String(it.reps || '').length > 20) return '“' + it.name + '”: reps can be up to 20 characters (e.g. “8–12” or “45 sec”).';
      }
    }
    if (JSON.stringify(days).length > 28000) return 'That split is too big to save.';
    return '';
  }

  var pure = { cleanDays: cleanDays, nextDayNo: nextDayNo, targetText: targetText, splitProblem: splitProblem, MAX_DAYS: MAX_DAYS, MAX_ITEMS: MAX_ITEMS };

  /* ====================================================================== */
  function TaakatSplits(api) {
    var $ = api.$, sb = api.sb, wk = api.workouts;
    var templates = null, tplLoading = null;
    var mine = [];               // user_splits rows (days cleaned)
    var loaded = false, loadToken = 0;
    var nextNo = 1;              // next day number for the active split
    var viewing = null;          // { kind: 'tpl'|'mine', split }
    var draft = null;            // split being edited: { id|null, name, source_id, days }
    var dirty = false;
    var busy = {};

    function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
    function btn(cls, text, onClick, label) { var b = el('button', cls, text); b.type = 'button'; if (label) b.setAttribute('aria-label', label); b.addEventListener('click', onClick); return b; }
    function me() { return api.me().id; }
    function offline(msgId) { if (navigator.onLine) return false; api.setMsg(msgId, "You're offline. Connect to the internet and try again — nothing was lost."); return true; }
    function active() { return mine.filter(function (s) { return !!s.activated_at; }).sort(function (a, b) { return a.activated_at < b.activated_at ? 1 : -1; })[0] || null; }
    function copyOf(tplId) { return mine.filter(function (s) { return s.source_id === tplId; })[0] || null; }
    function clone(x) { return JSON.parse(JSON.stringify(x)); }

    function loadTemplates() {
      if (templates) return Promise.resolve(templates);
      if (tplLoading) return tplLoading;
      tplLoading = window.fetch('splits.json?v=' + encodeURIComponent(api.version)).then(function (r) {
        if (!r.ok) throw new Error('splits ' + r.status);
        return r.json();
      }).then(function (j) {
        if (!j || !Array.isArray(j.splits)) throw new Error('splits file broken');
        templates = j.splits.map(function (s) { s.days = cleanDays(s.days); return s; });
        return templates;
      }).catch(function (e) { tplLoading = null; throw e; });
      return tplLoading;
    }
    function loadMine() {
      var uid = me();
      return sb.from('user_splits').select('id,name,source_id,days,activated_at,updated_at').eq('user_id', uid)
        .order('activated_at', { ascending: false, nullsFirst: false }).order('id', { ascending: true }).limit(50)
        .then(function (res) {
          if (res.error) throw res.error;
          if (!api.me() || api.me().id !== uid) return mine;
          mine = (res.data || []).map(function (s) { s.days = cleanDays(s.days); return s; });
          loaded = true;
          return mine;
        });
    }
    function loadNext() {
      var a = active();
      if (!a) { nextNo = 1; return Promise.resolve(1); }
      return sb.from('workout_sessions').select('split_day_no,finished_at').eq('user_id', me()).eq('split_id', a.id)
        .not('finished_at', 'is', null).order('finished_at', { ascending: false }).limit(1)
        .then(function (res) {
          var last = !res.error && res.data && res.data[0] ? res.data[0].split_day_no : null;
          nextNo = nextDayNo(last, a.days.length);
          return nextNo;
        }, function () { nextNo = 1; return 1; });
    }

    /* ---------- the block at the top of the Training tab ---------- */
    function renderBlock(hasActiveWorkout) {
      var box = $('wo-split');
      var token = ++loadToken;
      box.hidden = false;
      box.textContent = '';
      box.appendChild(el('p', 'muted small', 'Loading your split…'));
      setStartStyle(false);
      Promise.all([loadMine(), loadTemplates().catch(function () { return null; })]).then(loadNext).then(function () {
        if (token !== loadToken || api.current() !== 'workouts') return;
        drawBlock(hasActiveWorkout);
      }).catch(function (e) {
        if (token !== loadToken) return;
        console.warn('Splits load failed:', e && (e.code || e.message));
        box.textContent = '';
        var m = el('p', 'msg error', api.friendly(e) + ' Your splits are safe.'); m.setAttribute('role', 'alert');
        box.appendChild(m);
        box.appendChild(btn('btn-link', 'Try again', function () { renderBlock(hasActiveWorkout); }));
      });
    }
    function setStartStyle(splitActive) {
      var s = $('wo-start');
      s.className = splitActive ? 'btn-secondary wo-start-empty' : 'btn-primary wo-start';
      s.textContent = splitActive ? 'Start an empty workout' : 'Start workout';
    }
    function drawBlock(hasActiveWorkout) {
      var box = $('wo-split'); box.textContent = '';
      var a = active();
      if (!a) {
        setStartStyle(false);
        box.appendChild(btn('btn-secondary sp-choose', 'Choose a split', openChoose));
        box.appendChild(el('p', 'muted small sp-hint', 'Follow a plan like Push / Pull / Legs — or build your own.'));
        return;
      }
      setStartStyle(true);
      var d = a.days[nextNo - 1] || a.days[0];
      var head = el('div', 'sp-next');
      head.appendChild(el('p', 'sp-label', 'Your split · ' + a.name));
      head.appendChild(el('p', 'sp-label sp-up', 'Next up'));
      head.appendChild(el('h3', 'sp-day', d.name));
      head.appendChild(el('p', 'muted small sp-meta', 'Day ' + nextNo + ' of ' + a.days.length + ' · ' + d.items.length + (d.items.length === 1 ? ' exercise' : ' exercises')));
      box.appendChild(head);
      if (hasActiveWorkout) {
        box.appendChild(el('p', 'muted small', 'Finish or discard the workout above before starting the next one.'));
      } else {
        var go = btn('btn-primary sp-start', 'Start day ' + nextNo, function () { startDay(a, nextNo, go); }, 'Start day ' + nextNo + ', ' + d.name);
        go.id = 'sp-start';
        box.appendChild(go);
      }
      var links = el('div', 'sp-links');
      if (!hasActiveWorkout) links.appendChild(btn('btn-link', 'Other day', openDayPick));
      links.appendChild(btn('btn-link', 'Edit split', function () { openEdit(a); }));
      links.appendChild(btn('btn-link', 'Change split', openChoose));
      box.appendChild(links);
      var m = el('p', 'msg', ''); m.id = 'sp-msg'; m.hidden = true; m.setAttribute('role', 'alert');
      box.appendChild(m);
    }

    function startDay(split, dayNo, button) {
      if (busy.start) return;
      if (offline('wo-err')) return;
      busy.start = true;
      if (button) api.setBusy(button, true, 'Starting…');
      var day = split.days[dayNo - 1];
      wk.startSplitWorkout(split, dayNo, day).catch(function (e) {
        console.warn('Start split day failed:', e && (e.code || e.message));
        api.setMsg('wo-err', api.friendly(e) + ' Try again.');
      }).finally(function () { busy.start = false; if (button) api.setBusy(button, false); });
    }

    /* ---------- pick a different day ---------- */
    function openDayPick() {
      var a = active(); if (!a) return;
      var list = $('dp-list'); list.textContent = '';
      $('dp-sub').textContent = a.name;
      a.days.forEach(function (d, i) {
        var li = el('li');
        var b = btn('wk-day dp-day', '', function () { startDay(a, i + 1, b); });
        var t = el('span', 'entry-text');
        t.appendChild(el('span', 'entry-name', 'Day ' + (i + 1) + ' · ' + d.name));
        t.appendChild(el('span', 'entry-meta', d.items.length + (d.items.length === 1 ? ' exercise' : ' exercises') + (i + 1 === nextNo ? ' · next up' : '')));
        b.appendChild(t);
        b.setAttribute('aria-label', 'Start day ' + (i + 1) + ', ' + d.name);
        li.appendChild(b); list.appendChild(li);
      });
      api.setMsg('dp-msg', '');
      api.show('daypick');
      api.focusQuiet($('dp-title'));
    }
    $('dp-back').addEventListener('click', function () { wk.open(''); });

    /* ---------- choose a split ---------- */
    function openChoose() {
      api.show('splits');
      api.focusQuiet($('sl-title'));
      api.setMsg('sl-msg', '');
      var minebox = $('sl-mine'), tplbox = $('sl-tpl');
      minebox.textContent = ''; tplbox.textContent = '';
      $('sl-mine-wrap').hidden = true;
      tplbox.appendChild(el('li', 'muted small', 'Loading…'));
      Promise.all([loadTemplates(), loaded ? Promise.resolve(mine) : loadMine()]).then(function () {
        if (api.current() !== 'splits') return;
        drawChoose();
      }).catch(function (e) {
        tplbox.textContent = '';
        api.setMsg('sl-msg', api.friendly(e) + ' Go back and try again.');
      });
    }
    function drawChoose() {
      var minebox = $('sl-mine'), tplbox = $('sl-tpl');
      minebox.textContent = ''; tplbox.textContent = '';
      var a = active();
      $('sl-mine-wrap').hidden = !mine.length;
      mine.forEach(function (s) {
        var li = el('li');
        var b = btn('wk-day sl-item', '', function () { openView('mine', s); });
        var t = el('span', 'entry-text');
        t.appendChild(el('span', 'entry-name', s.name));
        t.appendChild(el('span', 'entry-meta', s.days.length + (s.days.length === 1 ? ' day' : ' days') + (a && a.id === s.id ? ' · following now' : '')));
        b.appendChild(t);
        if (a && a.id === s.id) b.appendChild(el('span', 'sl-on', 'On'));
        li.appendChild(b); minebox.appendChild(li);
      });
      (templates || []).forEach(function (s) {
        var li = el('li');
        var b = btn('wk-day sl-item', '', function () { var c = copyOf(s.id); if (c) openView('mine', c); else openView('tpl', s); });
        var t = el('span', 'entry-text');
        t.appendChild(el('span', 'entry-name', s.n));
        t.appendChild(el('span', 'entry-meta', s.dpw + ' days a week · ' + s.lv + (copyOf(s.id) ? ' · you have a copy' : '')));
        b.appendChild(t);
        li.appendChild(b); tplbox.appendChild(li);
      });
    }
    $('sl-back').addEventListener('click', function () { wk.open(''); });
    $('sl-blank').addEventListener('click', function () {
      if (mine.length >= 20) { api.setMsg('sl-msg', 'You have 20 splits already — delete one you don’t use first.'); return; }
      openEdit(null);
    });

    /* ---------- look at one split ---------- */
    function openView(kind, s) {
      viewing = { kind: kind, split: s };
      var tpl = kind === 'tpl' ? s : (s.source_id && templates ? templates.filter(function (t) { return t.id === s.source_id; })[0] : null);
      var a = active();
      $('sv-title').textContent = kind === 'tpl' ? s.n : s.name;
      $('sv-meta').textContent = kind === 'tpl' ? s.dpw + ' days a week · ' + s.lv + ' · ' + s.freq
        : s.days.length + (s.days.length === 1 ? ' day' : ' days') + (tpl ? ' · your copy of ' + tpl.n : ' · built by you');
      $('sv-about').hidden = kind !== 'tpl';
      if (kind === 'tpl') { $('sv-good').textContent = s.good; $('sv-trade').textContent = s.trade; $('sv-sched').textContent = 'Usual week: ' + s.sched + '. Taakat just goes in order, so a missed day never throws you off.'; }
      var days = $('sv-days'); days.textContent = '';
      s.days.forEach(function (d, i) {
        var sec = el('section', 'sv-day');
        sec.appendChild(el('h3', 'sv-day-name', 'Day ' + (i + 1) + ' · ' + d.name));
        var ul = el('ul', 'sv-items');
        d.items.forEach(function (it) {
          var li = el('li');
          li.appendChild(el('span', 'sv-item-name', it.name));
          var t = el('span', 'sv-item-t', it.sets + ' × ' + (it.reps || '—'));
          if (it.rest) t.appendChild(el('small', null, 'rest ' + it.rest));
          li.appendChild(t);
          ul.appendChild(li);
        });
        if (!d.items.length) ul.appendChild(el('li', 'muted', 'No exercises yet'));
        sec.appendChild(ul); days.appendChild(sec);
      });
      var isOn = kind === 'mine' && a && a.id === s.id;
      $('sv-use').hidden = isOn;
      $('sv-use').textContent = 'Use this split';
      $('sv-on').hidden = !isOn;
      $('sv-edit').hidden = kind !== 'mine';
      $('sv-reset').hidden = !(kind === 'mine' && tpl);
      $('sv-delete').hidden = kind !== 'mine';
      ['sv-reset', 'sv-delete'].forEach(function (id) { $(id).dataset.armed = ''; });
      $('sv-reset').textContent = 'Reset to the original plan';
      $('sv-delete').textContent = 'Delete this split';
      api.setMsg('sv-msg', '');
      api.show('splitview');
      api.focusQuiet($('sv-title'));
    }
    $('sv-back').addEventListener('click', function () { openChoose(); });
    $('sv-edit').addEventListener('click', function () { if (viewing && viewing.kind === 'mine') openEdit(viewing.split); });

    $('sv-use').addEventListener('click', function () {
      if (!viewing || busy.use) return;
      if (offline('sv-msg')) return;
      busy.use = true;
      var b = $('sv-use');
      api.setBusy(b, true, 'Saving…');
      var now = new Date().toISOString();
      var q, name;
      if (viewing.kind === 'tpl') {
        var t = viewing.split; name = t.n;
        if (mine.length >= 20) { busy.use = false; api.setBusy(b, false); api.setMsg('sv-msg', 'You have 20 splits already — delete one you don’t use first.'); return; }
        q = sb.from('user_splits').insert({ user_id: me(), name: t.n.slice(0, 60), source_id: t.id, days: clone(t.days), activated_at: now }).select().single();
      } else {
        name = viewing.split.name;
        q = sb.from('user_splits').update({ activated_at: now }).eq('id', viewing.split.id).select().single();
      }
      q.then(function (res) {
        if (res.error) throw res.error;
        return loadMine();
      }).then(function () {
        wk.open('Now following ' + name + '.');
      }).catch(function (e) {
        console.warn('Use split failed:', e && (e.code || e.message));
        api.setMsg('sv-msg', api.friendly(e) + ' Nothing changed — try again.');
      }).finally(function () { busy.use = false; api.setBusy(b, false); });
    });

    var armTimers = {};
    function arm(id, text, restore) {
      var b = $(id);
      if (b.dataset.armed === '1') return true;
      b.dataset.armed = '1'; b.textContent = text;
      clearTimeout(armTimers[id]);
      armTimers[id] = setTimeout(function () { b.dataset.armed = ''; b.textContent = restore; }, 4000);
      return false;
    }
    $('sv-reset').addEventListener('click', function () {
      if (!viewing || viewing.kind !== 'mine' || busy.reset) return;
      var s = viewing.split;
      var tpl = templates && templates.filter(function (t) { return t.id === s.source_id; })[0];
      if (!tpl) return;
      if (!arm('sv-reset', 'Tap again — your changes to this split will be undone', 'Reset to the original plan')) return;
      if (offline('sv-msg')) return;
      busy.reset = true;
      sb.from('user_splits').update({ days: clone(tpl.days), name: tpl.n.slice(0, 60), updated_at: new Date().toISOString() }).eq('id', s.id).select().single().then(function (res) {
        if (res.error) throw res.error;
        return loadMine();
      }).then(function () {
        var fresh = mine.filter(function (x) { return x.id === s.id; })[0];
        if (fresh) openView('mine', fresh);
        api.setMsg('sv-msg', 'Back to the original ' + tpl.n + '.', 'ok');
      }).catch(function (e) {
        api.setMsg('sv-msg', api.friendly(e) + ' Nothing changed.');
      }).finally(function () { busy.reset = false; });
    });
    $('sv-delete').addEventListener('click', function () {
      if (!viewing || viewing.kind !== 'mine' || busy.del) return;
      if (!arm('sv-delete', 'Tap again to delete (your past workouts stay)', 'Delete this split')) return;
      if (offline('sv-msg')) return;
      busy.del = true;
      var s = viewing.split;
      sb.from('user_splits').delete().eq('id', s.id).then(function (res) {
        if (res.error) throw res.error;
        return loadMine();
      }).then(function () {
        openChoose();
        api.setMsg('sl-msg', 'Deleted ' + s.name + '. Your past workouts are still there.', 'ok');
      }).catch(function (e) {
        api.setMsg('sv-msg', api.friendly(e) + ' Nothing was deleted.');
      }).finally(function () { busy.del = false; });
    });

    /* ---------- edit (or build from blank) ---------- */
    function openEdit(s) {
      draft = s ? { id: s.id, name: s.name, source_id: s.source_id || null, days: clone(s.days) }
        : { id: null, name: 'My split', source_id: null, days: [{ name: 'Day 1', items: [] }] };
      dirty = !s;
      $('se-title').textContent = s ? 'Edit split' : 'Build your split';
      $('se-save').textContent = s ? 'Save changes' : 'Save & follow this split';
      $('se-back').dataset.armed = ''; $('se-back').textContent = '‹ Back';
      api.setMsg('se-msg', '');
      drawEdit();
      api.show('splitedit');
      api.focusQuiet($('se-title'));
    }
    function setDirty() { dirty = true; api.setMsg('se-msg', ''); }
    function drawEdit(focusSel) {
      $('se-name').value = draft.name;
      var box = $('se-days'); box.textContent = '';
      draft.days.forEach(function (d, di) {
        var sec = el('section', 'se-day');
        var head = el('div', 'se-day-head');
        head.appendChild(el('span', 'se-day-no', 'Day ' + (di + 1)));
        var tools = el('div', 'se-tools');
        tools.appendChild(btn('se-icon', '↑', function () { moveDay(di, -1); }, 'Move day ' + (di + 1) + ' up'));
        tools.appendChild(btn('se-icon', '↓', function () { moveDay(di, 1); }, 'Move day ' + (di + 1) + ' down'));
        var rmDay = btn('se-icon se-x', '✕', function () { removeDay(di, rmDay); }, 'Remove day ' + (di + 1));
        tools.appendChild(rmDay);
        head.appendChild(tools);
        sec.appendChild(head);
        var nl = el('label', 'sr-only', 'Name of day ' + (di + 1)); var nid = 'se-dn-' + di; nl.htmlFor = nid;
        var ni = document.createElement('input'); ni.type = 'text'; ni.id = nid; ni.maxLength = 40; ni.className = 'se-day-name'; ni.value = d.name; ni.autocomplete = 'off';
        ni.addEventListener('input', function () { d.name = ni.value; setDirty(); });
        sec.appendChild(nl); sec.appendChild(ni);
        var ul = el('ul', 'se-items');
        d.items.forEach(function (it, ii) {
          var li = el('li', 'se-item');
          var top = el('div', 'se-item-top');
          top.appendChild(el('span', 'se-item-name', it.name));
          var t2 = el('div', 'se-tools');
          t2.appendChild(btn('se-icon', '↑', function () { moveItem(di, ii, -1); }, 'Move ' + it.name + ' up'));
          t2.appendChild(btn('se-icon', '↓', function () { moveItem(di, ii, 1); }, 'Move ' + it.name + ' down'));
          t2.appendChild(btn('se-icon se-x', '✕', function () { d.items.splice(ii, 1); setDirty(); drawEdit(); }, 'Remove ' + it.name + ' from ' + d.name));
          top.appendChild(t2);
          li.appendChild(top);
          var grid = el('div', 'se-target');
          function field(labelText, key, mode, max, w) {
            var wrap = el('div', 'se-f');
            var id = 'se-' + key + '-' + di + '-' + ii;
            var l = el('label', null, labelText); l.htmlFor = id;
            var inp = document.createElement('input'); inp.type = 'text'; inp.id = id; inp.inputMode = mode; inp.maxLength = max; inp.autocomplete = 'off'; inp.value = it[key] == null ? '' : String(it[key]);
            inp.addEventListener('input', function () { it[key] = key === 'sets' ? inp.value.trim() : inp.value; setDirty(); });
            wrap.appendChild(l); wrap.appendChild(inp); grid.appendChild(wrap);
          }
          field('Sets', 'sets', 'numeric', 2);
          field('Reps', 'reps', 'text', 20);
          var rw = el('div', 'se-f');
          var rid = 'se-rest-' + di + '-' + ii;
          var rl = el('label', null, 'Rest'); rl.htmlFor = rid;
          var sel = document.createElement('select'); sel.id = rid;
          var opts = RESTS.slice(); if (it.rest && opts.indexOf(it.rest) === -1) opts.push(it.rest);
          opts.forEach(function (o) { var op = document.createElement('option'); op.value = o; op.textContent = o || '—'; if (o === (it.rest || '')) op.selected = true; sel.appendChild(op); });
          sel.addEventListener('change', function () { it.rest = sel.value; setDirty(); });
          rw.appendChild(rl); rw.appendChild(sel); grid.appendChild(rw);
          li.appendChild(grid);
          ul.appendChild(li);
        });
        sec.appendChild(ul);
        var add = btn('btn-link se-add-ex', '+ Add exercise to ' + (d.name || 'this day'), function () { addItem(di); });
        add.disabled = d.items.length >= MAX_ITEMS;
        sec.appendChild(add);
        box.appendChild(sec);
      });
      $('se-add-day').disabled = draft.days.length >= MAX_DAYS;
      if (focusSel) { var f = document.querySelector(focusSel); if (f) api.focusQuiet(f); }
    }
    $('se-name').addEventListener('input', function () { draft.name = $('se-name').value; setDirty(); });
    function moveDay(i, dir) {
      var j = i + dir; if (j < 0 || j >= draft.days.length) return;
      var t = draft.days[i]; draft.days[i] = draft.days[j]; draft.days[j] = t; setDirty(); drawEdit();
    }
    function moveItem(di, ii, dir) {
      var items = draft.days[di].items, j = ii + dir; if (j < 0 || j >= items.length) return;
      var t = items[ii]; items[ii] = items[j]; items[j] = t; setDirty(); drawEdit();
    }
    function removeDay(di, b) {
      if (draft.days.length <= 1) { api.setMsg('se-msg', 'A split needs at least one day.'); return; }
      if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = 'Sure?'; b.classList.add('armed'); setTimeout(function () { if (b.isConnected) { b.dataset.armed = ''; b.textContent = '✕'; b.classList.remove('armed'); } }, 4000); return; }
      draft.days.splice(di, 1); setDirty(); drawEdit();
    }
    $('se-add-day').addEventListener('click', function () {
      if (draft.days.length >= MAX_DAYS) return;
      draft.days.push({ name: 'Day ' + (draft.days.length + 1), items: [] }); setDirty();
      drawEdit('#se-dn-' + (draft.days.length - 1));
    });
    function addItem(di) {
      var d = draft.days[di];
      if (d.items.length >= MAX_ITEMS) return;
      wk.pickExercise({
        title: 'Add to ' + (d.name || 'day ' + (di + 1)),
        onPick: function (x) {
          d.items.push({ ref: x.id, name: String(x.n).slice(0, 80), sets: 3, reps: x.tt === 'time' || x.tt === 'weight_time' ? '30 sec' : '8–12', rest: '60–90 sec' });
          setDirty();
          api.show('splitedit'); drawEdit();
          var items = document.querySelectorAll('#se-days .se-day')[di].querySelectorAll('.se-item');
          if (items.length && items[items.length - 1].scrollIntoView) items[items.length - 1].scrollIntoView({ block: 'center' });
          api.setMsg('se-msg', 'Added ' + x.n + '. Don’t forget to save.', 'ok');
        },
        onBack: function () { api.show('splitedit'); drawEdit(); }
      });
    }
    $('se-back').addEventListener('click', function () {
      if (dirty && !arm('se-back', 'Tap again to leave without saving', '‹ Back')) return;
      dirty = false;
      if (draft && draft.id) { var s = mine.filter(function (x) { return x.id === draft.id; })[0]; if (s) { openView('mine', s); return; } }
      openChoose();
    });
    $('se-form').addEventListener('submit', function (ev) {
      ev.preventDefault();
      if (!draft || busy.save) return;
      draft.name = $('se-name').value;
      var days = draft.days.map(function (d) {
        return { name: str(d.name, 100), items: d.items.map(function (it) { return { ref: it.ref, name: it.name, sets: it.sets, reps: str(String(it.reps || ''), 100), rest: str(it.rest || '', 20) }; }) };
      });
      var problem = splitProblem(draft.name, days);
      if (problem) { api.setMsg('se-msg', problem); return; }
      days = days.map(function (d) { return { name: d.name, items: d.items.map(function (it) { return { ref: it.ref, name: it.name, sets: parseInt(it.sets, 10), reps: it.reps, rest: it.rest }; }) }; });
      if (offline('se-msg')) return;
      busy.save = true;
      var b = $('se-save');
      api.setBusy(b, true, 'Saving…');
      var name = str(draft.name, 60), now = new Date().toISOString();
      var q = draft.id
        ? sb.from('user_splits').update({ name: name, days: days, updated_at: now }).eq('id', draft.id).select().single()
        : sb.from('user_splits').insert({ user_id: me(), name: name, source_id: null, days: days, activated_at: now }).select().single();
      var wasNew = !draft.id;
      q.then(function (res) {
        if (res.error) throw res.error;
        dirty = false;
        return loadMine();
      }).then(function () {
        wk.open(wasNew ? 'Saved — now following ' + name + '.' : 'Saved ' + name + '.');
      }).catch(function (e) {
        console.warn('Split save failed:', e && (e.code || e.message));
        api.setMsg('se-msg', api.friendly(e) + ' Your changes are still here — try again.');
      }).finally(function () { busy.save = false; api.setBusy(b, false); });
    });

    /* Called by a workout's "Swap" with "Also change my plan" ticked. */
    function swapInPlan(splitId, dayNo, oldRef, x) {
      var s = mine.filter(function (m) { return m.id === splitId; })[0];
      var p = s ? Promise.resolve(s) : loadMine().then(function () { return mine.filter(function (m) { return m.id === splitId; })[0]; });
      return p.then(function (sp) {
        if (!sp) throw new Error('That split no longer exists.');
        var days = clone(sp.days), d = days[dayNo - 1];
        if (!d) throw new Error('That day is no longer in your split.');
        var it = d.items.filter(function (i) { return i.ref === oldRef; })[0];
        if (!it) throw new Error('That exercise is no longer in your plan.');
        it.ref = x.id; it.name = String(x.n).slice(0, 80);
        return sb.from('user_splits').update({ days: days, updated_at: new Date().toISOString() }).eq('id', sp.id).select().single().then(function (res) {
          if (res.error) throw res.error;
          sp.days = cleanDays(res.data.days);
          return true;
        });
      });
    }

    return {
      renderBlock: renderBlock,
      swapInPlan: swapInPlan,
      clear: function () { mine = []; loaded = false; viewing = null; draft = null; dirty = false; loadToken++; busy = {}; }
    };
  }

  TaakatSplits.pure = pure;
  if (typeof module !== 'undefined' && module.exports) module.exports = pure;
  else root.TaakatSplits = TaakatSplits;
})(this);
