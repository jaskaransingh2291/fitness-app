/* Taakat — "Download my data": everything you've saved, as one file, plus a gentle monthly backup reminder.
   Only your own rows are included (never your crew's). Nothing leaves your phone except to you. */
(function (root) {
  'use strict';
  var TABLES = [   // [table, column that holds the owner, order by]
    ['profiles', 'id', 'id'],
    ['daily_targets', 'user_id', 'log_date'],
    ['food_log', 'user_id', 'id'],
    ['weigh_ins', 'user_id', 'log_date'],
    ['custom_exercises', 'user_id', 'id'],
    ['user_splits', 'user_id', 'id'],
    ['workout_sessions', 'user_id', 'id'],
    ['workout_exercises', 'user_id', 'id'],
    ['workout_sets', 'user_id', 'id']
  ];
  var PAGE = 1000, MAX_PAGES = 100;
  var REMIND_DAYS = 30, NEW_ACCOUNT_DAYS = 7, SNOOZE_DAYS = 7;

  function safeName(s) { return String(s || 'me').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'me'; }
  function fileName(name, isoDate) { return 'taakat-backup-' + safeName(name) + '-' + isoDate + '.json'; }
  function kb(bytes) { return bytes < 1024 * 1024 ? Math.max(1, Math.round(bytes / 1024)) + ' KB' : (Math.round(bytes / 104857.6) / 10) + ' MB'; }
  /* Should Today remind you? last = last_backup_at, created = profile created_at, snoozedUntil = ms, now = ms */
  function needsReminder(last, created, snoozedUntil, now) {
    now = now || Date.now();
    if (snoozedUntil && now < snoozedUntil) return false;
    if (last) { var t = Date.parse(last); return isFinite(t) && now - t > REMIND_DAYS * 86400000; }
    var c = Date.parse(created);
    return isFinite(c) && now - c > NEW_ACCOUNT_DAYS * 86400000;   // brand-new accounts aren't nagged
  }
  /* Build the file's contents. tables: { name: rows[] } */
  function buildBackup(tables, meta) {
    var counts = {};
    Object.keys(tables).forEach(function (k) { counts[k] = tables[k].length; });
    return {
      app: 'Taakat', what: 'Everything ' + (meta.name || 'you') + ' saved in Taakat (only your own data).',
      exported_at: meta.at, app_version: meta.version, email: meta.email || null,
      units: 'Food in grams/kcal. Body weight (weight_kg) in kg. Workout set weights are in the unit saved with each set (weight_unit).',
      counts: counts, tables: tables
    };
  }
  var pure = { fileName: fileName, needsReminder: needsReminder, buildBackup: buildBackup, kb: kb, TABLES: TABLES };

  /* ====================================================================== */
  function TaakatData(api) {
    var $ = api.$, sb = api.sb, C = api.C;
    var ready = null;       // { blob, name, size } once gathered
    var busy = false;

    function me() { return api.me(); }
    function snoozeKey() { return 'taakat-backup-snooze-' + (me() ? me().id : ''); }
    function snoozedUntil() { try { return Number(window.localStorage.getItem(snoozeKey())) || 0; } catch (e) { return 0; } }

    function fetchAll(table, col, order, uid) {
      var rows = [];
      function page(i) {
        if (i >= MAX_PAGES) return Promise.resolve(rows);
        return sb.from(table).select('*').eq(col, uid).order(order, { ascending: true }).range(i * PAGE, i * PAGE + PAGE - 1).then(function (res) {
          if (res.error) {
            // a table that doesn't exist yet (database not updated) is just skipped
            if (res.error.code === '42P01' || res.error.code === 'PGRST205') return rows;
            throw res.error;
          }
          rows = rows.concat(res.data || []);
          return (res.data || []).length < PAGE ? rows : page(i + 1);
        });
      }
      return page(0);
    }

    function lastLine() {
      var p = api.profile(), el = $('dl-last');
      if (!p) return;
      el.textContent = p.last_backup_at ? 'Last backup: ' + C.longDate(C.localDate(new Date(p.last_backup_at))) + '.' : 'You haven’t downloaded a backup yet.';
    }
    function reset() {
      ready = null; busy = false;
      $('dl-save').hidden = true; $('dl-prepare').hidden = false;
      api.setBusy($('dl-prepare'), false);
      api.setMsg('dl-msg', '');
      lastLine();
    }

    $('dl-prepare').addEventListener('click', function () {
      if (busy) return;
      if (!navigator.onLine) { api.setMsg('dl-msg', "You're offline. Connect to the internet and try again."); return; }
      var user = me(); if (!user) return;
      busy = true;
      var b = $('dl-prepare');
      api.setBusy(b, true, 'Gathering your data…');
      api.setMsg('dl-msg', '');
      var out = {};
      TABLES.reduce(function (p, t) {
        return p.then(function () { return fetchAll(t[0], t[1], t[2], user.id).then(function (rows) { out[t[0]] = rows; }); });
      }, Promise.resolve()).then(function () {
        if (!me() || me().id !== user.id) return;
        var today = C.localDate();
        var data = buildBackup(out, { name: api.profile() && api.profile().display_name, at: new Date().toISOString(), version: api.version, email: user.email });
        var text = JSON.stringify(data, null, 1);
        var blob = new Blob([text], { type: 'application/json' });
        ready = { blob: blob, name: fileName(api.profile() && api.profile().display_name, today), size: blob.size, counts: data.counts };
        var s = $('dl-save');
        s.textContent = 'Save the file (' + kb(blob.size) + ')';
        s.hidden = false; b.hidden = true;
        var c = data.counts;
        api.setMsg('dl-msg', 'Ready: ' + (c.food_log || 0) + ' food entries, ' + (c.workout_sessions || 0) + ' workouts, ' + (c.weigh_ins || 0) + ' weigh-ins. Tap Save and keep the file somewhere safe (e.g. iCloud Drive or Google Drive).', 'ok');
        api.focusQuiet(s);
      }).catch(function (e) {
        console.warn('Backup failed:', e && (e.code || e.message));
        api.setMsg('dl-msg', api.friendly(e) + ' Nothing was changed — try again.');
      }).finally(function () { busy = false; api.setBusy(b, false); });
    });

    /* Phones: the share sheet ("Save to Files"). Computers: a normal download. */
    $('dl-save').addEventListener('click', function () {
      if (!ready) return;
      var r = ready, done = function (how) { markDone(how); };
      var coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
      var file = null;
      try { file = new File([r.blob], r.name, { type: 'application/json' }); } catch (e) { file = null; }
      if (coarse && file && navigator.canShare && navigator.share && navigator.canShare({ files: [file] })) {
        navigator.share({ files: [file], title: r.name }).then(function () { done('share'); }).catch(function (e) {
          if (e && e.name === 'AbortError') { api.setMsg('dl-msg', 'Not saved. Tap Save again when you’re ready.'); return; }
          download(r); done('download');
        });
        return;
      }
      download(r); done('download');
    });
    function download(r) {
      var url = URL.createObjectURL(r.blob);
      var a = document.createElement('a');
      a.href = url; a.download = r.name; a.hidden = true;
      document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 10000);
    }
    function markDone(how) {
      var now = new Date().toISOString();
      api.setMsg('dl-msg', (how === 'share' ? 'Saved. ' : 'Downloaded ' + ready.name + '. ') + 'Taakat will remind you again in a month.', 'ok');
      var p = api.profile(); if (p) p.last_backup_at = now;
      try { window.localStorage.removeItem(snoozeKey()); } catch (e) { /* ignore */ }
      lastLine();
      nudge();
      sb.from('profiles').update({ last_backup_at: now }).eq('id', me().id).then(function (res) {
        if (res.error) console.warn('Could not record the backup date:', res.error.code || res.error.message);
      });
    }

    /* The reminder on Today */
    function nudge() {
      var p = api.profile(), box = $('backup-nudge');
      if (!p) { box.hidden = true; return; }
      var show = needsReminder(p.last_backup_at, p.created_at, snoozedUntil(), Date.now());
      box.hidden = !show;
      if (show) $('backup-nudge-text').textContent = p.last_backup_at
        ? 'It’s been over a month since your last backup (' + C.shortDate(C.localDate(new Date(p.last_backup_at))) + '). Download a fresh one so your logs are safe.'
        : 'You haven’t downloaded a backup of your logs yet. It takes a few seconds.';
    }
    $('backup-now').addEventListener('click', function () { api.openProfileData(); });
    $('backup-later').addEventListener('click', function () {
      try { window.localStorage.setItem(snoozeKey(), String(Date.now() + SNOOZE_DAYS * 86400000)); } catch (e) { /* ignore */ }
      $('backup-nudge').hidden = true;
    });

    return { reset: reset, nudge: nudge, clear: function () { ready = null; busy = false; } };
  }

  TaakatData.pure = pure;
  if (typeof module !== 'undefined' && module.exports) module.exports = pure;
  else root.TaakatData = TaakatData;
})(this);
