/* Roles-dashboard.html/_shared.js
   Shared shell for every role page: sign-in check, data fetch, header, and
   small rendering helpers. Each role page (CTO.html, CFO.html, ...) only
   supplies a render() function for its own widgets.

   Auth: reuses the admin panel's token (localStorage 'ryzen_admin_token').
   The server decides what this person may see — this file only displays it. */
(function () {
  var TOKEN_KEY = 'ryzen_admin_token';
  var ADMIN_PANEL_URL = '/admin.html';

  /* ---------- formatting ---------- */
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function inr(n) { return '₹' + Number(n || 0).toLocaleString('en-IN'); }
  function num(n) { return n == null ? '—' : Number(n).toLocaleString('en-IN'); }
  function pct(n) { return n == null ? '—' : n + '%'; }
  function ago(iso) {
    if (!iso) return '—';
    var s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    return Math.floor(s / 86400) + 'd ago';
  }
  function html(s) { return { __html: s }; }              // mark a string as already-safe HTML
  function cell(v) { return v && typeof v === 'object' && v.__html !== undefined ? v.__html : esc(v); }

  /* ---------- building blocks (all return HTML strings) ---------- */
  function stat(label, value, sub, tone) {
    return '<div class="rd-stat ' + (tone || '') + '"><div class="v">' + esc(value) + '</div><div class="l">' + esc(label) + '</div>' +
      (sub ? '<div class="s">' + esc(sub) + '</div>' : '') + '</div>';
  }
  function grid(items) { return '<div class="rd-grid">' + items.join('') + '</div>'; }
  function pill(text, tone) { return '<span class="rd-pill ' + (tone || 'muted') + '">' + esc(text) + '</span>'; }
  function section(title, body, aside) {
    return '<section class="rd-card"><header><h2>' + esc(title) + '</h2>' + (aside ? '<span class="aside">' + esc(aside) + '</span>' : '') + '</header>' + body + '</section>';
  }
  function cols(n, cards) { return '<div class="rd-cols ' + (n === 3 ? 'three' : 'two') + '">' + cards.join('') + '</div>'; }
  function note(text) { return '<div class="rd-note">' + text + '</div>'; }
  function empty(text) { return '<div class="rd-note">' + esc(text) + '</div>'; }

  // Shown when a data source came back null (couldn't be read) — never a made-up zero.
  function na(value, render, what) {
    if (value === null || value === undefined) return empty((what || 'This section') + " couldn't be loaded right now. Tap Refresh to try again. If this is a new section, run its SQL in Supabase first (see sql/setup-tables.sql).");
    return render(value);
  }

  // headers: ['Name', {label:'Amount', num:true}]; rows: arrays of cells (strings/numbers or RD.html())
  function table(headers, rows, emptyText) {
    if (!rows || !rows.length) return empty(emptyText || 'Nothing to show yet.');
    var head = headers.map(function (h) {
      var o = typeof h === 'object' ? h : { label: h };
      return '<th' + (o.num ? ' class="num"' : '') + '>' + esc(o.label) + '</th>';
    }).join('');
    var body = rows.map(function (r) {
      return '<tr>' + r.map(function (c, i) {
        var h = headers[i]; var isNum = typeof h === 'object' && h.num;
        return '<td' + (isNum ? ' class="num"' : '') + '>' + cell(c) + '</td>';
      }).join('') + '</tr>';
    }).join('');
    return '<div class="rd-scroll"><table class="rd-table"><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table></div>';
  }

  // items: [{label, value, tone?, text?}] — bar length is relative to the largest value
  function bars(items, emptyText) {
    if (!items || !items.length) return empty(emptyText || 'Nothing to show yet.');
    var max = Math.max.apply(null, items.map(function (i) { return i.value; }).concat([1]));
    return items.map(function (i) {
      return '<div class="rd-bar"><span class="name">' + esc(i.label) + '</span>' +
        '<span class="track"><span class="fill ' + (i.tone || '') + '" style="width:' + Math.max(2, Math.round(i.value / max * 100)) + '%"></span></span>' +
        '<span class="val">' + esc(i.text != null ? i.text : i.value) + '</span></div>';
    }).join('');
  }

  // points: [{date, orders, revenue}]; valueKey: 'revenue' | 'orders'
  function trend(points, valueKey, fmt) {
    var W = 320, H = 110, base = 92, slot = W / points.length;
    var max = Math.max.apply(null, points.map(function (p) { return p[valueKey]; }).concat([1]));
    var f = fmt || num;
    var total = points.reduce(function (s, p) { return s + p[valueKey]; }, 0);
    var bars = points.map(function (p, i) {
      var h = p[valueKey] ? Math.max(3, Math.round(p[valueKey] / max * (base - 6))) : 2;
      return '<rect class="' + (p[valueKey] ? 'b' : 'z') + '" x="' + (i * slot + 1).toFixed(1) + '" y="' + (base - h) + '" width="' + Math.max(2, slot - 2).toFixed(1) + '" height="' + h + '" rx="1.5"><title>' + esc(p.date + ': ' + f(p[valueKey])) + '</title></rect>';
    }).join('');
    var first = points[0].date.slice(5), last = points[points.length - 1].date.slice(5);
    return '<svg class="rd-trend" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Daily ' + valueKey + ' over the last ' + points.length + ' days, total ' + esc(f(total)) + '">' +
      bars + '<text x="0" y="' + (H - 6) + '">' + esc(first) + '</text><text x="' + W + '" y="' + (H - 6) + '" text-anchor="end">' + esc(last) + '</text></svg>';
  }

  var STATUS_TONE = { paid: 'ok', shipped: 'ok', delivered: 'ok', created: 'warn', cancelled: 'bad', refunded: 'bad' };
  function statusPill(status) { return html(pill(status || 'unknown', STATUS_TONE[status] || 'muted')); }
  function statusBars(byStatus) {
    var items = Object.keys(byStatus || {}).map(function (k) {
      return { label: k, value: byStatus[k], tone: STATUS_TONE[k] === 'ok' ? 'ok' : (STATUS_TONE[k] || '') };
    }).sort(function (a, b) { return b.value - a.value; });
    return bars(items, 'No orders yet.');
  }
  function when(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
  }

  // Percent change between two numbers, as a short label ("up 12%" / "down 8%" / "no change").
  function change(now, before) {
    if (!before) return now ? 'no earlier period to compare' : '';
    var d = Math.round((now - before) / before * 100);
    return d === 0 ? 'no change vs previous period' : (d > 0 ? 'up ' : 'down ') + Math.abs(d) + '% vs previous period';
  }

  /* ---------- small formatters ---------- */
  function day(d) {
    if (!d) return '—';
    var dt = new Date(String(d).slice(0, 10) + 'T00:00:00Z');
    return isNaN(dt.getTime()) ? '—' : dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  }
  function monthLabel(m) {
    var dt = new Date(String(m).slice(0, 7) + '-01T00:00:00Z');
    return isNaN(dt.getTime()) ? String(m) : dt.toLocaleDateString('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' });
  }
  function label(v) { return String(v == null ? '' : v).replace(/_/g, ' ').replace(/^./, function (c) { return c.toUpperCase(); }); }
  // A pill for "days left": overdue / due soon / fine.
  function dueTag(daysLeft, soon) {
    if (daysLeft == null) return html('—');
    if (daysLeft < 0) return html(pill(Math.abs(daysLeft) + ' days overdue', 'bad'));
    if (daysLeft <= (soon || 30)) return html(pill(daysLeft === 0 ? 'Due today' : 'In ' + daysLeft + ' days', 'warn'));
    return html(pill('In ' + daysLeft + ' days', 'ok'));
  }
  // Field description for RD.add: RD.f('size', 'Size', 'text', {required: true})
  function f(key, label, type, extra) {
    var out = { key: key, label: label, type: type || 'text' };
    for (var k in (extra || {})) out[k] = extra[k];
    return out;
  }
  // Options for a status dropdown inside a form; blank means "let the default apply".
  function statusOpts(values) {
    return (values || []).map(function (v) { return [v, label(v)]; });
  }
  function opts(list, valueKey, labelKey) {
    return (list || []).map(function (x) { return [x[valueKey], x[labelKey]]; });
  }

  /* ---------- forms and row actions ----------
     A form or button carries the name of a role action. One set of listeners
     (attached once in boot) sends it to the server and reloads the page. */
  var formCount = 0;

  function fieldHtml(f, formId) {
    var name = esc(f.key), req = f.required ? ' required' : '', control;
    if (f.type === 'select') {
      control = '<select name="' + name + '"' + req + '><option value="">' + (f.required ? 'Choose…' : (f.blank || 'None')) + '</option>' +
        (f.options || []).map(function (o) { return '<option value="' + esc(o[0]) + '">' + esc(o[1]) + '</option>'; }).join('') + '</select>';
    } else if (f.type === 'textarea') {
      control = '<textarea name="' + name + '" rows="2"' + req + '></textarea>';
    } else {
      var t = { number: 'number', int: 'number', date: 'date', month: 'month', email: 'email', url: 'url' }[f.type] || 'text';
      var extra = f.type === 'number' ? ' step="any"' : f.type === 'int' ? ' step="1"' : '';
      if (f.min != null) extra += ' min="' + esc(f.min) + '"';
      if (f.max != null) extra += ' max="' + esc(f.max) + '"';
      var list = f.suggest && f.suggest.length ? ' list="' + formId + '-' + name + '"' : '';
      var val = f.today ? ' value="' + new Date().toISOString().slice(0, 10) + '"' : '';
      control = '<input name="' + name + '" type="' + t + '"' + extra + list + val + req + '>' +
        (list ? '<datalist id="' + formId + '-' + name + '">' + f.suggest.map(function (v) { return '<option value="' + esc(v) + '">'; }).join('') + '</datalist>' : '');
    }
    return '<label>' + esc(f.label) + (f.required ? ' *' : '') + control + '</label>';
  }

  // A collapsed "+ Add ..." form. fields: [{key, label, type, required, options, suggest, min, max, today}]
  function add(title, action, fields, submitLabel) {
    var id = 'rdf' + (++formCount);
    return '<details class="rd-add"><summary>+ ' + esc(title) + '</summary>' +
      '<form class="rd-form" data-rd-action="' + esc(action) + '">' +
      fields.map(function (f) { return fieldHtml(f, id); }).join('') +
      '<button class="rd-btn" type="submit">' + esc(submitLabel || 'Save') + '</button><div class="rd-msg"></div></form></details>';
  }

  // A button that runs an action on one record, e.g. RD.button('Resolve', 'resolve-ticket', {id: t.id}).
  function button(text, action, payload, o) {
    o = o || {};
    return html('<button type="button" class="rd-btn rd-mini' + (o.danger ? ' danger' : '') + '" data-rd-action="' + esc(action) + '" data-rd-payload="' + esc(JSON.stringify(payload || {})) + '"' +
      (o.confirm ? ' data-rd-confirm="' + esc(o.confirm) + '"' : '') + '>' + esc(text) + '</button>');
  }
  function remove(action, payload, what) {
    return button('Remove', action, payload, { danger: true, confirm: 'Remove ' + (what || 'this record') + '? This cannot be undone.' });
  }
  // A dropdown that changes one record's status.
  function statusSelect(action, id, current, values) {
    return html('<select class="rd-select rd-inline" aria-label="Status" data-rd-change="' + esc(action) + '" data-rd-payload="' + esc(JSON.stringify({ id: id })) + '">' +
      values.map(function (v) { return '<option value="' + esc(v) + '"' + (v === current ? ' selected' : '') + '>' + esc(label(v)) + '</option>'; }).join('') + '</select>');
  }

  function toast(text, tone) {
    try {
      var t = document.createElement('div');
      t.className = 'rd-toast ' + (tone || '');
      t.textContent = text;
      document.body.appendChild(t);
      setTimeout(function () { if (t.remove) t.remove(); }, 2600);
    } catch (e) { /* the message is only a courtesy */ }
  }

  function wireActions() {
    var body = document.getElementById('rd-body');

    body.addEventListener('submit', async function (e) {
      var form = e.target && e.target.closest ? e.target.closest('form[data-rd-action]') : null;
      if (!form) return;
      e.preventDefault();
      var msg = form.querySelector('.rd-msg');
      var btn = form.querySelector('button[type="submit"]');
      if (msg) msg.textContent = 'Saving…';
      if (btn) btn.disabled = true;
      try {
        await call(form.getAttribute('data-rd-action'), Object.fromEntries(new FormData(form)));
        toast('Saved', 'ok');
        await load();
      } catch (err) {
        if (msg) msg.textContent = err.message;
        if (btn) btn.disabled = false;
      }
    });

    body.addEventListener('click', async function (e) {
      var el = e.target && e.target.closest ? e.target.closest('button[data-rd-action]') : null;
      if (!el || el.tagName === 'FORM') return;
      var ask = el.getAttribute('data-rd-confirm');
      if (ask && !window.confirm(ask)) return;
      el.disabled = true;
      try {
        await call(el.getAttribute('data-rd-action'), JSON.parse(el.getAttribute('data-rd-payload') || '{}'));
        await load();
      } catch (err) {
        toast(err.message, 'bad');
        el.disabled = false;
      }
    });

    body.addEventListener('change', async function (e) {
      var el = e.target && e.target.closest ? e.target.closest('select[data-rd-change]') : null;
      if (!el) return;
      el.disabled = true;
      try {
        var payload = JSON.parse(el.getAttribute('data-rd-payload') || '{}');
        payload.status = el.value;
        await call(el.getAttribute('data-rd-change'), payload);
        toast('Updated', 'ok');
        await load();
      } catch (err) {
        toast(err.message, 'bad');
        await load();
      }
    });
  }

  /* ---------- page shell ---------- */
  var current = null;

  function shell(opts) {
    document.getElementById('rd-app').innerHTML =
      '<div class="rd-wrap">' +
        '<div class="rd-top"><div class="rd-brand">Razariser</div>' +
          '<div class="rd-tools" id="rd-tools"></div></div>' +
        '<div id="rd-hero" class="rd-hero"><h1>' + esc(opts.role) + ' dashboard</h1></div>' +
        '<div id="rd-body"><div class="rd-loading">Loading your dashboard…</div></div>' +
      '</div>';
  }

  function signOut() {
    try { localStorage.removeItem(TOKEN_KEY); } catch (e) { /* ignore */ }
    location.href = ADMIN_PANEL_URL;
  }

  function tools(payload, opts) {
    var el = document.getElementById('rd-tools');
    var h = '';
    if (payload && payload.viewer && payload.viewer.isSuperAdmin && payload.roles) {
      h += '<select class="rd-select" id="rd-switch" aria-label="Switch role dashboard">' +
        payload.roles.map(function (r) {
          return '<option value="' + esc(r.path) + '"' + (r.title === opts.role ? ' selected' : '') + '>' + esc(r.title) + '</option>';
        }).join('') + '</select>';
    }
    h += '<button class="rd-btn" id="rd-refresh" type="button">Refresh</button>' +
         '<a class="rd-btn" href="' + ADMIN_PANEL_URL + '">Admin panel</a>' +
         '<button class="rd-btn" id="rd-signout" type="button">Sign out</button>';
    el.innerHTML = h;
    var sw = document.getElementById('rd-switch');
    if (sw) sw.addEventListener('change', function () { location.href = sw.value; });
    document.getElementById('rd-refresh').addEventListener('click', function () { load(); });
    document.getElementById('rd-signout').addEventListener('click', signOut);
  }

  function showProblem(title, message, extraHtml) {
    document.getElementById('rd-body').innerHTML =
      '<div class="rd-center"><h2>' + esc(title) + '</h2><p>' + esc(message) + '</p>' + (extraHtml || '') + '</div>';
  }

  async function load() {
    var opts = current;
    var token = null;
    try { token = localStorage.getItem(TOKEN_KEY); } catch (e) { /* ignore */ }
    if (!token) { location.href = ADMIN_PANEL_URL; return; }

    var btn = document.getElementById('rd-refresh');
    if (btn) btn.disabled = true;

    try {
      var res = await fetch('/api/admin?action=role-dashboard&role=' + encodeURIComponent(opts.role), {
        headers: { Authorization: 'Bearer ' + token },
      });
      var payload = await res.json().catch(function () { return {}; });

      if (res.status === 401) { signOut(); return; }
      if (res.status === 403) {
        tools(null, opts);
        var link = payload.dashboardPath ? '<a class="rd-btn" href="' + esc(payload.dashboardPath) + '">Go to my dashboard</a> ' : '';
        showProblem('This dashboard isn’t yours', payload.error || 'You don’t have access to this role’s dashboard.', link + '<a class="rd-btn" href="' + ADMIN_PANEL_URL + '">Admin panel</a>');
        return;
      }
      if (!res.ok) { showProblem('Couldn’t load the dashboard', payload.error || 'Request failed (' + res.status + ').', '<button class="rd-btn" id="rd-retry" type="button">Try again</button>'); tools(null, opts); var r = document.getElementById('rd-retry'); if (r) r.addEventListener('click', load); return; }

      document.title = payload.title + ' — Razariser';
      tools(payload, opts);

      var who = payload.viewer.isSuperAdmin
        ? 'Board of Directors preview'
        : 'Signed in as ' + payload.viewer.username;
      document.getElementById('rd-hero').innerHTML =
        '<h1>' + esc(payload.title) + '</h1>' +
        '<div class="who">' + esc(who) + ' · updated ' + esc(new Date(payload.generatedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })) + '</div>' +
        '<div class="rd-chips">' + (payload.departments || []).map(function (d) { return '<span class="rd-chip">' + esc(d) + '</span>'; }).join('') + '</div>';

      var body = opts.render(payload.data, payload);
      var missing = (payload.notBuilt || []).length
        ? section('Not built in Razariser yet', note('These parts of the ' + esc(opts.role) + ' seat don’t exist as modules yet, so there is nothing real to show for them: <strong>' + payload.notBuilt.map(esc).join(', ') + '</strong>.'))
        : '';
      document.getElementById('rd-body').innerHTML = body + missing;
      if (opts.after) opts.after(payload.data, payload);
    } catch (err) {
      tools(null, opts);
      showProblem('Couldn’t reach the server', 'Check your connection and try again.', '<button class="rd-btn" id="rd-retry" type="button">Try again</button>');
      var rb = document.getElementById('rd-retry'); if (rb) rb.addEventListener('click', load);
    } finally {
      var b = document.getElementById('rd-refresh'); if (b) b.disabled = false;
    }
  }

  // Save something through a role action, e.g. RD.call('save-product-cost', {...}).
  async function call(name, body) {
    var token = null;
    try { token = localStorage.getItem(TOKEN_KEY); } catch (e) { /* ignore */ }
    var url = '/api/admin?action=role-action&role=' + encodeURIComponent(current.role) +
      '&name=' + encodeURIComponent(name);
    var res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify(body || {}),
    });
    var json = await res.json().catch(function () { return {}; });
    if (!res.ok) throw new Error(json.error || 'Could not save (' + res.status + ').');
    return json.result;
  }

  function boot(opts) {
    current = opts;
    shell(opts);
    tools(null, opts);
    wireActions();
    load();
  }

  window.RD = {
    boot: boot, call: call, reload: function () { return load(); }, esc: esc, inr: inr, num: num, pct: pct, ago: ago, html: html,
    stat: stat, grid: grid, pill: pill, section: section, cols: cols, note: note, empty: empty, na: na,
    table: table, bars: bars, trend: trend, change: change, statusPill: statusPill, statusBars: statusBars, when: when,
    day: day, monthLabel: monthLabel, label: label, dueTag: dueTag, opts: opts, f: f, statusOpts: statusOpts,
    add: add, button: button, remove: remove, statusSelect: statusSelect, toast: toast,
  };
})();
