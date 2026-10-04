/* Taakat — Crew: share your logs with someone you trust (both ways, view only).
   Stage C1: invite by email, accept / decline, cancel, stop sharing, and a heads-up on Today.
   The database decides who can see what (is_me_or_crew); this screen only manages the links.
   Everything shown on screen uses textContent only. */
(function (root) {
  'use strict';

  function cleanEmail(s) { return String(s == null ? '' : s).trim().toLowerCase(); }
  function emailOk(s) { return /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(s) && s.length <= 254; }
  /* rows from my_crew_links() → { accepted: [], incoming: [], outgoing: [] } */
  function sortLinks(rows) {
    var out = { accepted: [], incoming: [], outgoing: [] };
    (rows || []).forEach(function (r) {
      if (!r || r.link_id == null) return;
      var x = { id: r.link_id, name: String(r.other_name || 'Someone').slice(0, 40), status: r.status, mine: !!r.i_sent_it, otherId: r.other_id || null };
      if (r.status === 'accepted') out.accepted.push(x);
      else if (r.status === 'pending') (x.mine ? out.outgoing : out.incoming).push(x);
    });
    return out;
  }
  var pure = { cleanEmail: cleanEmail, emailOk: emailOk, sortLinks: sortLinks };

  /* ====================================================================== */
  function TaakatCrew(api) {
    var $ = api.$, sb = api.sb;
    var links = { accepted: [], incoming: [], outgoing: [] };
    var loadedFor = null, token = 0, busy = {}, lastSend = 0, armTimer = null;

    function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
    function btn(cls, text, onClick, label) { var b = el('button', cls, text); b.type = 'button'; if (label) b.setAttribute('aria-label', label); b.addEventListener('click', onClick); return b; }
    function me() { return api.me(); }
    function offline() { if (navigator.onLine) return false; api.setMsg('crew-msg', "You're offline. Connect to the internet and try again — nothing changed."); return true; }

    /* Names + statuses come from my_crew_links(); the other person's id comes from your own crew_links rows. */
    function load() {
      var user = me(); if (!user) return Promise.resolve(links);
      var t = ++token;
      return Promise.all([
        sb.rpc('my_crew_links'),
        sb.from('crew_links').select('id,requester_id,addressee_id,status')
      ]).then(function (r) {
        if (r[0].error) throw r[0].error;
        if (r[1].error) throw r[1].error;
        var other = {};
        (r[1].data || []).forEach(function (l) { other[l.id] = l.requester_id === user.id ? l.addressee_id : l.requester_id; });
        var rows = (r[0].data || []).map(function (x) { return Object.assign({}, x, { other_id: other[x.link_id] || null }); });
        if (t === token && me() && me().id === user.id) { links = sortLinks(rows); loadedFor = user.id; }
        return links;
      });
    }

    /* ---------- Profile → Crew card ---------- */
    function card() {
      api.setMsg('crew-msg', '');
      $('crew-email').value = '';
      var box = $('crew-list'); box.textContent = '';
      box.appendChild(el('p', 'muted small', 'Loading your crew…'));
      load().then(draw).catch(function (e) {
        console.warn('Crew load failed:', e && (e.code || e.message));
        box.textContent = '';
        box.appendChild(el('p', 'muted small', api.friendly(e)));
        box.appendChild(btn('btn-link', 'Try again', card));
      });
    }
    function draw() {
      var box = $('crew-list'); box.textContent = '';
      var ul = el('ul', 'crew-rows');
      links.incoming.forEach(function (x) {
        var li = el('li', 'crew-row crew-in');
        li.appendChild(el('p', 'crew-name', x.name));
        li.appendChild(el('p', 'muted small crew-what', 'Wants to share logs with you. You’d both see each other’s food, workouts, weigh-ins and cover photo.'));
        var row = el('div', 'crew-btns');
        row.appendChild(btn('btn-primary crew-accept', 'Accept', function (ev) { accept(x, ev.currentTarget); }, 'Accept ' + x.name + '’s request'));
        row.appendChild(btn('btn-link crew-decline', 'Decline', function (ev) { remove(x, ev.currentTarget, 'decline'); }, 'Decline ' + x.name + '’s request'));
        li.appendChild(row); ul.appendChild(li);
      });
      links.accepted.forEach(function (x) {
        var li = el('li', 'crew-row crew-on');
        li.appendChild(el('p', 'crew-name', x.name));
        li.appendChild(el('p', 'muted small crew-what', 'Sharing — you both see each other’s logs (view only).'));
        var row = el('div', 'crew-btns');
        var stop = btn('btn-link danger-link crew-stop', 'Stop sharing', function () { remove(x, stop, 'stop'); }, 'Stop sharing with ' + x.name);
        row.appendChild(stop); li.appendChild(row); ul.appendChild(li);
      });
      links.outgoing.forEach(function (x) {
        var li = el('li', 'crew-row crew-out');
        li.appendChild(el('p', 'crew-name', x.name));
        li.appendChild(el('p', 'muted small crew-what', 'Invite sent — waiting for them to accept.'));
        var row = el('div', 'crew-btns');
        row.appendChild(btn('btn-link crew-cancel', 'Cancel invite', function (ev) { remove(x, ev.currentTarget, 'cancel'); }, 'Cancel your invite to ' + x.name));
        li.appendChild(row); ul.appendChild(li);
      });
      if (ul.children.length) box.appendChild(ul);
      else box.appendChild(el('p', 'muted small crew-none', 'You’re not sharing with anyone yet.'));
      todayNotice();
    }

    $('crew-form').addEventListener('submit', function (ev) {
      ev.preventDefault();
      if (busy.send) return;
      var email = cleanEmail($('crew-email').value);
      if (!emailOk(email)) { api.setMsg('crew-msg', 'Type the email address they use to log in to Taakat.'); $('crew-email').setAttribute('aria-invalid', 'true'); $('crew-email').focus(); return; }
      if (me() && cleanEmail(me().email) === email) { api.setMsg('crew-msg', 'That’s your own email — type the other person’s.'); return; }
      if (Date.now() - lastSend < 5000) { api.setMsg('crew-msg', 'Give it a few seconds before sending another invite.'); return; }
      if (offline()) return;
      busy.send = true; lastSend = Date.now();
      var b = $('crew-send'); api.setBusy(b, true, 'Sending…');
      sb.rpc('send_crew_request', { target_email: email }).then(function (res) {
        if (res.error) throw res.error;
        $('crew-email').value = '';
        return load().then(function () {
          draw();
          // Same words whether or not that email has an account — nobody can use this to check who's signed up.
          api.setMsg('crew-msg', 'Sent. If ' + email + ' uses Taakat, they’ll see your invite in Profile → Crew (and on their Today screen).' +
            (links.incoming.length ? ' If they already invited you, accept their request above instead.' : ''), 'ok');
        });
      }).catch(function (e) {
        console.warn('Crew invite failed:', e && (e.code || e.message));
        api.setMsg('crew-msg', api.friendly(e) + ' The invite wasn’t sent — try again.');
      }).finally(function () { busy.send = false; api.setBusy(b, false); });
    });
    $('crew-email').addEventListener('input', function () { $('crew-email').removeAttribute('aria-invalid'); api.setMsg('crew-msg', ''); });

    function accept(x, b) {
      if (busy.link) return;
      if (offline()) return;
      busy.link = true; api.setBusy(b, true, 'Accepting…');
      sb.from('crew_links').update({ status: 'accepted' }).eq('id', x.id).select().then(function (res) {
        if (res.error) throw res.error;
        if (!res.data || !res.data.length) throw Object.assign(new Error('gone'), { taakat: 'That invite isn’t there any more — they may have cancelled it.' });
        return load();
      }).then(function () {
        draw();
        api.setMsg('crew-msg', 'You and ' + x.name + ' are now sharing logs.', 'ok');
        if (api.crewChanged) api.crewChanged();
      }).catch(function (e) {
        console.warn('Crew accept failed:', e && (e.code || e.message));
        api.setMsg('crew-msg', e && e.taakat ? e.taakat : api.friendly(e) + ' Nothing changed — try again.');
        load().then(draw).catch(function () {});
      }).finally(function () { busy.link = false; });
    }
    function remove(x, b, kind) {
      if (busy.link) return;
      if (kind === 'stop' && b.dataset.armed !== '1') {
        b.dataset.armed = '1'; b.textContent = 'Tap again to stop sharing';
        clearTimeout(armTimer); armTimer = setTimeout(function () { if (b.isConnected) { b.dataset.armed = ''; b.textContent = 'Stop sharing'; } }, 4000);
        return;
      }
      if (offline()) return;
      busy.link = true; api.setBusy(b, true, kind === 'stop' ? 'Stopping…' : (kind === 'cancel' ? 'Cancelling…' : 'Declining…'));
      sb.from('crew_links').delete().eq('id', x.id).then(function (res) {
        if (res.error) throw res.error;
        return load();
      }).then(function () {
        draw();
        api.setMsg('crew-msg', kind === 'stop' ? 'Stopped sharing with ' + x.name + '. Neither of you can see the other’s logs now.' : (kind === 'cancel' ? 'Invite to ' + x.name + ' cancelled.' : 'Declined ' + x.name + '’s request.'), 'ok');
        if (api.crewChanged) api.crewChanged();
      }).catch(function (e) {
        console.warn('Crew change failed:', e && (e.code || e.message));
        api.setMsg('crew-msg', api.friendly(e) + ' Nothing changed — try again.');
        api.setBusy(b, false);
      }).finally(function () { busy.link = false; });
    }

    /* ---------- Today: "X wants to share logs with you" ---------- */
    function todayNotice() {
      var box = $('crew-notice');
      var x = links.incoming[0];
      box.hidden = !x;
      if (x) $('crew-notice-text').textContent = x.name + ' wants to share logs with you.' + (links.incoming.length > 1 ? ' (+' + (links.incoming.length - 1) + ' more)' : '');
    }
    var lastRefresh = 0;
    function refreshToday() {
      var user = me(); if (!user) return;
      if (loadedFor === user.id && Date.now() - lastRefresh < 60000) { todayNotice(); return; }   // at most once a minute
      lastRefresh = Date.now();
      load().then(function () { if (api.current() === 'home') todayNotice(); }).catch(function () { /* the notice is a nice-to-have */ });
    }
    $('crew-notice-go').addEventListener('click', function () { api.openProfileCrew(); });

    return {
      card: card, refreshToday: refreshToday, load: load,
      accepted: function () { return links.accepted.slice(); },
      clear: function () { links = { accepted: [], incoming: [], outgoing: [] }; loadedFor = null; lastRefresh = 0; token++; busy = {}; $('crew-notice').hidden = true; }
    };
  }

  TaakatCrew.pure = pure;
  if (typeof module !== 'undefined' && module.exports) module.exports = pure;
  else root.TaakatCrew = TaakatCrew;
})(this);
