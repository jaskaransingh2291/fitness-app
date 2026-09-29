/* Taakat — stage 2: log in, log out, forgot password, set new password. */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var REQUEST_TIMEOUT_MS = 15000;
  var RESET_COOLDOWN_S = 60;
  var ACCENTS = [
    { hex: '#C8F54A', rgb: '200, 245, 74' },   // Volt Lime
    { hex: '#6B97FF', rgb: '107, 151, 255' },  // Electric Blue
    { hex: '#B39BFF', rgb: '179, 155, 255' },  // Ultra Violet
    { hex: '#3FDDF5', rgb: '63, 221, 245' },   // Ice Cyan
    { hex: '#FF7AC6', rgb: '255, 122, 198' },  // Hot Pink
    { hex: '#FF5A5F', rgb: '255, 90, 95' }     // Power Red
  ];

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
    document.documentElement.style.setProperty('--a', c.hex);
    document.documentElement.style.setProperty('--a-rgb', c.rgb);
  }

  var VIEWS = ['loading', 'login', 'forgot', 'continue', 'reset', 'home', 'fatal'];
  var currentView = null;
  function show(name, focusId) {
    VIEWS.forEach(function (v) { var el = $('view-' + v); if (el) el.hidden = (v !== name); });
    $('invite-note').hidden = !(name === 'login' || name === 'forgot');
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
    var email = (session && session.user && session.user.email) || '';
    $('home-email').textContent = email;
    setMsg('home-msg', note || '', 'ok');
    homeShownFor = session && session.user ? session.user.id : null;
    show('home');
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
      if (currentView === 'home' || currentView === 'reset') {
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
  $('logout-btn').addEventListener('click', function () {
    if (logoutBusy) return;
    logoutBusy = true;
    userLoggedOutOnPurpose = true;
    var btn = $('logout-btn');
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
      showLogin('');
      $('login-email').value = '';
    });
  });

  /* ---------- offline banner ---------- */
  function updateOnline() { $('offline').hidden = navigator.onLine; }
  window.addEventListener('online', updateOnline);
  window.addEventListener('offline', updateOnline);
  updateOnline();

  boot();
})();
