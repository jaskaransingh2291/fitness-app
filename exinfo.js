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

  var pure = { videoUrl: videoUrl, muscleList: muscleList, metaLine: metaLine };

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

      api.show('exinfo');
      api.focusQuiet($('ei-title'));
    }
    $('ei-back').addEventListener('click', function () {
      var b = back; showing = null;
      if (b && b.go) { b.go(); try { window.scrollTo(0, b.y || 0); } catch (e) { /* ignore */ } }
      else api.fallback();
    });

    return {
      open: open,
      showing: function () { return showing; },
      clear: function () { back = null; showing = null; }
    };
  }

  TaakatExInfo.pure = pure;
  if (typeof module !== 'undefined' && module.exports) module.exports = pure;
  else root.TaakatExInfo = TaakatExInfo;
})(this);
