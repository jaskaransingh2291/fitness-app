/* Taakat — stage 2: log in/out + passwords. Stage 3: first-time setup, Your numbers, Today card, profile & settings. */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var APP_VERSION = '3.7.0';          // must match version.json (checked by the tests)
  var REQUEST_TIMEOUT_MS = 15000;
  var RESET_COOLDOWN_S = 60;
  var ACCENTS = [
    { key: 'orange', name: 'Signal Orange', hex: '#FF6A1F', rgb: '255, 106, 31' },
    { key: 'lime',   name: 'Volt Lime',     hex: '#C8F54A', rgb: '200, 245, 74' },
    { key: 'blue',   name: 'Electric Blue', hex: '#6B97FF', rgb: '107, 151, 255' },
    { key: 'violet', name: 'Ultra Violet',  hex: '#B39BFF', rgb: '179, 155, 255' },
    { key: 'cyan',   name: 'Ice Cyan',      hex: '#3FDDF5', rgb: '63, 221, 245' },
    { key: 'pink',   name: 'Hot Pink',      hex: '#FF7AC6', rgb: '255, 122, 198' },
    { key: 'red',    name: 'Power Red',     hex: '#FF5A5F', rgb: '255, 90, 95' }
  ];
  function setAccent(c) {
    document.documentElement.style.setProperty('--a', c.hex);
    document.documentElement.style.setProperty('--a-rgb', c.rgb);
  }
  function accentByKey(key) { return ACCENTS.filter(function (c) { return c.key === key; })[0] || null; }

  /* ---------- small safe helpers ---------- */
  function store(key, value) {
    try {
      if (value === undefined) return window.localStorage.getItem(key);
      window.localStorage.setItem(key, value);
    } catch (e) { /* private mode or storage blocked: fine, just forget */ }
    return null;
  }

  function pickAccent() {
    // "Surprise me": a new colour every launch, never the same twice in a row.
    var last = store('taakat.lastAccent');
    var choices = ACCENTS.filter(function (c) { return c.hex !== last; });
    var c = choices[Math.floor(Math.random() * choices.length)] || ACCENTS[3];
    store('taakat.lastAccent', c.hex);
    launchAccent = c;          // used after login by people who chose "Surprise me"
    setAccent(ACCENTS[0]);     // logged-out screens use the Taakat orange

  }
  var launchAccent = null;

  var VIEWS = ['loading', 'login', 'forgot', 'continue', 'reset', 'home', 'fatal', 'profile-error', 'setup', 'numbers', 'profile', 'addfood', 'portion', 'custom', 'week', 'workouts', 'session', 'expick', 'exnew', 'wdone', 'splits', 'splitview', 'splitedit', 'daypick'];
  var APP_VIEWS = ['home', 'profile-error', 'setup', 'numbers', 'profile', 'addfood', 'portion', 'custom', 'week', 'workouts', 'session', 'expick', 'exnew', 'wdone', 'splits', 'splitview', 'splitedit', 'daypick'];
  var TAB_VIEWS = ['home', 'workouts'];
  var currentView = null;
  function show(name, focusId) {
    VIEWS.forEach(function (v) { var el = $('view-' + v); if (el) el.hidden = (v !== name); });
    $('invite-note').hidden = !(name === 'login' || name === 'forgot');
    var inApp = APP_VIEWS.indexOf(name) !== -1;
    document.body.classList.toggle('app-mode', inApp);
    $('topbar').hidden = !inApp;
    var tabs = TAB_VIEWS.indexOf(name) !== -1;
    $('tabbar').hidden = !tabs;
    $('to-profile').hidden = !tabs;
    document.body.classList.toggle('tabs-on', tabs);
    if (tabs) {
      $('tab-food').setAttribute('aria-current', name === 'home' ? 'page' : 'false');
      $('tab-workouts').setAttribute('aria-current', name === 'workouts' ? 'page' : 'false');
    }
    if (inApp) { try { window.scrollTo(0, 0); } catch (e) { /* ignore */ } }
    currentView = name;
    if (focusId) {
      var f = $(focusId);
      // Don't pop up the phone keyboard on first load; only focus when asked.
      if (f) { try { f.focus({ preventScroll: true }); } catch (e) { f.focus(); } }
    }
  }

  function setMsg(id, text, kind) {
    var el = $(id);
    if (!el) return;
    if (!text) { el.hidden = true; el.textContent = ''; el.className = 'msg'; return; }
    el.textContent = text;               // textContent only: never inject HTML
    el.className = 'msg ' + (kind || 'error');
    el.hidden = false;
  }

  function setBusy(btn, busy, busyText) {
    if (!btn) return;
    if (busy) {
      if (!btn.dataset.label) btn.dataset.label = btn.textContent;
      btn.disabled = true;
      btn.classList.add('btn-busy');
      btn.setAttribute('aria-busy', 'true');
      btn.textContent = busyText || 'Working…';
    } else {
      btn.disabled = false;
      btn.classList.remove('btn-busy');
      btn.removeAttribute('aria-busy');
      if (btn.dataset.label) btn.textContent = btn.dataset.label;
    }
  }

  function markInvalid(input, bad) {
    if (!input) return;
    if (bad) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid');
  }

  function cleanEmail(raw) {
    // Trim spaces (including the ones phones add after autocomplete) and invisible characters.
    return String(raw || '').replace(/[​-‍﻿]/g, '').trim();
  }

  function looksLikeEmail(email) {
    return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
  }

  function byteLength(str) {
    try { return new TextEncoder().encode(str).length; } catch (e) { return str.length; }
  }

  /* ---------- turn any error into plain words ---------- */
  function friendly(err) {
    var e = err || {};
    var code = e.code || e.error_code || '';
    var status = e.status || 0;
    var text = String(e.message || e.msg || '');
    var name = e.name || '';

    if (!navigator.onLine) return "You're offline. Connect to the internet and try again.";
    if (status >= 500) return "Taakat's server is having a problem right now. Try again in a minute.";
    if (name === 'AbortError' || /timed? ?out|abort/i.test(text)) return "Taakat's server took too long to answer. Check your internet and try again.";
    if (name === 'AuthRetryableFetchError' || /failed to fetch|networkerror|load failed|network request failed/i.test(text) || (status === 0 && name !== 'AuthApiError' && !code)) {
      return "Can't reach Taakat's server. Check your internet and try again.";
    }
    if (status === 429 || /rate.?limit/i.test(code) || /rate limit|too many/i.test(text)) return 'Too many tries. Wait a few minutes, then try again.';
    if (code === 'invalid_credentials' || /invalid login credentials/i.test(text)) return "That email or password doesn't match. Check both and try again.";
    if (code === 'email_not_confirmed' || /email not confirmed/i.test(text)) return "This account hasn't been activated yet. Open the invite email first.";
    if (code === 'user_banned') return 'This account is turned off.';
    if (code === '23514') return 'One of those values is outside the allowed range. Please check them.';
    if (code === '42501') return "You don't have permission to do that.";
    if (code === 'PGRST204' || code === '42703' || code === 'PGRST200' || code === 'PGRST205' || code === '42P01') return 'Taakat’s database needs its latest update before this works. (Jas: run the newest database update in Supabase.)';
    if (code === 'reauthentication_needed' || /reauthenticat/i.test(text)) return 'For safety, please log out, log back in, and try again.';
    if (code === 'same_password' || /should be different/i.test(text)) return 'Your new password must be different from your old one.';
    if (code === 'weak_password' || /weak|password should/i.test(text)) return 'That password is too weak. Try a longer one with a mix of letters and numbers.';
    if (code === 'session_not_found' || code === 'session_expired' || code === 'refresh_token_not_found' || status === 401 || status === 403 || /auth session missing|jwt/i.test(text)) {
      return 'Your session has expired. Please start again.';
    }
    return 'Something went wrong. Please try again.';
  }

  function isSessionError(err) {
    var e = err || {};
    var code = e.code || e.error_code || '';
    return code === 'session_not_found' || code === 'session_expired' || code === 'refresh_token_not_found' ||
      code === 'refresh_token_already_used' || e.name === 'AuthSessionMissingError' || e.status === 401 ||
      /auth session missing|session.*(not found|expired)/i.test(String(e.message || ''));
  }

  function isUsedLinkError(err) {
    var e = err || {};
    var code = e.code || e.error_code || '';
    return code === 'otp_expired' || code === 'otp_disabled' || e.status === 403 || /expired|invalid/i.test(String(e.message || ''));
  }

  /* ---------- read reset-link info BEFORE the library cleans the address ---------- */
  var hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  var queryParams = new URLSearchParams(window.location.search);
  function sessionFlag(key, on) {
    try {
      if (on === undefined) return window.sessionStorage.getItem(key) === '1';
      if (on) window.sessionStorage.setItem(key, '1'); else window.sessionStorage.removeItem(key);
    } catch (e) { /* ignore */ }
    return false;
  }
  // Remember "mid password reset" even if the page is reloaded before the new password is saved.
  var recoveryMode = hashParams.get('type') === 'recovery' || sessionFlag('taakat.recovery');
  function setRecovery(on) { recoveryMode = on; sessionFlag('taakat.recovery', on); }
  if (recoveryMode) setRecovery(true);
  var linkErrorCode = hashParams.get('error_code') || queryParams.get('error_code') || '';
  var linkError = hashParams.get('error_description') || queryParams.get('error_description') || hashParams.get('error') || queryParams.get('error') || '';
  // New-style reset links carry a one-time code (token_hash) that is only used when the person taps Continue,
  // so opening the link twice, or an email app previewing it, can't use it up.
  var pendingTokenHash = queryParams.get('type') === 'recovery' ? queryParams.get('token_hash') : null;
  var hadAuthStuffInUrl = !!(hashParams.get('access_token') || hashParams.get('error') || queryParams.get('error') || queryParams.get('code') || queryParams.get('token_hash'));
  var recoveryEmail = '';

  function linkErrorText() {
    if (!linkError && !linkErrorCode) return '';
    if (linkErrorCode === 'otp_expired' || /expired|invalid/i.test(linkError)) {
      return 'That link has expired or was already used. Ask for a new one below.';
    }
    return "That link didn't work. Ask for a new one below.";
  }

  function cleanUrl() {
    if (!hadAuthStuffInUrl || pendingTokenHash) return; // keep an unused code so a reload still works
    try { window.history.replaceState(null, '', window.location.pathname); } catch (e) { /* ignore */ }
  }

  /* ---------- network with a time limit so nothing hangs forever ---------- */
  function fetchWithTimeout(input, init) {
    init = init || {};
    var ctrl = new AbortController();
    var limit = (window.TAAKAT_CONFIG && window.TAAKAT_CONFIG.requestTimeoutMs) || REQUEST_TIMEOUT_MS;
    var timer = setTimeout(function () { ctrl.abort(); }, limit);
    if (init.signal) {
      if (init.signal.aborted) ctrl.abort();
      else init.signal.addEventListener('abort', function () { ctrl.abort(); });
    }
    var opts = Object.assign({}, init, { signal: ctrl.signal });
    return window.fetch(input, opts).finally(function () { clearTimeout(timer); });
  }


  /* ---------- Fast tap ----------
     On phones, tapping a button while the keyboard is open closes the keyboard FIRST, and the page
     jumps before the phone sends its "click", so the click lands in the wrong spot and the tap
     "misses". So for touch we don't wait for the phone's click at all: when the finger lifts on a
     button / pill / choice card / colour / switch, we cancel the phone's own click and press the
     thing the finger went down on ourselves. A finger that slid (scrolling), a long press, or a tap
     that just stops a moving list is left to the phone as normal. Mouse clicks are unchanged. */
  var TAP_SEL = 'button, label.pill, label.choice, label.swatch, label.toggle-row';
  var touchTap = null;     // { el, x, y, t } where the finger went down
  var scrollTimes = [];   // when the page/list last moved (to spot a list still gliding)
  function tapTarget(node) {
    var t = node && node.closest ? node.closest(TAP_SEL) : null;
    return t && !t.hasAttribute('data-slow-tap') ? t : null;
  }
  function tapUsable(t) {
    if (!t || !t.isConnected || t.getClientRects().length === 0) return false;   // gone or hidden
    if (t.tagName === 'BUTTON') return !t.disabled;
    var input = t.control || t.querySelector('input');
    return !!input && !input.disabled && (input.type === 'radio' || input.type === 'checkbox');
  }
  function pressTap(t) {
    // Close the keyboard first, like a normal tap does (this also lets typed text "settle").
    var a = document.activeElement;
    if (a && a !== t && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) a.blur();
    if (!tapUsable(t)) return;   // blurring can change things (e.g. disable a button)
    if (t.tagName === 'BUTTON') {
      if (t.type === 'submit' && t.form) {
        if (typeof t.form.requestSubmit === 'function') t.form.requestSubmit(t);
        else t.form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
      } else {
        t.click();
      }
      return;
    }
    var input = t.control || t.querySelector('input');
    if (input.type === 'radio') { if (input.checked) return; input.checked = true; }
    else { input.checked = !input.checked; }
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
  document.addEventListener('scroll', function () {
    scrollTimes.push(Date.now()); if (scrollTimes.length > 3) scrollTimes.shift();
  }, true);
  function listGliding() {
    // A gliding list fires scroll events every frame; a single jump (keyboard, list getting shorter) is not gliding.
    var now = Date.now();
    return scrollTimes.length === 3 && now - scrollTimes[0] < 200 && now - scrollTimes[2] < 80;
  }
  document.addEventListener('touchstart', function (ev) {
    touchTap = null;
    if (ev.touches.length !== 1) return;
    if (listGliding()) return;   // this touch is stopping a moving list, not a tap
    var t = tapTarget(ev.target);
    if (t) touchTap = { el: t, x: ev.touches[0].clientX, y: ev.touches[0].clientY, t: Date.now() };
  }, { capture: true, passive: true });
  document.addEventListener('touchmove', function (ev) {
    if (!touchTap) return;
    var p = ev.touches[0];
    if (!p || Math.abs(p.clientX - touchTap.x) > 10 || Math.abs(p.clientY - touchTap.y) > 10) touchTap = null;   // sliding = scrolling
  }, { capture: true, passive: true });
  document.addEventListener('touchcancel', function () { touchTap = null; }, true);
  document.addEventListener('touchend', function (ev) {
    var d = touchTap; touchTap = null;
    if (!d || ev.touches.length) return;
    var p = ev.changedTouches[0];
    if (!p || Math.abs(p.clientX - d.x) > 10 || Math.abs(p.clientY - d.y) > 10) return;
    if (Date.now() - d.t > 900) return;   // long press: leave it to the phone
    if (!tapUsable(d.el)) return;
    ev.preventDefault();   // cancels the phone's own late (and possibly misplaced) click
    pressTap(d.el);
  }, { capture: true, passive: false });


  /* ---------- Automatic updates ----------
     Phones (especially Home Screen apps) can keep running an old saved copy. On start we ask the
     server which version is live; if it's newer we reload once with a fresh address. When you come
     back to the app later, we show a "New version ready" banner instead of reloading under you. */
  function versionNewer(a, b) {   // is a newer than b?
    var pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
    for (var i = 0; i < 3; i++) { if ((pa[i] || 0) > (pb[i] || 0)) return true; if ((pa[i] || 0) < (pb[i] || 0)) return false; }
    return false;
  }
  function freshUrl(v) { return window.location.pathname + '?v=' + encodeURIComponent(v); }
  function fetchLiveVersion() {
    return window.fetch('version.json?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('version ' + r.status); return r.json(); })
      .then(function (j) { return j && typeof j.version === 'string' ? j.version : null; });
  }
  var lastUpdateCheck = 0;
  function checkForUpdate(onStart) {
    if (!navigator.onLine) return;
    lastUpdateCheck = Date.now();
    fetchLiveVersion().then(function (live) {
      if (!live || !versionNewer(live, APP_VERSION)) return;
      var tried = null;
      try { tried = window.sessionStorage.getItem('taakat.updateTried'); } catch (e) { /* ignore */ }
      var busyWithLink = hadAuthStuffInUrl || pendingTokenHash || recoveryMode;
      if (onStart && !busyWithLink && tried !== live) {
        try { window.sessionStorage.setItem('taakat.updateTried', live); } catch (e) { /* ignore */ }
        window.location.replace(freshUrl(live));     // a new address can't come from the old saved copy
        return;
      }
      $('update-banner').hidden = false;
      syncBanners();
    }).catch(function () { /* offline or blocked: try again later */ });
  }
  $('update-btn').addEventListener('click', function () {
    fetchLiveVersion().then(function (live) { window.location.replace(freshUrl(live || String(Date.now()))); })
      .catch(function () { window.location.replace(freshUrl(String(Date.now()))); });
  });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible') return;
    if (Date.now() - lastUpdateCheck > 60000) checkForUpdate(false);
    // Left open overnight? Move Today to the new day.
    // (Only when you were looking at "Today" — if you chose an earlier day, stay on it.)
    if (currentView === 'home' && !homeDay && meals && meals.day() && meals.day() !== C.localDate()) showToday('');
  });
  // Tidy the address bar after an update reload (only the ?v= part; never touch reset links).
  if (/^\?v=[\w.%-]+$/.test(window.location.search) && !window.location.hash) {
    try { window.history.replaceState(null, '', window.location.pathname); } catch (e) { /* ignore */ }
  }

  /* ---------- start ---------- */
  pickAccent();

  function fatal(text) {
    if (text) $('fatal-text').textContent = text;
    show('fatal');
  }
  $('reload-btn').addEventListener('click', function () { window.location.reload(); });

  var cfg = window.TAAKAT_CONFIG;
  if (!window.supabase || typeof window.supabase.createClient !== 'function') {
    fatal("Part of Taakat didn't load. Check your internet, then tap Try again.");
    return;
  }
  if (!cfg || !cfg.supabaseUrl || !cfg.supabaseKey) {
    fatal("Taakat's settings file is missing. Tell Jas.");
    return;
  }

  var sb;
  try {
    sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' },
      global: { fetch: fetchWithTimeout }
    });
  } catch (e) {
    console.error(e);
    fatal("Taakat couldn't connect. Tap Try again.");
    return;
  }

  var userLoggedOutOnPurpose = false;
  var homeShownFor = null;

  function showHome(session, note) {
    // Every way into the app goes through enterApp: it loads the profile first.
    enterApp(session, note);
  }

  function showLogin(note, kind) {
    homeShownFor = null;
    $('login-password').value = '';
    setMsg('login-msg', note || '', kind || 'error');
    show('login');
  }

  sb.auth.onAuthStateChange(function (event, session) {
    // Keep this callback quick and never call other Supabase functions inside it.
    if (event === 'PASSWORD_RECOVERY') {
      if (session && session.user && session.user.email) recoveryEmail = session.user.email;
      pendingTokenHash = null;
      setRecovery(true);
      cleanUrl();
      show('reset', 'reset-password');
      return;
    }
    if (event === 'SIGNED_OUT') {
      if (APP_VIEWS.indexOf(currentView) !== -1 || currentView === 'reset') {
        showLogin(userLoggedOutOnPurpose ? '' : 'You were logged out. Please log in again.', 'error');
      }
      userLoggedOutOnPurpose = false;
      return;
    }
    if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') && session && !recoveryMode && !pendingTokenHash) {
      // e.g. logged in on another tab. Re-check after the tick: boot may have moved to another screen meanwhile.
      setTimeout(function () {
        if (recoveryMode || pendingTokenHash) return;
        if ((currentView === 'login' || currentView === 'loading') && homeShownFor !== session.user.id) showHome(session);
      }, 0);
    }
  });

  function boot() {
    show('loading');
    sb.auth.getSession().then(function (res) {
      var session = res && res.data ? res.data.session : null;
      if (pendingTokenHash) { setMsg('continue-msg', ''); show('continue'); return; }
      cleanUrl();
      if (recoveryMode && session) {
        if (session.user && session.user.email) recoveryEmail = session.user.email;
        show('reset', 'reset-password');
        return;
      }
      if (recoveryMode && !session) {
        setRecovery(false);
        showLogin(linkErrorText() || "That reset link didn't work. Check your internet, or ask for a new link below.");
        return;
      }
      if (session) { showHome(session); return; }
      showLogin(linkErrorText());
    }).catch(function (e) {
      console.error(e);
      cleanUrl();
      showLogin(friendly(e));
    });
  }

  /* ---------- show / hide password ---------- */
  Array.prototype.forEach.call(document.querySelectorAll('.pw-toggle'), function (btn) {
    btn.addEventListener('click', function () {
      var input = $(btn.getAttribute('data-target'));
      if (!input) return;
      var showing = input.type === 'text';
      input.type = showing ? 'password' : 'text';
      btn.textContent = showing ? 'Show' : 'Hide';
      btn.setAttribute('aria-pressed', showing ? 'false' : 'true');
      btn.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
    });
  });

  /* ---------- log in ---------- */
  var loginBusy = false;
  $('login-form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    if (loginBusy) return;
    var emailEl = $('login-email');
    var passEl = $('login-password');
    var btn = $('login-btn');
    var email = cleanEmail(emailEl.value);
    var password = passEl.value;
    emailEl.value = email;
    markInvalid(emailEl, false); markInvalid(passEl, false);

    if (!email) { markInvalid(emailEl, true); setMsg('login-msg', 'Enter your email.'); emailEl.focus(); return; }
    if (!looksLikeEmail(email)) { markInvalid(emailEl, true); setMsg('login-msg', "That doesn't look like an email address."); emailEl.focus(); return; }
    if (!password) { markInvalid(passEl, true); setMsg('login-msg', 'Enter your password.'); passEl.focus(); return; }
    if (byteLength(password) > 72) { markInvalid(passEl, true); setMsg('login-msg', "That password is too long."); passEl.focus(); return; }
    if (!navigator.onLine) { setMsg('login-msg', "You're offline. Connect to the internet and try again."); return; }

    loginBusy = true;
    setMsg('login-msg', '');
    setBusy(btn, true, 'Logging in…');
    sb.auth.signInWithPassword({ email: email, password: password }).then(function (res) {
      if (res.error) throw res.error;
      if (!res.data || !res.data.session) throw new Error('No session returned');
      passEl.value = '';
      showHome(res.data.session);
    }).catch(function (e) {
      console.warn('Login failed:', e && (e.code || e.message));
      setMsg('login-msg', friendly(e));
      if (e && (e.code === 'invalid_credentials' || /invalid login/i.test(e.message || ''))) {
        passEl.value = '';
        passEl.focus();
      }
    }).finally(function () {
      loginBusy = false;
      setBusy(btn, false);
    });
  });

  /* ---------- forgot password ---------- */
  $('to-forgot').addEventListener('click', function () {
    $('forgot-email').value = cleanEmail($('login-email').value);
    setMsg('forgot-msg', '');
    show('forgot', 'forgot-email');
  });
  $('to-login').addEventListener('click', function () {
    var e = cleanEmail($('forgot-email').value);
    if (e) $('login-email').value = e;
    setMsg('login-msg', '');
    show('login', 'login-email');
  });

  var forgotBusy = false;
  var cooldownTimer = null;
  function startCooldown(btn, seconds) {
    var left = seconds;
    btn.disabled = true;
    btn.textContent = 'Send again in ' + left + 's';
    clearInterval(cooldownTimer);
    cooldownTimer = setInterval(function () {
      left -= 1;
      if (left <= 0) {
        clearInterval(cooldownTimer);
        btn.disabled = false;
        btn.textContent = btn.dataset.label || 'Send reset link';
      } else {
        btn.textContent = 'Send again in ' + left + 's';
      }
    }, 1000);
  }

  $('forgot-form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var btn = $('forgot-btn');
    if (forgotBusy || btn.disabled) return;
    var emailEl = $('forgot-email');
    var email = cleanEmail(emailEl.value);
    emailEl.value = email;
    markInvalid(emailEl, false);
    if (!email) { markInvalid(emailEl, true); setMsg('forgot-msg', 'Enter your email.'); emailEl.focus(); return; }
    if (!looksLikeEmail(email)) { markInvalid(emailEl, true); setMsg('forgot-msg', "That doesn't look like an email address."); emailEl.focus(); return; }
    if (!navigator.onLine) { setMsg('forgot-msg', "You're offline. Connect to the internet and try again."); return; }

    forgotBusy = true;
    setMsg('forgot-msg', '');
    if (!btn.dataset.label) btn.dataset.label = btn.textContent;
    setBusy(btn, true, 'Sending…');
    var redirectTo = window.location.origin + window.location.pathname;
    sb.auth.resetPasswordForEmail(email, { redirectTo: redirectTo }).then(function (res) {
      var e = res && res.error;
      // Only show real problems (internet, too many tries). Anything else gets the same
      // message, so nobody can use this screen to find out who has an account.
      if (e && (e.status === 429 || e.name === 'AuthRetryableFetchError' || e.name === 'AbortError' || e.status >= 500 || !navigator.onLine)) throw e;
      setMsg('forgot-msg', 'If that email has a Taakat account, a reset link is on its way. Check your inbox and spam folder.', 'ok');
      setBusy(btn, false);
      startCooldown(btn, RESET_COOLDOWN_S);
    }).catch(function (e) {
      console.warn('Reset email failed:', e && (e.code || e.message));
      setMsg('forgot-msg', friendly(e));
      setBusy(btn, false);
    }).finally(function () {
      forgotBusy = false;
    });
  });

  /* ---------- reset link landing: Continue ---------- */
  var continueBusy = false;
  $('continue-btn').addEventListener('click', function () {
    if (continueBusy || !pendingTokenHash) return;
    if (!navigator.onLine) { setMsg('continue-msg', "You're offline. Connect to the internet and try again."); return; }
    continueBusy = true;
    var btn = $('continue-btn');
    setMsg('continue-msg', '');
    setBusy(btn, true, 'Checking link…');
    sb.auth.verifyOtp({ token_hash: pendingTokenHash, type: 'recovery' }).then(function (res) {
      if (res.error) throw res.error;
      var s = res.data && res.data.session;
      if (!s) throw new Error('No session returned');
      if (s.user && s.user.email) recoveryEmail = s.user.email;
      pendingTokenHash = null;
      setRecovery(true);
      cleanUrl();
      show('reset', 'reset-password');
    }).catch(function (e) {
      console.warn('Reset link check failed:', e && (e.code || e.message));
      var offlineish = e && (e.name === 'AuthRetryableFetchError' || e.name === 'AbortError' || (e.status || 0) >= 500 || !navigator.onLine);
      if (!offlineish && isUsedLinkError(e)) {
        pendingTokenHash = null;
        cleanUrl();
        setMsg('continue-msg', 'This link has expired or was already used. If you already set a new password, just log in. Otherwise, send yourself a new link.');
        $('continue-btn').hidden = true;
        $('continue-new-link').hidden = false;
      } else {
        setMsg('continue-msg', friendly(e)); // internet problem: the link is still good, try again
      }
    }).finally(function () {
      continueBusy = false;
      setBusy(btn, false);
    });
  });
  $('continue-new-link').addEventListener('click', function () {
    setMsg('forgot-msg', '');
    show('forgot', 'forgot-email');
  });
  $('continue-cancel').addEventListener('click', function () {
    pendingTokenHash = null;
    cleanUrl();
    showLogin('');
  });

  function resetSessionLost() {
    // The reset session ended before saving (e.g. the link was open in two tabs).
    // Never leave a dead end: go straight to "send a new link" with the email filled in.
    setRecovery(false);
    wipeLocalSession();
    $('reset-password').value = ''; $('reset-confirm').value = '';
    $('forgot-email').value = recoveryEmail || '';
    setMsg('forgot-msg', 'Your reset link timed out before your new password was saved. Send yourself a new link below. Tip: open the link only once.');
    show('forgot', recoveryEmail ? null : 'forgot-email');
  }

  $('reset-cancel').addEventListener('click', function () {
    setRecovery(false);
    userLoggedOutOnPurpose = true;
    $('reset-password').value = ''; $('reset-confirm').value = '';
    sb.auth.signOut({ scope: 'local' }).catch(function () {}).finally(function () {
      wipeLocalSession();
      userLoggedOutOnPurpose = false;
      showLogin('');
    });
  });

  /* ---------- set a new password (after tapping the email link) ---------- */
  var resetBusy = false;
  $('reset-form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    if (resetBusy) return;
    var p1 = $('reset-password');
    var p2 = $('reset-confirm');
    var btn = $('reset-btn');
    markInvalid(p1, false); markInvalid(p2, false);
    var pw = p1.value;
    if (pw.length < 8) { markInvalid(p1, true); setMsg('reset-msg', 'Use at least 8 characters.'); p1.focus(); return; }
    if (byteLength(pw) > 72) { markInvalid(p1, true); setMsg('reset-msg', 'That password is too long (72 characters max).'); p1.focus(); return; }
    if (/^\s|\s$/.test(pw)) { markInvalid(p1, true); setMsg('reset-msg', "Don't start or end your password with a space."); p1.focus(); return; }
    if (pw !== p2.value) { markInvalid(p2, true); setMsg('reset-msg', "The two passwords don't match."); p2.focus(); return; }
    if (!navigator.onLine) { setMsg('reset-msg', "You're offline. Connect to the internet and try again."); return; }

    resetBusy = true;
    setMsg('reset-msg', '');
    setBusy(btn, true, 'Saving…');
    sb.auth.updateUser({ password: pw }).then(function (res) {
      if (res.error) throw res.error;
      setRecovery(false);
      p1.value = ''; p2.value = '';
      return sb.auth.getSession().then(function (s) {
        showHome(s && s.data ? s.data.session : null, 'Password updated.');
      });
    }).catch(function (e) {
      console.warn('Password update failed:', e && (e.code || e.message));
      if (isSessionError(e)) { resetSessionLost(); return; }
      setMsg('reset-msg', friendly(e));
    }).finally(function () {
      resetBusy = false;
      setBusy(btn, false);
    });
  });

  /* ---------- log out ---------- */
  var logoutBusy = false;
  function wipeLocalSession() {
    try {
      Object.keys(window.localStorage).forEach(function (k) {
        if (/^sb-.*-auth-token/.test(k)) window.localStorage.removeItem(k);
      });
    } catch (e) { /* ignore */ }
  }
  $('logout-btn').addEventListener('click', function () { doLogout($('logout-btn')); });
  $('perr-logout').addEventListener('click', function () { doLogout($('perr-logout')); });
  function doLogout(btn) {
    if (logoutBusy) return;
    logoutBusy = true;
    userLoggedOutOnPurpose = true;
    setBusy(btn, true, 'Logging out…');
    // "local" = log out on this device only, not on your other phone/laptop.
    sb.auth.signOut({ scope: 'local' }).catch(function (e) {
      console.warn('Sign-out call failed, clearing this device anyway:', e && e.message);
    }).finally(function () {
      wipeLocalSession(); // works even with no internet
      setRecovery(false);
      logoutBusy = false;
      setBusy(btn, false);
      userLoggedOutOnPurpose = false;
      me = null; profile = null; homeDay = null;
      clearDrafts();
      if (meals) meals.clear();
      if (workouts) workouts.clear();
      if (splits) splits.clear();
      resumeCheckPending = false;
      showLogin('');
      $('login-email').value = '';
    });
  }

  /* ====================== STAGE 3: profile, setup, Today, settings ====================== */
  var C = window.TaakatCalc;
  var me = null;            // { id, email } of whoever is logged in
  var profile = null;       // their saved profile
  var pendingHomeNote = '';
  var loadToken = 0;
  var STEPS = ['name', 'sex', 'age', 'height', 'weight', 'activity', 'goal', 'bodyfat', 'colour'];
  var stepIndex = 0;
  var answers = {};
  var targetsSavedFor = '';
  var homeDay = null;       // the day Today is showing: null = follow today; else an earlier 'YYYY-MM-DD'
  var DAYS_BACK = 365;      // how far back the day arrows go
  var meals = (window.TaakatMeals && C) ? window.TaakatMeals({
    $: $, C: C, sb: sb, setMsg: setMsg, setBusy: setBusy, friendly: friendly, show: show, focusQuiet: function (el) { focusQuiet(el); },
    me: function () { return me; }, profile: function () { return profile; }, current: function () { return currentView; },
    showToday: function (note, opts) { showToday(note, opts); }, version: APP_VERSION,
    viewedDay: function () { return viewedDay(); }
  }) : null;

  var workouts = (window.TaakatWorkouts && C) ? window.TaakatWorkouts({
    $: $, C: C, sb: sb, setMsg: setMsg, setBusy: setBusy, friendly: friendly, show: show, focusQuiet: function (el) { focusQuiet(el); },
    me: function () { return me; }, profile: function () { return profile; }, current: function () { return currentView; }, version: APP_VERSION,
    splits: function () { return splits; }
  }) : null;
  var splits = (window.TaakatSplits && workouts) ? window.TaakatSplits({
    $: $, sb: sb, setMsg: setMsg, setBusy: setBusy, friendly: friendly, show: show, focusQuiet: function (el) { focusQuiet(el); },
    me: function () { return me; }, current: function () { return currentView; }, version: APP_VERSION, workouts: workouts
  }) : null;
  var resumeCheckPending = false;
  $('tab-food').addEventListener('click', function () { if (currentView !== 'home') showToday(''); });
  $('tab-workouts').addEventListener('click', function () { if (currentView !== 'workouts' && workouts) workouts.open(''); });

  function fmt(n) { return Number(n).toLocaleString('en-CA'); }
  function numOrNull(v) { return (v === null || v === undefined || v === '') ? null : Number(v); }
  function radioValue(name) { var r = document.querySelector('input[name="' + name + '"]:checked'); return r ? r.value : ''; }
  function setRadio(name, value) {
    Array.prototype.forEach.call(document.querySelectorAll('input[name="' + name + '"]'), function (r) { r.checked = (r.value === value); });
  }
  function focusQuiet(el) { if (!el) return; try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); } }

  function normalise(p) {
    if (!p) return null;
    var out = Object.assign({}, p);
    ['age', 'height_cm', 'weight_kg', 'neck_cm', 'waist_cm', 'hip_cm'].forEach(function (k) { out[k] = numOrNull(p[k]); });
    out.surprise_colors = p.surprise_colors !== false;
    out.weight_unit = p.weight_unit === 'kg' ? 'kg' : 'lb';
    return out;
  }

  function isComplete(p) {
    return !!(p && p.display_name && String(p.display_name).trim() && (p.sex === 'male' || p.sex === 'female') &&
      C.inRange('age', p.age) && C.inRange('height_cm', p.height_cm) && C.inRange('weight_kg', p.weight_kg) &&
      C.ACTIVITY[p.activity_level] && (p.goal in C.GOAL_ADJUST));
  }

  function applyProfileAccent(p) {
    var fav = p && accentByKey(p.accent_color);
    if (p && p.surprise_colors === false && fav) setAccent(fav);
    else if (launchAccent) setAccent(launchAccent);
  }

  function enterApp(session, note) {
    if (!session || !session.user) { showLogin(''); return; }
    if (!C || !meals || !workouts || !splits) { fatal("Part of Taakat didn't load. Check your internet, then tap Try again."); return; }
    me = { id: session.user.id, email: session.user.email || '' };
    homeDay = null;
    resumeCheckPending = true;
    homeShownFor = me.id;
    $('home-email').textContent = me.email;
    pendingHomeNote = note || '';
    loadProfile();
  }

  var slowTimer = null;
  function loadProfile() {
    var token = ++loadToken;
    $('loading-text').textContent = 'Getting things ready…';
    show('loading');
    clearTimeout(slowTimer);
    slowTimer = setTimeout(function () {
      if (token === loadToken && currentView === 'loading') $('loading-text').textContent = 'Still connecting… if this takes long, check your internet.';
    }, 4000);
    sb.from('profiles').select('*').eq('id', me.id).maybeSingle().then(function (res) {
      if (token !== loadToken) return;
      clearTimeout(slowTimer);
      if (res.error) throw res.error;
      profile = normalise(res.data);
      if (isComplete(profile)) {
        applyProfileAccent(profile);
        showToday(pendingHomeNote);
        pendingHomeNote = '';
      } else {
        startSetup();
      }
    }).catch(function (e) {
      if (token !== loadToken) return;
      clearTimeout(slowTimer);
      console.warn('Profile load failed:', e && (e.code || e.message));
      // IMPORTANT: never jump to setup here - that could overwrite a saved profile with new answers.
      $('perr-text').textContent = friendly(e) + ' Your saved details are safe.';
      show('profile-error');
    });
  }
  $('perr-retry').addEventListener('click', function () { if (me) loadProfile(); });

  /* ---------- colour swatches (setup + profile) ---------- */
  function renderSwatches(containerId, groupName, selectedKey) {
    var box = $(containerId);
    box.textContent = '';
    ACCENTS.forEach(function (c) {
      var label = document.createElement('label');
      label.className = 'swatch';
      var input = document.createElement('input');
      input.type = 'radio'; input.name = groupName; input.value = c.key;
      input.checked = (c.key === selectedKey);
      var span = document.createElement('span');
      span.textContent = c.name;
      span.style.setProperty('--sw', c.hex);
      span.style.setProperty('--sw-glow', 'rgba(' + c.rgb + ', .55)');
      label.appendChild(input); label.appendChild(span);
      box.appendChild(label);
    });
  }

  /* ---------- first-time setup ---------- */
  function draftKey() { return 'taakat.setupDraft.' + me.id; }
  function saveDraft() { store(draftKey(), JSON.stringify({ step: stepIndex, answers: answers })); }
  function loadDraft() { try { return JSON.parse(store(draftKey()) || 'null'); } catch (e) { return null; } }
  function clearDrafts() {
    try {
      Object.keys(window.localStorage).forEach(function (k) { if (k.indexOf('taakat.setupDraft.') === 0) window.localStorage.removeItem(k); });
    } catch (e) { /* ignore */ }
  }

  function startSetup() {
    answers = { surprise: false, colour: 'orange' };
    stepIndex = 0;
    if (profile) {   // a half-finished profile: keep what's there
      answers.name = profile.display_name || '';
      answers.sex = profile.sex || '';
      answers.age = profile.age != null ? String(profile.age) : '';
      answers.height = profile.height_cm != null ? String(profile.height_cm) : '';
      answers.weight = profile.weight_kg != null ? String(profile.weight_kg) : '';
      answers.activity = profile.activity_level || '';
      answers.goal = profile.goal || '';
      answers.neck = profile.neck_cm != null ? String(profile.neck_cm) : '';
      answers.waist = profile.waist_cm != null ? String(profile.waist_cm) : '';
      answers.hip = profile.hip_cm != null ? String(profile.hip_cm) : '';
      answers.colour = profile.accent_color || null;
      answers.surprise = profile.surprise_colors !== false;
    }
    var d = loadDraft();
    if (d && d.answers && typeof d.answers === 'object') {
      Object.keys(d.answers).forEach(function (k) { answers[k] = d.answers[k]; });
      if (typeof d.step === 'number' && d.step >= 0 && d.step < STEPS.length) stepIndex = d.step;
    }
    $('s-name').value = answers.name || '';
    setRadio('s-sex', answers.sex || '');
    $('s-age').value = answers.age || '';
    $('s-height').value = answers.height || '';
    $('s-weight').value = answers.weight || '';
    setRadio('s-activity', answers.activity || '');
    setRadio('s-goal', answers.goal || '');
    $('s-neck').value = answers.neck || '';
    $('s-waist').value = answers.waist || '';
    $('s-hip').value = answers.hip || '';
    renderSwatches('s-swatches', 's-colour', answers.colour);
    $('s-surprise').checked = answers.surprise !== false;
    updateSetupHints();
    setMsg('setup-msg', '');
    show('setup');
    showStep(stepIndex, true);
  }

  function readSetupInputs() {
    answers.name = $('s-name').value;
    answers.sex = radioValue('s-sex');
    answers.age = $('s-age').value;
    answers.height = $('s-height').value;
    answers.weight = $('s-weight').value;
    answers.activity = radioValue('s-activity');
    answers.goal = radioValue('s-goal');
    answers.neck = $('s-neck').value;
    answers.waist = $('s-waist').value;
    answers.hip = $('s-hip').value;
    answers.colour = radioValue('s-colour') || null;
    answers.surprise = $('s-surprise').checked;
  }

  function updateSetupHints() {
    var h = C.parseNumber($('s-height').value);
    $('s-height-hint').textContent = C.inRange('height_cm', h) ? 'That’s about ' + C.cmToFeetInches(h) : 'Tip: 5′9″ is about 175 cm.';
    var w = C.parseNumber($('s-weight').value);
    $('s-weight-hint').textContent = C.inRange('weight_kg', w) ? 'That’s about ' + C.kgToLb(w) + ' lb' : 'Tip: 150 lb is about 68 kg.';
    var female = radioValue('s-sex') === 'female';
    Array.prototype.forEach.call(document.querySelectorAll('#view-setup .hip-only'), function (el) { el.hidden = !female; });
    var bf = bodyFatFrom(radioValue('s-sex'), h, $('s-neck').value, $('s-waist').value, $('s-hip').value);
    $('s-bf-hint').textContent = bf.value !== null ? 'Estimated body fat: about ' + bf.value + '%' : '';
  }

  function bodyFatFrom(sex, heightCm, neckRaw, waistRaw, hipRaw) {
    var neck = C.parseNumber(neckRaw), waist = C.parseNumber(waistRaw), hip = C.parseNumber(hipRaw);
    var anyTyped = [neckRaw, waistRaw, sex === 'female' ? hipRaw : ''].some(function (v) { return String(v || '').trim() !== ''; });
    if (!anyTyped) return { none: true, value: null };
    var inRanges = C.inRange('neck_cm', neck) && C.inRange('waist_cm', waist) && (sex !== 'female' || C.inRange('hip_cm', hip));
    if (!inRanges) return { none: false, value: null, neck: neck, waist: waist, hip: hip };
    return { none: false, value: C.navyBodyFat(sex, heightCm, neck, waist, hip), neck: neck, waist: waist, hip: hip };
  }

  /* Checks one step. Returns '' if fine, or a plain-words problem. */
  function checkStep(key, a) {
    var n;
    switch (key) {
      case 'name':
        n = String(a.name || '').trim();
        return (n.length >= 1 && n.length <= 40) ? '' : 'Enter your name (up to 40 characters).';
      case 'sex': return (a.sex === 'male' || a.sex === 'female') ? '' : 'Pick one to continue.';
      case 'age':
        n = C.parseNumber(a.age);
        return (n !== null && Number.isInteger(n) && C.inRange('age', n)) ? '' : 'Enter your age in whole years (13 to 100).';
      case 'height':
        return C.inRange('height_cm', C.parseNumber(a.height)) ? '' : 'Enter your height in cm (100 to 250). Tip: 5′9″ is about 175 cm.';
      case 'weight':
        return C.inRange('weight_kg', C.parseNumber(a.weight)) ? '' : 'Enter your weight in kg (30 to 300). Tip: 150 lb is about 68 kg.';
      case 'activity': return C.ACTIVITY[a.activity] ? '' : 'Pick one to continue.';
      case 'goal': return (a.goal in C.GOAL_ADJUST) ? '' : 'Pick one to continue.';
      case 'bodyfat':
        var bf = bodyFatFrom(a.sex, C.parseNumber(a.height), a.neck, a.waist, a.hip);
        if (bf.none) return '';
        return bf.value !== null ? '' : 'Those measurements don’t add up. Check them, or tap Skip.';
      case 'colour':
        return (a.surprise || accentByKey(a.colour)) ? '' : 'Pick a colour, or turn on Surprise me.';
    }
    return '';
  }

  var STEP_FIELD = { name: 's-name', age: 's-age', height: 's-height', weight: 's-weight', bodyfat: 's-neck' };

  var lastStepChange = 0;
  function showStep(i, focus) {
    stepIndex = i;
    lastStepChange = Date.now();
    var key = STEPS[i];
    Array.prototype.forEach.call(document.querySelectorAll('#setup-form .step'), function (el) {
      el.hidden = el.getAttribute('data-step') !== key;
    });
    $('setup-progress').style.width = Math.round(((i + 1) / STEPS.length) * 100) + '%';
    $('setup-count').textContent = 'Step ' + (i + 1) + ' of ' + STEPS.length;
    $('setup-back').hidden = (i === 0);
    $('setup-next').textContent = (i === STEPS.length - 1) ? 'See my numbers' : 'Next';
    $('setup-next').dataset.label = $('setup-next').textContent;
    $('setup-skip').hidden = (key !== 'bodyfat');
    Array.prototype.forEach.call(document.querySelectorAll('#setup-form [aria-invalid]'), function (el) { el.removeAttribute('aria-invalid'); });
    updateSetupHints();
    if (focus) {
      var q = document.querySelector('#setup-form .step[data-step="' + key + '"] .step-q');
      focusQuiet(q);
    }
  }

  $('setup-form').addEventListener('input', function (ev) {
    readSetupInputs(); saveDraft(); updateSetupHints();
    if (ev.target && ev.target.type === 'text') setMsg('setup-msg', '');   // typing = fixing it
  });
  $('setup-form').addEventListener('change', function (ev) {
    if (ev.target && ev.target.name === 's-colour') {
      // Picking a favourite means "use this colour", so Surprise me turns off.
      $('s-surprise').checked = false;
      var c = accentByKey(ev.target.value); if (c) setAccent(c);
    }
    if (ev.target && ev.target.id === 's-surprise' && ev.target.checked && launchAccent) setAccent(launchAccent);
    readSetupInputs(); saveDraft(); updateSetupHints();
    // Only clear the message when an answer is picked. A text box losing focus (tapping Next)
    // must NOT clear it, or the button jumps mid-tap and the tap is missed.
    if (ev.target && (ev.target.type === 'radio' || ev.target.type === 'checkbox')) setMsg('setup-msg', '');
  });

  $('setup-back').addEventListener('click', function () {
    if (stepIndex > 0) { setMsg('setup-msg', ''); showStep(stepIndex - 1, true); saveDraft(); }
  });
  $('setup-skip').addEventListener('click', function () {
    $('s-neck').value = ''; $('s-waist').value = ''; $('s-hip').value = '';
    readSetupInputs(); setMsg('setup-msg', '');
    showStep(stepIndex + 1, true); saveDraft();
  });

  var setupBusy = false;
  $('setup-form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    if (setupBusy) return;
    if (Date.now() - lastStepChange < 400) return;   // a double-tap on Next must not skip a question
    readSetupInputs();
    var key = STEPS[stepIndex];
    var problem = checkStep(key, answers);
    if (problem) {
      setMsg('setup-msg', problem);
      var f = $(STEP_FIELD[key]);
      if (f) { f.setAttribute('aria-invalid', 'true'); f.focus(); }
      return;
    }
    setMsg('setup-msg', '');
    if (stepIndex < STEPS.length - 1) { showStep(stepIndex + 1, true); saveDraft(); return; }
    // Last step: double-check EVERY step before saving (a draft could have been edited elsewhere).
    for (var i = 0; i < STEPS.length; i++) {
      if (checkStep(STEPS[i], answers)) { showStep(i, true); setMsg('setup-msg', checkStep(STEPS[i], answers)); return; }
    }
    saveSetup();
  });

  function rowFromAnswers(a) {
    var sex = a.sex;
    var bf = bodyFatFrom(sex, C.parseNumber(a.height), a.neck, a.waist, a.hip);
    var keepBf = !bf.none && bf.value !== null;
    return {
      id: me.id,
      display_name: String(a.name).trim(),
      sex: sex,
      age: C.parseNumber(a.age),
      height_cm: C.parseNumber(a.height),
      weight_kg: C.parseNumber(a.weight),
      activity_level: a.activity,
      goal: a.goal,
      neck_cm: keepBf ? bf.neck : null,
      waist_cm: keepBf ? bf.waist : null,
      hip_cm: keepBf && sex === 'female' ? bf.hip : null,
      accent_color: accentByKey(a.colour) ? a.colour : null,
      surprise_colors: a.surprise !== false
    };
  }

  function saveTodayTargets(p) {
    var n = C.numbers(p);
    if (!n.ok) return Promise.resolve();
    var today = C.localDate();
    return sb.from('daily_targets').upsert({
      user_id: p.id, log_date: today, goal: p.goal, weight_kg: p.weight_kg,
      maintenance_kcal: n.storeMaintenance, target_kcal: n.storeTarget
    }, { onConflict: 'user_id,log_date' }).then(function (res) {
      if (res.error) throw res.error;
      targetsSavedFor = today;
    });
  }

  function saveSetup() {
    if (!navigator.onLine) { setMsg('setup-msg', "You're offline. Your answers are kept on this phone — connect and tap again."); return; }
    setupBusy = true;
    var btn = $('setup-next');
    setBusy(btn, true, 'Saving…');
    var row = rowFromAnswers(answers);
    sb.from('profiles').upsert(row, { onConflict: 'id' }).then(function (res) {
      if (res.error) throw res.error;
      profile = normalise(row);
      try { window.localStorage.removeItem(draftKey()); } catch (e) { /* ignore */ }
      applyProfileAccent(profile);
      // Today's target is a nice-to-have here: if it fails, Today retries it.
      return saveTodayTargets(profile).catch(function (e) { console.warn('Targets save will retry:', e && (e.code || e.message)); });
    }).then(function () {
      showNumbers(profile);
    }).catch(function (e) {
      console.warn('Setup save failed:', e && (e.code || e.message));
      setMsg('setup-msg', friendly(e) + ' Your answers are kept on this phone.');
    }).finally(function () {
      setupBusy = false;
      setBusy(btn, false);
    });
  }

  /* ---------- numbers (setup reveal + Today card) ---------- */
  function makeEl(tag, cls, text) { var el = document.createElement(tag); if (cls) el.className = cls; if (text != null) el.textContent = text; return el; }

  function renderNumbers(prefix, p) {
    var n = C.numbers(p);
    if (!n.ok) return n;
    $(prefix + '-target').textContent = fmt(n.target);
    if (prefix === 'home') $(prefix + '-target').appendChild(makeEl('small', null, 'kcal'));
    var maintEl = $(prefix + '-maint'); maintEl.textContent = fmt(n.maintenance);
    maintEl.appendChild(makeEl('small', null, 'kcal'));
    var bmiEl = $(prefix + '-bmi'); bmiEl.textContent = String(n.bmi.value);
    bmiEl.appendChild(makeEl('small', null, n.bmi.category));
    $(prefix + '-bf-wrap').hidden = n.bodyFat === null;
    if (n.bodyFat !== null) $(prefix + '-bf').textContent = '~' + n.bodyFat + '%';
    var d = n.difference, perWeek = Math.round(Math.abs(d) * 7 / 7700 * 10) / 10;
    var diffText;
    if (d < 0) diffText = fmt(-d) + ' kcal a day below maintenance — about ' + perWeek + ' kg of fat a week.';
    else if (d > 0) diffText = fmt(d) + ' kcal a day above maintenance — about ' + perWeek + ' kg a week.';
    else diffText = 'Eating this keeps your weight about the same.';
    $(prefix + '-diff').textContent = diffText;
    var pr = prefix === 'home' ? null : $(prefix + '-protein');
    if (pr) { pr.textContent = '';
    pr.appendChild(makeEl('span', 'protein-title', 'Protein per day'));
    [['Minimum', n.protein.min], ['Recommended', n.protein.rec], ['Perfect (while cutting)', n.protein.perfect]].forEach(function (row) {
      if (row[1] == null) return;
      var r = makeEl('div', 'protein-row'); r.appendChild(makeEl('span', null, row[0])); r.appendChild(makeEl('b', null, row[1] + ' g')); pr.appendChild(r);
    }); }
    var notes = $(prefix + '-notes'); notes.textContent = '';
    n.notes.forEach(function (t) { notes.appendChild(makeEl('p', 'note-warn', t)); });
    return n;
  }

  function showNumbers(p) {
    var n = renderNumbers('n', p);
    $('n-formula').textContent = 'Worked out with the ' + n.formula + ' formula × your activity level. BMI can’t tell muscle from fat, so it can read high for lifters.';
    show('numbers');
    focusQuiet($('numbers-title'));
  }
  $('numbers-done').addEventListener('click', function () { showToday(''); });

  function viewedDay() {
    var today = C.localDate();
    if (homeDay && (!C.isoOk(homeDay) || homeDay >= today || C.daysBetween(homeDay, today) > DAYS_BACK)) homeDay = null;
    return homeDay || today;
  }
  function showToday(note, opts) {
    if (!profile) { loadProfile(); return; }
    opts = opts || {};
    if (opts.day !== undefined) homeDay = opts.day;
    var today = C.localDate(), d = viewedDay();
    $('home-title').textContent = 'Hi, ' + profile.display_name;
    $('to-profile').textContent = (String(profile.display_name || '?').trim().charAt(0) || '?').toUpperCase();
    $('day-name').textContent = C.dayName(d, today);
    $('home-date').textContent = C.longDate(d);
    $('day-next').disabled = d >= today;
    $('day-prev').disabled = C.daysBetween(d, today) >= DAYS_BACK;
    $('day-today').hidden = d === today;
    $('view-home').classList.toggle('past-day', d !== today);
    $('numbers-card-title').textContent = d === today ? 'Your numbers' : 'Your numbers right now';
    renderNumbers('home', profile);
    setMsg('home-msg', note || '', 'ok');
    show('home');
    if (opts.keepEntries && meals.day() === d) meals.redraw();
    else meals.showDay(d);
    if (resumeCheckPending) { resumeCheckPending = false; workouts.resumeIfActive(); }
    if (targetsSavedFor !== C.localDate()) {
      saveTodayTargets(profile).catch(function (e) { console.warn('Could not save today’s target yet:', e && (e.code || e.message)); });
    }
  }
  $('to-profile').addEventListener('click', function () { openProfile(); });
  function stepDay(n) {
    var today = C.localDate();
    var d = C.addDays(viewedDay(), n);
    if (d > today) d = today;
    if (C.daysBetween(d, today) > DAYS_BACK) return;
    showToday('', { day: d === today ? null : d });
  }
  $('day-prev').addEventListener('click', function () { stepDay(-1); });
  $('day-next').addEventListener('click', function () { stepDay(1); });
  $('day-today').addEventListener('click', function () { showToday('', { day: null }); });
  $('to-week').addEventListener('click', function () { meals.openWeek(); });
  $('profile-back').addEventListener('click', function () { showToday(''); });

  /* ---------- profile & settings ---------- */
  function updateProfileHip() {
    var female = radioValue('p-sex') === 'female';
    document.querySelector('.p-hip-wrap').hidden = !female;
  }
  function openProfile() {
    var p = profile;
    $('p-name').value = p.display_name || '';
    setRadio('p-sex', p.sex);
    $('p-age').value = p.age != null ? p.age : '';
    $('p-height').value = p.height_cm != null ? p.height_cm : '';
    $('p-weight').value = p.weight_kg != null ? p.weight_kg : '';
    $('p-activity').value = p.activity_level;
    setRadio('p-goal', p.goal);
    $('p-neck').value = p.neck_cm != null ? p.neck_cm : '';
    $('p-waist').value = p.waist_cm != null ? p.waist_cm : '';
    $('p-hip').value = p.hip_cm != null ? p.hip_cm : '';
    updateProfileHip();
    renderSwatches('p-swatches', 'p-colour', p.surprise_colors === false ? p.accent_color : p.accent_color);
    $('p-surprise').checked = p.surprise_colors !== false;
    setRadio('p-unit', p.weight_unit === 'kg' ? 'kg' : 'lb');
    ['profile-msg', 'colour-msg', 'unit-msg'].forEach(function (id) { setMsg(id, ''); });
    resetPwCard('');
    show('profile');
    focusQuiet($('profile-title'));
  }
  $('profile-form').addEventListener('change', function (ev) { if (ev.target && ev.target.name === 'p-sex') updateProfileHip(); });

  var profileBusy = false;
  $('profile-form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    if (profileBusy) return;
    var a = {
      name: $('p-name').value, sex: radioValue('p-sex'), age: $('p-age').value, height: $('p-height').value, weight: $('p-weight').value,
      activity: $('p-activity').value, goal: radioValue('p-goal'), neck: $('p-neck').value, waist: $('p-waist').value, hip: $('p-hip').value,
      colour: profile.accent_color, surprise: profile.surprise_colors
    };
    var fields = { name: 'p-name', age: 'p-age', height: 'p-height', weight: 'p-weight', bodyfat: 'p-neck' };
    Array.prototype.forEach.call(document.querySelectorAll('#profile-form [aria-invalid]'), function (el) { el.removeAttribute('aria-invalid'); });
    var keys = ['name', 'sex', 'age', 'height', 'weight', 'activity', 'goal', 'bodyfat'];
    for (var i = 0; i < keys.length; i++) {
      var problem = checkStep(keys[i], a);
      if (problem) {
        if (keys[i] === 'bodyfat') problem = 'Those body-fat measurements don’t add up. Check them, or clear all three boxes.';
        setMsg('profile-msg', problem);
        var f = $(fields[keys[i]]); if (f) { f.setAttribute('aria-invalid', 'true'); f.focus(); }
        return;
      }
    }
    if (!navigator.onLine) { setMsg('profile-msg', "You're offline. Connect to the internet and try again."); return; }
    profileBusy = true;
    var btn = $('profile-save');
    setMsg('profile-msg', '');
    setBusy(btn, true, 'Saving…');
    var row = rowFromAnswers(a);
    sb.from('profiles').upsert(row, { onConflict: 'id' }).then(function (res) {
      if (res.error) throw res.error;
      profile = normalise(Object.assign({}, profile, row));   // keep settings saved elsewhere (lbs/kg, colour)
      return saveTodayTargets(profile).then(function () {
        setMsg('profile-msg', 'Saved. Your targets are updated.', 'ok');
      }, function () {
        setMsg('profile-msg', 'Saved. Today’s target will update the next time you open Today.', 'ok');
        targetsSavedFor = '';
      });
    }).catch(function (e) {
      console.warn('Profile save failed:', e && (e.code || e.message));
      setMsg('profile-msg', friendly(e));
    }).finally(function () {
      profileBusy = false;
      setBusy(btn, false);
    });
  });

  /* App colour: saves straight away */
  var colourBusy = false;
  function saveColour(accentKey, surprise) {
    if (colourBusy) return;
    var before = { accent_color: profile.accent_color, surprise_colors: profile.surprise_colors };
    var change = { accent_color: accentByKey(accentKey) ? accentKey : null, surprise_colors: surprise };
    colourBusy = true;
    Array.prototype.forEach.call(document.querySelectorAll('#p-swatches input, #p-surprise'), function (el) { el.disabled = true; });
    setMsg('colour-msg', '');
    sb.from('profiles').update(change).eq('id', me.id).then(function (res) {
      if (res.error) throw res.error;
      profile.accent_color = change.accent_color;
      profile.surprise_colors = change.surprise_colors;
      setMsg('colour-msg', surprise ? 'Saved. You’ll get a new colour each time you open Taakat.' : 'Saved.', 'ok');
    }).catch(function (e) {
      console.warn('Colour save failed:', e && (e.code || e.message));
      profile.accent_color = before.accent_color; profile.surprise_colors = before.surprise_colors;
      renderSwatches('p-swatches', 'p-colour', before.accent_color);
      $('p-surprise').checked = before.surprise_colors !== false;
      applyProfileAccent(profile);
      setMsg('colour-msg', friendly(e));
    }).finally(function () {
      colourBusy = false;
      Array.prototype.forEach.call(document.querySelectorAll('#p-swatches input, #p-surprise'), function (el) { el.disabled = false; });
    });
  }
  $('p-swatches').addEventListener('change', function (ev) {
    var c = accentByKey(ev.target.value); if (!c) return;
    setAccent(c);
    $('p-surprise').checked = false;
    saveColour(c.key, false);
  });
  $('p-surprise').addEventListener('change', function () {
    var on = $('p-surprise').checked;
    var fav = radioValue('p-colour') || profile.accent_color;
    if (!on && !accentByKey(fav)) {
      // Turning Surprise off with no favourite: keep the colour showing right now.
      var current = launchAccent || ACCENTS[3];
      fav = current.key;
      setRadio('p-colour', fav);
    }
    if (!on) { var c = accentByKey(fav); if (c) setAccent(c); }
    saveColour(fav, on);
  });

  /* Workout weights: lbs or kg — saves straight away */
  var unitBusy = false;
  $('p-units').addEventListener('change', function () {
    var u = radioValue('p-unit') === 'kg' ? 'kg' : 'lb';
    if (unitBusy || u === profile.weight_unit) return;
    var before = profile.weight_unit;
    unitBusy = true;
    Array.prototype.forEach.call(document.querySelectorAll('#p-units input'), function (el) { el.disabled = true; });
    setMsg('unit-msg', '');
    sb.from('profiles').update({ weight_unit: u }).eq('id', me.id).then(function (res) {
      if (res.error) throw res.error;
      profile.weight_unit = u;
      setMsg('unit-msg', 'Saved. Workouts now show ' + (u === 'kg' ? 'kg' : 'lbs') + '.', 'ok');
      workouts.unitsChanged();
    }).catch(function (e) {
      console.warn('Unit save failed:', e && (e.code || e.message));
      setRadio('p-unit', before);
      setMsg('unit-msg', friendly(e));
    }).finally(function () {
      unitBusy = false;
      Array.prototype.forEach.call(document.querySelectorAll('#p-units input'), function (el) { el.disabled = false; });
    });
  });

  /* Change password: 1) confirm the current password, 2) choose a new one. Forgot → reset email. */
  var pwVerifiedAt = 0;
  var PW_CONFIRM_WINDOW_MS = 10 * 60 * 1000;
  function resetPwCard(doneText) {
    pwVerifiedAt = 0;
    ['pw-current', 'pw-new', 'pw-confirm'].forEach(function (id) { $(id).value = ''; markInvalid($(id), false); });
    ['pw-check-msg', 'pw-msg'].forEach(function (id) { setMsg(id, ''); });
    $('pw-check-form').hidden = true;
    $('pw-form').hidden = true;
    $('pw-open').hidden = false;
    setMsg('pw-done', doneText || '', 'ok');
  }
  $('pw-open').addEventListener('click', function () {
    setMsg('pw-done', '');
    $('pw-open').hidden = true;
    $('pw-check-form').hidden = false;
    focusQuiet($('pw-current'));
  });
  $('pw-cancel-1').addEventListener('click', function () { resetPwCard(''); });
  $('pw-cancel-2').addEventListener('click', function () { resetPwCard(''); });

  var pwCheckBusy = false;
  $('pw-check-form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    if (pwCheckBusy) return;
    var cur = $('pw-current'), btn = $('pw-check-btn');
    markInvalid(cur, false);
    if (!cur.value) { markInvalid(cur, true); setMsg('pw-check-msg', 'Enter your current password.'); cur.focus(); return; }
    if (!navigator.onLine) { setMsg('pw-check-msg', "You're offline. Connect to the internet and try again."); return; }
    if (!me || !me.email) { setMsg('pw-check-msg', 'Please log out and back in, then try again.'); return; }
    pwCheckBusy = true;
    setMsg('pw-check-msg', '');
    setBusy(btn, true, 'Checking…');
    // Logging in again with the current password is how we check it (it just refreshes your session).
    sb.auth.signInWithPassword({ email: me.email, password: cur.value }).then(function (res) {
      if (res.error) throw res.error;
      pwVerifiedAt = Date.now();
      cur.value = '';
      $('pw-check-form').hidden = true;
      $('pw-form').hidden = false;
      focusQuiet($('pw-new'));
    }).catch(function (e) {
      console.warn('Current password check failed:', e && (e.code || e.message));
      if (e && (e.code === 'invalid_credentials' || /invalid login/i.test(e.message || ''))) {
        cur.value = ''; markInvalid(cur, true); cur.focus();
        setMsg('pw-check-msg', "That's not your current password. Try again, or use \u201cForgot your current password?\u201d below.");
      } else {
        setMsg('pw-check-msg', friendly(e));
      }
    }).finally(function () {
      pwCheckBusy = false;
      setBusy(btn, false);
    });
  });

  var pwForgotBusy = false, pwForgotTimer = null;
  $('pw-forgot').addEventListener('click', function () {
    var btn = $('pw-forgot');
    if (pwForgotBusy || btn.disabled) return;
    if (!navigator.onLine) { setMsg('pw-check-msg', "You're offline. Connect to the internet and try again."); return; }
    pwForgotBusy = true;
    if (!btn.dataset.label) btn.dataset.label = btn.textContent;
    btn.disabled = true; btn.textContent = 'Sending…';
    sb.auth.resetPasswordForEmail(me.email, { redirectTo: window.location.origin + window.location.pathname }).then(function (res) {
      var e = res && res.error;
      if (e && (e.status === 429 || e.name === 'AuthRetryableFetchError' || e.name === 'AbortError' || (e.status || 0) >= 500)) throw e;
      setMsg('pw-check-msg', 'We\u2019ve emailed a reset link to ' + me.email + '. Open it on this phone to choose a new password.', 'ok');
      var left = RESET_COOLDOWN_S;
      btn.textContent = 'Email sent \u2014 send again in ' + left + 's';
      clearInterval(pwForgotTimer);
      pwForgotTimer = setInterval(function () {
        left -= 1;
        if (left <= 0) { clearInterval(pwForgotTimer); btn.disabled = false; btn.textContent = btn.dataset.label; }
        else btn.textContent = 'Email sent \u2014 send again in ' + left + 's';
      }, 1000);
    }).catch(function (e) {
      console.warn('Reset email failed:', e && (e.code || e.message));
      setMsg('pw-check-msg', friendly(e));
      btn.disabled = false; btn.textContent = btn.dataset.label;
    }).finally(function () { pwForgotBusy = false; });
  });

  var pwBusy = false;
  $('pw-form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    if (pwBusy) return;
    if (!pwVerifiedAt || Date.now() - pwVerifiedAt > PW_CONFIRM_WINDOW_MS) {
      resetPwCard('');
      $('pw-open').hidden = true; $('pw-check-form').hidden = false;
      setMsg('pw-check-msg', 'For safety, please confirm your current password again.');
      return;
    }
    var p1 = $('pw-new'), p2 = $('pw-confirm'), btn = $('pw-save');
    markInvalid(p1, false); markInvalid(p2, false);
    var pw = p1.value;
    if (pw.length < 8) { markInvalid(p1, true); setMsg('pw-msg', 'Use at least 8 characters.'); p1.focus(); return; }
    if (byteLength(pw) > 72) { markInvalid(p1, true); setMsg('pw-msg', 'That password is too long (72 characters max).'); p1.focus(); return; }
    if (/^\s|\s$/.test(pw)) { markInvalid(p1, true); setMsg('pw-msg', "Don't start or end your password with a space."); p1.focus(); return; }
    if (pw !== p2.value) { markInvalid(p2, true); setMsg('pw-msg', "The two passwords don't match."); p2.focus(); return; }
    if (!navigator.onLine) { setMsg('pw-msg', "You're offline. Connect to the internet and try again."); return; }
    pwBusy = true;
    setMsg('pw-msg', '');
    setBusy(btn, true, 'Saving…');
    sb.auth.updateUser({ password: pw }).then(function (res) {
      if (res.error) throw res.error;
      resetPwCard('Password changed. Use the new one next time you log in.');
    }).catch(function (e) {
      console.warn('Password change failed:', e && (e.code || e.message));
      setMsg('pw-msg', friendly(e));
    }).finally(function () {
      pwBusy = false;
      setBusy(btn, false);
    });
  });

  /* ---------- offline banner ---------- */
  function syncBanners() {
    document.body.classList.toggle('has-banner', !$('offline').hidden || !$('update-banner').hidden);
  }
  function updateOnline() { $('offline').hidden = navigator.onLine; syncBanners(); }
  window.addEventListener('online', updateOnline);
  window.addEventListener('offline', updateOnline);
  updateOnline();

  checkForUpdate(true);
  boot();
})();
