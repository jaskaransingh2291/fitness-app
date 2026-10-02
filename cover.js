/* Taakat — your cover photo behind the TRAINING title.
   The photo is shrunk on your phone first (JPEG, at most 600 KB) and stored in a PRIVATE Supabase folder
   ("covers", file <your id>/cover.jpg). Only you can see it (and later, crew you accept). */
(function (root) {
  'use strict';
  var MAX_BYTES = 600 * 1024, MAX_W = 1200, MAX_H = 1500, MAX_FILE = 30 * 1024 * 1024;

  /* Fit w×h inside the limits, never enlarging. */
  function fitSize(w, h, maxW, maxH) {
    maxW = maxW || MAX_W; maxH = maxH || MAX_H;
    if (!(w > 0 && h > 0)) return { w: 0, h: 0 };
    var s = Math.min(1, maxW / w, maxH / h);
    return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
  }
  function path(uid) { return String(uid) + '/cover.jpg'; }
  var pure = { fitSize: fitSize, path: path, MAX_BYTES: MAX_BYTES };

  /* ====================================================================== */
  function TaakatCover(api) {
    var $ = api.$, sb = api.sb;
    var cache = { key: null, url: null, uid: null };
    var busy = false, armTimer = null;

    function me() { return api.me(); }
    function key() { var p = api.profile(); return p && p.cover_updated_at ? String(p.cover_updated_at) : null; }

    /* Load the photo (once per version) as a private blob: URL. → Promise<url|null> */
    function photoUrl() {
      var k = key(), user = me();
      if (!k || !user) return Promise.resolve(null);
      if (cache.key === k && cache.uid === user.id && cache.url) return Promise.resolve(cache.url);
      return sb.storage.from('covers').download(path(user.id), { cacheNonce: k }).then(function (res) {
        if (res.error || !res.data) throw res.error || new Error('no photo');
        if (key() !== k || !me() || me().id !== user.id) return null;
        if (cache.url) URL.revokeObjectURL(cache.url);
        cache = { key: k, uid: user.id, url: URL.createObjectURL(res.data) };
        return cache.url;
      });
    }

    /* Training: paint the photo behind the title (or hide it). */
    function paintHero() {
      var hero = $('wo-hero'), img = $('wo-cover');
      if (!key()) { hero.hidden = true; img.removeAttribute('src'); return; }
      photoUrl().then(function (url) {
        if (!url) { hero.hidden = true; return; }
        img.onload = function () { hero.hidden = false; };
        img.onerror = function () { hero.hidden = true; };
        if (img.getAttribute('src') !== url) img.src = url; else hero.hidden = false;
      }).catch(function (e) {
        console.warn('Cover photo not loaded:', e && (e.statusCode || e.message));
        hero.hidden = true;
      });
    }

    /* Profile card */
    function card() {
      var has = !!key();
      $('cv-pick').textContent = has ? 'Change photo' : 'Choose a photo';
      $('cv-remove').hidden = !has;
      $('cv-remove').dataset.armed = ''; $('cv-remove').textContent = 'Remove photo';
      api.setMsg('cv-msg', '');
      var wrap = $('cv-preview-wrap'), img = $('cv-preview');
      if (!has) { wrap.hidden = true; img.removeAttribute('src'); return; }
      photoUrl().then(function (url) {
        if (!url) return;
        img.onload = function () { wrap.hidden = false; };
        img.src = url;
      }).catch(function () { api.setMsg('cv-msg', 'Couldn’t load your photo just now. You can still change or remove it.'); });
    }

    $('cv-pick').addEventListener('click', function () {
      if (busy) return;
      $('cv-file').value = '';
      $('cv-file').click();
    });
    $('cv-file').addEventListener('change', function () {
      var f = $('cv-file').files && $('cv-file').files[0];
      if (!f) return;
      if (!/^image\//.test(f.type || '')) { api.setMsg('cv-msg', 'That file isn’t a photo. Pick a JPEG, PNG or HEIC photo.'); return; }
      if (f.size > MAX_FILE) { api.setMsg('cv-msg', 'That photo is too big (over 30 MB). Pick a smaller one.'); return; }
      if (!navigator.onLine) { api.setMsg('cv-msg', "You're offline. Connect to the internet and try again."); return; }
      busy = true;
      var b = $('cv-pick');
      api.setBusy(b, true, 'Saving your photo…');
      api.setMsg('cv-msg', '');
      var user = me();
      shrink(f).then(function (blob) {
        return sb.storage.from('covers').upload(path(user.id), blob, { upsert: true, contentType: 'image/jpeg', cacheControl: '3600' });
      }).then(function (res) {
        if (res.error) throw res.error;
        var now = new Date().toISOString();
        return sb.from('profiles').update({ cover_updated_at: now }).eq('id', user.id).then(function (r2) {
          if (r2.error) throw r2.error;
          var p = api.profile(); if (p) p.cover_updated_at = now;
        });
      }).then(function () {
        busy = false; api.setBusy(b, false); delete b.dataset.label;
        card();
        api.setMsg('cv-msg', 'Saved. Your photo is behind the TRAINING title now.', 'ok');
      }).catch(function (e) {
        console.warn('Cover photo save failed:', e && (e.statusCode || e.code || e.message));
        busy = false; api.setBusy(b, false);
        api.setMsg('cv-msg', e && e.taakat ? e.taakat : api.friendly(e) + ' Your photo wasn’t saved — try again.');
      });
    });

    /* Shrink to ≤1200×1500 JPEG under 600 KB (lower quality, then smaller, until it fits). */
    function shrink(file) {
      return loadImage(file).then(function (img) {
        var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
        if (!(w > 0 && h > 0)) { var e = new Error('bad image'); e.taakat = 'Taakat couldn’t read that photo. Try a different one.'; throw e; }
        var attempts = [[1, 0.82], [1, 0.7], [1, 0.6], [0.8, 0.6], [0.6, 0.6], [0.45, 0.55]];
        function tryAt(i) {
          var a = attempts[i], sz = fitSize(w * a[0], h * a[0]);
          var c = document.createElement('canvas'); c.width = sz.w; c.height = sz.h;
          var ctx = c.getContext('2d'); ctx.fillStyle = '#121211'; ctx.fillRect(0, 0, sz.w, sz.h);
          ctx.drawImage(img, 0, 0, sz.w, sz.h);
          return new Promise(function (res) { c.toBlob(res, 'image/jpeg', a[1]); }).then(function (blob) {
            if (blob && blob.size <= MAX_BYTES) return blob;
            if (i + 1 < attempts.length) return tryAt(i + 1);
            var e2 = new Error('too big'); e2.taakat = 'Taakat couldn’t make that photo small enough. Try a different one.'; throw e2;
          });
        }
        return tryAt(0);
      });
    }
    function loadImage(file) {
      return new Promise(function (resolve, reject) {
        var url = URL.createObjectURL(file), img = new Image();
        img.onload = function () { resolve(img); setTimeout(function () { URL.revokeObjectURL(url); }, 1000); };
        img.onerror = function () { URL.revokeObjectURL(url); var e = new Error('unreadable'); e.taakat = 'Taakat couldn’t read that photo. Try a different one (JPEG or PNG works best).'; reject(e); };
        img.src = url;
      });
    }

    $('cv-remove').addEventListener('click', function () {
      if (busy) return;
      var b = $('cv-remove');
      if (b.dataset.armed !== '1') {
        b.dataset.armed = '1'; b.textContent = 'Tap again to remove your photo';
        clearTimeout(armTimer); armTimer = setTimeout(function () { b.dataset.armed = ''; b.textContent = 'Remove photo'; }, 4000);
        return;
      }
      if (!navigator.onLine) { api.setMsg('cv-msg', "You're offline. Connect to the internet and try again."); return; }
      busy = true;
      removePhoto().then(function () {
        card();
        api.setMsg('cv-msg', 'Removed your cover photo.', 'ok');
      }).catch(function (e) {
        console.warn('Cover photo remove failed:', e && (e.statusCode || e.code || e.message));
        api.setMsg('cv-msg', api.friendly(e) + ' Your photo is still there — try again.');
      }).finally(function () { busy = false; });
    });
    /* Also used by Delete account. Removes the file, then forgets it on your profile. */
    function removePhoto() {
      var user = me();
      if (!user) return Promise.resolve();
      return sb.storage.from('covers').remove([path(user.id)]).then(function (res) {
        if (res.error) throw res.error;
        return sb.from('profiles').update({ cover_updated_at: null }).eq('id', user.id);
      }).then(function (r2) {
        if (r2 && r2.error) throw r2.error;
        var p = api.profile(); if (p) p.cover_updated_at = null;
        if (cache.url) URL.revokeObjectURL(cache.url);
        cache = { key: null, url: null, uid: null };
      });
    }

    return {
      paintHero: paintHero, card: card, removePhoto: removePhoto, has: function () { return !!key(); },
      clear: function () { if (cache.url) URL.revokeObjectURL(cache.url); cache = { key: null, url: null, uid: null }; busy = false; }
    };
  }

  TaakatCover.pure = pure;
  if (typeof module !== 'undefined' && module.exports) module.exports = pure;
  else root.TaakatCover = TaakatCover;
})(this);
