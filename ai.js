/* Taakat — AI helpers: talk to the "ai-food" Supabase function and tidy what comes back.
   Nothing here is trusted blindly: every number is checked and clamped before the app shows it,
   and every name is plain text (shown with textContent only). */
(function (root) {
  'use strict';
  var TIMEOUT_MS = 60000;   // the function itself gives up after ~50 s

  function num(v, max) {
    var n = Number(v);
    if (!isFinite(n) || n < 0) return null;
    return Math.round(Math.min(n, max) * 10) / 10;
  }
  function text(v, max) { return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max); }

  /* "Describe it" answer → foods we can show and save (bad lines dropped). */
  function cleanItems(items) {
    if (!Array.isArray(items)) return [];
    var out = [];
    items.slice(0, 12).forEach(function (it) {
      if (!it || typeof it !== 'object') return;
      var name = text(it.name, 120), kcal = num(it.kcal, 5000);
      if (!name || kcal === null) return;
      var g = num(it.grams, 5000);
      out.push({
        name: name, amount: text(it.amount, 80) || '1 serving', grams: g && g >= 1 ? g : null,
        kcal: kcal, p: num(it.protein_g, 1000), c: num(it.carbs_g, 1000), f: num(it.fat_g, 1000), fib: num(it.fibre_g, 1000)
      });
    });
    return out;
  }
  function totals(items) {
    return items.reduce(function (t, x) { t.kcal += x.kcal || 0; t.p += x.p || 0; t.c += x.c || 0; t.f += x.f || 0; return t; }, { kcal: 0, p: 0, c: 0, f: 0 });
  }
  /* A food_log row for one "Describe it" food. */
  function rowFor(item, base) {
    return {
      user_id: base.user_id, log_date: base.log_date, meal: base.meal, source: 'custom', source_ref: 'ai-describe', brand: null,
      food_name: item.name, serving_label: item.amount, quantity: 1, grams: item.grams,
      kcal: item.kcal, protein_g: item.p, carbs_g: item.c, fat_g: item.f, fibre_g: item.fib, is_estimate: true
    };
  }

  /* "Scan a label" answer → a food the amount screen understands (one serving, plus per-100 g when the weight is known). */
  function labelFood(label) {
    if (!label || typeof label !== 'object' || label.found !== true) return null;
    var kcal = num(label.kcal, 5000);
    if (kcal === null) return null;
    var m = [kcal, num(label.protein_g, 1000) || 0, num(label.carbs_g, 1000) || 0, num(label.fat_g, 1000) || 0, num(label.fibre_g, 1000) || 0];
    var grams = num(label.serving_grams, 2000);
    if (!(grams >= 1)) grams = null;
    var brand = text(label.brand, 80), name = text(label.product_name, 100) || 'Packaged food';
    var serving = text(label.serving_label, 70) || (grams ? grams + ' g' : '');
    var food = {
      id: 'ai-label', n: name, b: brand || null, src: 'custom', d: 0,
      s: 'your label, read by AI — check it matches the package',
      note: 'Read by AI from your photo. Check the numbers match the label before adding.',
      sv: [[serving ? '1 serving · ' + serving : '1 serving', grams, m]]
    };
    if (grams) food.p100 = m.map(function (v) { return Math.round(v / grams * 1000) / 10; });
    return food;
  }

  /* Plain-words message for a failed call. */
  function errorText(code) {
    switch (code) {
      case 'busy': return 'The AI’s free limit is used up for now. It resets daily — try again later, or add the food yourself.';
      case 'login': return 'Your login has expired. Log out and in again, then try once more.';
      case 'setup': return 'The AI isn’t set up yet. (Jas: the GEMINI_API_KEY secret is missing in Supabase.)';
      case 'timeout': return 'The AI took too long to answer. Check your internet and try again.';
      case 'offline': return 'You’re offline. Connect to the internet and try again.';
      case 'input': return 'That didn’t work — try a shorter description or a clearer photo.';
      default: return 'The AI couldn’t work that out just now. Try again, or add the food yourself.';
    }
  }

  /* Call the function. → Promise resolving to the JSON answer; rejects with Error whose .code is one of errorText's codes. */
  function call(sb, cfg, body) {
    if (!navigator.onLine) return Promise.reject(Object.assign(new Error('offline'), { code: 'offline' }));
    return sb.auth.getSession().then(function (r) {
      var token = r && r.data && r.data.session && r.data.session.access_token;
      if (!token) throw Object.assign(new Error('login'), { code: 'login' });
      var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var timer = setTimeout(function () { if (ctl) ctl.abort(); }, TIMEOUT_MS);
      return fetch(cfg.supabaseUrl.replace(/\/$/, '') + '/functions/v1/ai-food', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token, apikey: cfg.supabaseKey },
        body: JSON.stringify(body), signal: ctl ? ctl.signal : undefined
      }).then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (j) {
          if (res.ok) return j;
          var code = j && j.error ? j.error : (res.status === 401 ? 'login' : 'ai');
          if (j && j.detail) console.warn('AI detail:', j.detail);
          throw Object.assign(new Error(code), { code: code, detail: j && j.detail ? String(j.detail).slice(0, 160) : '' });
        });
      }, function (e) {
        throw Object.assign(new Error('network'), { code: e && e.name === 'AbortError' ? 'timeout' : (navigator.onLine ? 'ai' : 'offline') });
      }).finally(function () { clearTimeout(timer); });
    });
  }

  /* Shrink a photo to a JPEG (longest side ≤ 1280 px) and give back its base64 text. */
  function photoBase64(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        var w = img.naturalWidth, h = img.naturalHeight, s = Math.min(1, 1280 / Math.max(w, h));
        var c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w * s)); c.height = Math.max(1, Math.round(h * s));
        var ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', 0.82).split(',')[1] || '');
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(Object.assign(new Error('unreadable'), { code: 'input' })); };
      img.src = url;
    });
  }

  var pure = { cleanItems: cleanItems, totals: totals, rowFor: rowFor, labelFood: labelFood, errorText: errorText };
  var api = { pure: pure, call: call, photoBase64: photoBase64 };
  if (typeof module !== 'undefined' && module.exports) module.exports = pure;
  else root.TaakatAI = api;
})(this);
