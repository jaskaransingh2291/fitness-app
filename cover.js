/* Taakat — your cover photo behind the Training title.
   You frame it first (pinch to zoom, drag to move, 4:5), then it's saved on your phone as a JPEG (at most 600 KB) and stored in a PRIVATE Supabase folder
   ("covers", file <your id>/cover.jpg). Only you can see it (and later, crew you accept). */
(function (root) {
  'use strict';
  var MAX_BYTES = 600 * 1024, MAX_W = 1200, MAX_H = 1500, MAX_FILE = 30 * 1024 * 1024;
  var OUT_W = 1080, OUT_H = 1350, MAX_ZOOM = 4;     // the cover is framed 4:5 (the shape of the Training hero)

  /* Fit w×h inside the limits, never enlarging. */
  function fitSize(w, h, maxW, maxH) {
    maxW = maxW || MAX_W; maxH = maxH || MAX_H;
    if (!(w > 0 && h > 0)) return { w: 0, h: 0 };
    var s = Math.min(1, maxW / w, maxH / h);
    return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
  }
  function path(uid) { return String(uid) + '/cover.jpg'; }
  /* Framing maths. The photo (w×h) fills a frame (W×H) at zoom 1 ("cover"); x,y = where its top-left sits in the frame. */
  function baseScale(w, h, W, H) { return Math.max(W / w, H / h); }
  /* Keep the frame covered: the photo can't be dragged so far that an edge shows. */
  function clampPos(x, y, w, h, s, W, H) {
    return { x: Math.min(0, Math.max(W - w * s, x)), y: Math.min(0, Math.max(H - h * s, y)) };
  }
  /* Zoom to z while keeping the photo point under (px,py) in the same place. */
  function zoomAt(st, z, px, py) {
    z = Math.min(MAX_ZOOM, Math.max(1, z));
    var s0 = st.s0 * st.z, s1 = st.s0 * z;
    var ix = (px - st.x) / s0, iy = (py - st.y) / s0;
    var p = clampPos(px - ix * s1, py - iy * s1, st.w, st.h, s1, st.W, st.H);
    return { z: z, x: p.x, y: p.y };
  }
  /* The part of the original photo that is inside the frame → source rectangle for the canvas. */
  function cropRect(st) {
    var s = st.s0 * st.z;
    return { sx: -st.x / s, sy: -st.y / s, sw: st.W / s, sh: st.H / s };
  }
  var pure = { fitSize: fitSize, path: path, MAX_BYTES: MAX_BYTES, baseScale: baseScale, clampPos: clampPos, zoomAt: zoomAt, cropRect: cropRect };

  /* ====================================================================== */
  function TaakatCover(api) {
    var $ = api.$, sb = api.sb;
    var cache = {};            // uid → { key, url }: one private blob: URL per person (you + crew you view)
    function dropCache(uid) { Object.keys(cache).forEach(function (k) { if (!uid || k === uid) { URL.revokeObjectURL(cache[k].url); delete cache[k]; } }); }
    var busy = false, armTimer = null;

    function me() { return api.me(); }
    /* Training shows the cover of whoever's logs are on screen (you, or crew you're viewing). */
    function who() { return api.owner ? api.owner() : me(); }
    function whoProfile() { return api.ownerProfile ? api.ownerProfile() : api.profile(); }
    function key() { var p = api.profile(); return p && p.cover_updated_at ? String(p.cover_updated_at) : null; }
    function keyOf(p) { return p && p.cover_updated_at ? String(p.cover_updated_at) : null; }

    /* Load the photo (once per version) as a private blob: URL. → Promise<url|null> */
    function photoUrl(forWho) {
      var user = forWho ? who() : me(), k = forWho ? keyOf(whoProfile()) : key();
      if (!k || !user) return Promise.resolve(null);
      var c = cache[user.id];
      if (c && c.key === k) return Promise.resolve(c.url);
      return sb.storage.from('covers').download(path(user.id), { cacheNonce: k }).then(function (res) {
        if (res.error || !res.data) throw res.error || new Error('no photo');
        if (!me() || (forWho ? (keyOf(whoProfile()) !== k || who().id !== user.id) : (key() !== k || me().id !== user.id))) return null;
        dropCache(user.id);
        cache[user.id] = { key: k, url: URL.createObjectURL(res.data) };
        return cache[user.id].url;
      });
    }

    /* Training: paint the photo behind the title (or hide it). */
    function paintHero() {
      var hero = $('wo-hero'), img = $('wo-cover');
      if (!keyOf(whoProfile())) { hero.hidden = true; img.removeAttribute('src'); return; }
      photoUrl(true).then(function (url) {
        if (!url) { hero.hidden = true; return; }
        img.onload = function () { hero.hidden = false; heroScroll(); };
        img.onerror = function () { hero.hidden = true; };
        if (img.getAttribute('src') !== url) img.src = url; else { hero.hidden = false; heroScroll(); }
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
      api.setMsg('cv-msg', '');
      openCrop(f);
    });

    /* ---------- framing: pinch to zoom, drag to move ---------- */
    var cs = null;              // { w, h, W, H, s0, z, x, y, url }
    var pointers = {}, gesture = null, lastFocus = null;
    function openCrop(file) {
      var img = $('cvc-img'), url = URL.createObjectURL(file);
      api.setMsg('cvc-msg', '');
      img.onload = function () {
        var w = img.naturalWidth, h = img.naturalHeight;
        if (!(w > 0 && h > 0)) { closeCrop(); api.setMsg('cv-msg', 'Taakat couldn’t read that photo. Try a different one.'); return; }
        lastFocus = document.activeElement;
        $('cv-crop').hidden = false;
        document.body.classList.add('cvc-open');
        var F = $('cvc-frame'), W = F.clientWidth, H = F.clientHeight;
        var s0 = baseScale(w, h, W, H);
        cs = { w: w, h: h, W: W, H: H, s0: s0, z: 1, x: (W - w * s0) / 2, y: (H - h * s0) / 2, url: url };
        $('cvc-zoom').value = '1';
        draw();
        api.focusQuiet($('cvc-title'));
      };
      img.onerror = function () { URL.revokeObjectURL(url); api.setMsg('cv-msg', 'Taakat couldn’t read that photo. Try a different one (JPEG or PNG works best).'); };
      img.src = url;
    }
    function draw() {
      if (!cs) return;
      var s = cs.s0 * cs.z, p = clampPos(cs.x, cs.y, cs.w, cs.h, s, cs.W, cs.H);
      cs.x = p.x; cs.y = p.y;
      var img = $('cvc-img');
      img.style.width = (cs.w * s) + 'px'; img.style.height = (cs.h * s) + 'px';
      img.style.transform = 'translate3d(' + cs.x + 'px,' + cs.y + 'px,0)';
    }
    function closeCrop() {
      $('cv-crop').hidden = true;
      document.body.classList.remove('cvc-open');
      if (cs && cs.url) URL.revokeObjectURL(cs.url);
      var img = $('cvc-img'); img.removeAttribute('src'); img.onload = null;
      cs = null; pointers = {}; gesture = null;
      if (lastFocus && lastFocus.focus) api.focusQuiet(lastFocus);
    }
    function framePoint(ev) { var r = $('cvc-frame').getBoundingClientRect(); return { x: ev.clientX - r.left, y: ev.clientY - r.top }; }
    function snapshot() {
      var ids = Object.keys(pointers);
      if (!cs || !ids.length) { gesture = null; return; }
      if (ids.length === 1) { var p = pointers[ids[0]]; gesture = { mode: 'pan', px: p.x, py: p.y, x0: cs.x, y0: cs.y }; return; }
      var a = pointers[ids[0]], b = pointers[ids[1]];
      gesture = { mode: 'pinch', d0: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), z0: cs.z, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, x0: cs.x, y0: cs.y };
    }
    var frame = $('cvc-frame');
    frame.addEventListener('pointerdown', function (ev) {
      if (!cs) return;
      ev.preventDefault();
      try { frame.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
      pointers[ev.pointerId] = framePoint(ev); snapshot();
    });
    frame.addEventListener('pointermove', function (ev) {
      if (!cs || !gesture || !pointers[ev.pointerId]) return;
      pointers[ev.pointerId] = framePoint(ev);
      var ids = Object.keys(pointers);
      if (gesture.mode === 'pan' && ids.length === 1) {
        var p = pointers[ids[0]];
        cs.x = gesture.x0 + (p.x - gesture.px); cs.y = gesture.y0 + (p.y - gesture.py);
      } else if (gesture.mode === 'pinch' && ids.length >= 2) {
        var a = pointers[ids[0]], b = pointers[ids[1]];
        var d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        // zoom around where the fingers started, then follow the fingers as they move
        var r = zoomAt({ w: cs.w, h: cs.h, W: cs.W, H: cs.H, s0: cs.s0, z: gesture.z0, x: gesture.x0, y: gesture.y0 }, gesture.z0 * d / gesture.d0, gesture.mx, gesture.my);
        cs.z = r.z; cs.x = r.x + (mx - gesture.mx); cs.y = r.y + (my - gesture.my);
        $('cvc-zoom').value = String(cs.z);
      }
      draw();
    });
    function lift(ev) { if (pointers[ev.pointerId]) { delete pointers[ev.pointerId]; snapshot(); } }
    frame.addEventListener('pointerup', lift);
    frame.addEventListener('pointercancel', lift);
    frame.addEventListener('wheel', function (ev) {
      if (!cs) return;
      ev.preventDefault();
      var p = framePoint(ev), r = zoomAt(cs, cs.z * Math.exp(-ev.deltaY * 0.0015), p.x, p.y);
      cs.z = r.z; cs.x = r.x; cs.y = r.y; $('cvc-zoom').value = String(cs.z); draw();
    }, { passive: false });
    $('cvc-zoom').addEventListener('input', function () {
      if (!cs) return;
      var r = zoomAt(cs, parseFloat($('cvc-zoom').value) || 1, cs.W / 2, cs.H / 2);
      cs.z = r.z; cs.x = r.x; cs.y = r.y; draw();
    });
    $('cvc-cancel').addEventListener('click', function () { if (!busy) closeCrop(); });
    document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && cs && !busy) closeCrop(); });
    $('cvc-use').addEventListener('click', function () {
      if (busy || !cs) return;
      if (!navigator.onLine) { api.setMsg('cvc-msg', "You're offline. Connect to the internet and try again."); return; }
      busy = true;
      var b = $('cvc-use');
      api.setBusy(b, true, 'Saving your photo…');
      var user = me();
      renderCrop().then(function (blob) {
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
        closeCrop();
        card();
        api.setMsg('cv-msg', 'Saved. Your photo is behind the Training title now.', 'ok');
      }).catch(function (e) {
        console.warn('Cover photo save failed:', e && (e.statusCode || e.code || e.message));
        busy = false; api.setBusy(b, false); delete b.dataset.label;
        closeCrop();
        api.setMsg('cv-msg', e && e.taakat ? e.taakat : api.friendly(e) + ' Your photo wasn’t saved — try again.');
      });
    });
    /* The framed part → a 1080×1350 JPEG under 600 KB (lower quality, then smaller, until it fits). */
    function renderCrop() {
      var img = $('cvc-img'), r = cropRect(cs);
      var attempts = [[1, 0.85], [1, 0.75], [1, 0.65], [0.8, 0.65], [0.6, 0.6], [0.45, 0.55]];
      function tryAt(i) {
        var a = attempts[i], w = Math.round(OUT_W * a[0]), h = Math.round(OUT_H * a[0]);
        var c = document.createElement('canvas'); c.width = w; c.height = h;
        var ctx = c.getContext('2d'); ctx.fillStyle = '#070909'; ctx.fillRect(0, 0, w, h);
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, r.sx, r.sy, r.sw, r.sh, 0, 0, w, h);
        return new Promise(function (res) { c.toBlob(res, 'image/jpeg', a[1]); }).then(function (blob) {
          if (blob && blob.size <= MAX_BYTES) return blob;
          if (i + 1 < attempts.length) return tryAt(i + 1);
          var e2 = new Error('too big'); e2.taakat = 'Taakat couldn’t make that photo small enough. Try a different one.'; throw e2;
        });
      }
      return tryAt(0);
    }

    /* ---------- Training hero: grows when you pull down, drifts and fades as you scroll ---------- */
    var heroRaf = 0, calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    function heroScroll() {
      heroRaf = 0;
      var hero = $('wo-hero'), img = $('wo-cover');
      if (hero.hidden || api.current() !== 'workouts') return;
      if (calm) { img.style.transform = ''; img.style.opacity = ''; return; }
      var y = window.pageYOffset || document.documentElement.scrollTop || 0, h = hero.offsetHeight || 1;
      if (y < 0) {                                   // pulled down past the top (iPhone bounce): the photo grows
        hero.classList.add('stretch');
        img.style.transform = 'scale(' + (1 + Math.min(0.6, -y / h)).toFixed(4) + ')';
        img.style.opacity = '1';
      } else {
        hero.classList.remove('stretch');
        var p = Math.min(1, y / h);
        img.style.transform = 'translate3d(0,' + (y * 0.4).toFixed(1) + 'px,0) scale(' + (1 + p * 0.08).toFixed(4) + ')';
        img.style.opacity = String(1 - p * 0.6);
      }
    }
    window.addEventListener('scroll', function () { if (!heroRaf) heroRaf = requestAnimationFrame(heroScroll); }, { passive: true });

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
        dropCache(user.id);
      });
    }

    return {
      paintHero: paintHero, card: card, removePhoto: removePhoto, has: function () { return !!key(); },
      clear: function () { dropCache(); busy = false; if (cs) closeCrop(); }
    };
  }

  TaakatCover.pure = pure;
  if (typeof module !== 'undefined' && module.exports) module.exports = pure;
  else root.TaakatCover = TaakatCover;
})(this);
