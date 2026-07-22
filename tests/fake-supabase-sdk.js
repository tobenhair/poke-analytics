// ============================================================
// Fake Supabase SDK for the signed-in e2e tests
// ============================================================
// Served by Playwright (tests/signed-in.spec.mjs) in place of the real CDN
// SDK, so the signed-in surface — auth wiring, the snapshot pivot, UI gating,
// auto-save payloads, the error beacon — can be exercised in CI with no cloud
// credentials and fully deterministic data.
//
// It implements ONLY the API surface index.html actually uses (audited from
// the sbClient call sites) over in-memory fixtures:
//   auth: onAuthStateChange (INITIAL_SESSION semantics), signInWithPassword,
//         signUp, signOut, updateUser
//   from(table): select('*') [.order()] [.maybeSingle()]
//                insert(row) [.select('id').single()]
//                update(row).eq(...)
//                upsert(rowOrRows, { onConflict })
//                delete().eq(...).eq(...)
// Read scoping mirrors the RLS *shape* (not its security): anonymous reads of
// products/snapshots return only the 3-newest-releases demo subset; per-user
// tables return only the signed-in user's rows. Every write is appended to
// window.__sbWrites so the spec can assert on exact payloads.
//
// Honest limit: this proves the client's behaviour, not the real RLS policies
// in supabase/schema.sql — those are enforced server-side and stay guarded by
// schema review.
//
// This is a plain (non-module) script: the app injects it via a <script src>
// tag exactly like the real SDK, and it must define window.supabase.
(function () {
  'use strict';

  // ── Test users ──
  // The admin's id is read from the page's own SUPABASE_CONFIG.adminUserId so
  // the app's real is-admin gating logic makes the decision.
  var ADMIN_EMAIL = 'admin@test.local';
  var USER_EMAIL = 'user@test.local';
  var PASSWORD = 'test-password';
  var USER_ID = 'user-2222-2222-2222';

  // ── Fixtures ──
  // Four products across four distinct releases, so the demo subset (3 newest
  // releases) excludes exactly one: "Alpha Booster Box".
  var products = [
    { id: 'p1', name: 'Alpha Booster Box', type: 'BOX', release: '2019-06-01', cardmarket_url: null },
    { id: 'p2', name: 'Beta Booster Box', type: 'BOX', release: '2025-03-01', cardmarket_url: null },
    { id: 'p3', name: 'Gamma ETB', type: 'ETB', release: '2025-11-01', cardmarket_url: null },
    { id: 'p4', name: 'Delta Booster Bundle', type: 'BUNDLE', release: '2026-02-01', cardmarket_url: null },
  ];
  var snapshots = [];
  var dates = ['2026-05-20', '2026-06-20', '2026-07-15'];
  var series = {
    p1: { price: [900, 920, 950], sv: [3000, 3050, 3100] },
    p2: { price: [200, 190, 180], sv: [800, 810, 820] },
    p3: { price: [90, 85, 80], sv: [700, 705, 710] },
    p4: { price: [60, 62, 58], sv: [700, 705, 710] },
  };
  Object.keys(series).forEach(function (pid) {
    dates.forEach(function (d, i) {
      snapshots.push({
        id: pid + '-s' + i, product_id: pid, snapshot_date: d,
        price: series[pid].price[i], set_value: series[pid].sv[i],
      });
    });
  });
  // The regular user already holds Beta and watches Gamma with a fixed alert
  // that is triggered at the latest price (80 ≤ 100 → the board 🔔).
  var user_settings = [{ user_id: USER_ID, age_threshold: 1, currency: 'EUR' }];
  var holdings = [{ id: 'h1', user_id: USER_ID, product_id: 'p2', quantity: 2, cost_basis: 150 }];
  var alerts = [{ id: 'a1', user_id: USER_ID, product_id: 'p3', alert_type: 'fixed', target_price: 100, below_pct: null }];
  var client_errors = [];
  var tables = {
    products: products, snapshots: snapshots, user_settings: user_settings,
    holdings: holdings, alerts: alerts, client_errors: client_errors,
  };
  var idSeq = 1;

  // The spec asserts on this write log.
  window.__sbWrites = [];

  function createClient() {
    var session = null;
    var listeners = [];
    var cfg = window.SUPABASE_CONFIG || {};
    var users = {};
    users[ADMIN_EMAIL] = { id: cfg.adminUserId || 'admin-0000', email: ADMIN_EMAIL };
    users[USER_EMAIL] = { id: USER_ID, email: USER_EMAIL };

    function emit(event) {
      listeners.forEach(function (cb) { cb(event, session); });
    }

    // Anonymous product/snapshot reads see only the 3 newest distinct
    // releases — the demo scope (mirrors public.demo_product_ids()).
    function demoProductIds() {
      var releases = products.map(function (p) { return p.release; })
        .filter(function (v, i, a) { return a.indexOf(v) === i; })
        .sort().reverse().slice(0, 3);
      return products.filter(function (p) { return releases.indexOf(p.release) !== -1; })
        .map(function (p) { return p.id; });
    }

    function readRows(table) {
      var rows = tables[table] || [];
      if (table === 'products') {
        if (session) return rows.slice();
        var ids = demoProductIds();
        return rows.filter(function (p) { return ids.indexOf(p.id) !== -1; });
      }
      if (table === 'snapshots') {
        if (session) return rows.slice();
        var demoIds = demoProductIds();
        return rows.filter(function (s) { return demoIds.indexOf(s.product_id) !== -1; });
      }
      // Per-user tables: only the signed-in user's rows.
      if (!session) return [];
      return rows.filter(function (r) { return r.user_id === session.user.id; });
    }

    function matches(row, filters) {
      return filters.every(function (f) { return row[f[0]] === f[1]; });
    }

    function log(table, op, payload) {
      window.__sbWrites.push({ table: table, op: op, payload: JSON.parse(JSON.stringify(payload)) });
    }

    function withDefaults(table, row) {
      var out = Object.assign({}, row);
      if (out.id == null && table !== 'user_settings') out.id = table + '-' + (idSeq++);
      if (out.user_id == null && session && table !== 'products' && table !== 'snapshots') out.user_id = session.user.id;
      return out;
    }

    function upsertOne(table, row, conflictCols) {
      var rows = tables[table];
      var full = withDefaults(table, row);
      var hit = rows.find(function (r) {
        return conflictCols.every(function (c) { return r[c] === full[c]; });
      });
      if (hit) Object.assign(hit, row);
      else rows.push(full);
    }

    function execute(q) {
      var table = q.table;
      if (q.op === 'select') {
        var rows = readRows(table).filter(function (r) { return matches(r, q.filters); });
        if (q.orderBy) {
          rows.sort(function (a, b) {
            var va = a[q.orderBy.col], vb = b[q.orderBy.col];
            var cmp = va < vb ? -1 : va > vb ? 1 : 0;
            return q.orderBy.ascending === false ? -cmp : cmp;
          });
        }
        if (q.single) return { data: rows[0] || null, error: null };
        return { data: rows, error: null };
      }
      if (q.op === 'insert') {
        var inserted = [].concat(q.payload).map(function (row) {
          var full = withDefaults(table, row);
          tables[table].push(full);
          return full;
        });
        log(table, 'insert', q.payload);
        if (q.single) return { data: inserted[0], error: null };
        return { data: inserted, error: null };
      }
      if (q.op === 'update') {
        tables[table].forEach(function (r) {
          if (matches(r, q.filters)) Object.assign(r, q.payload);
        });
        log(table, 'update', q.payload);
        return { data: null, error: null };
      }
      if (q.op === 'upsert') {
        // Default conflict targets mirror the real tables' unique keys.
        var conflict = (q.opts && q.opts.onConflict) ||
          (table === 'user_settings' ? 'user_id' : 'id');
        var cols = conflict.split(',').map(function (s) { return s.trim(); });
        [].concat(q.payload).forEach(function (row) { upsertOne(table, row, cols); });
        log(table, 'upsert', q.payload);
        return { data: null, error: null };
      }
      if (q.op === 'delete') {
        tables[table] = tables[table].filter(function (r) { return !matches(r, q.filters); });
        log(table, 'delete', q.filters);
        return { data: null, error: null };
      }
      return { data: null, error: { message: 'fake-supabase: unsupported op ' + q.op } };
    }

    function from(table) {
      var q = { table: table, op: 'select', filters: [], single: null, orderBy: null, payload: null, opts: null };
      var api = {
        select: function () { return api; }, // column list is irrelevant to the fixtures
        order: function (col, opts) { q.orderBy = { col: col, ascending: !opts || opts.ascending !== false }; return api; },
        maybeSingle: function () { q.single = true; return api; },
        single: function () { q.single = true; return api; },
        insert: function (payload) { q.op = 'insert'; q.payload = payload; return api; },
        update: function (payload) { q.op = 'update'; q.payload = payload; return api; },
        upsert: function (payload, opts) { q.op = 'upsert'; q.payload = payload; q.opts = opts; return api; },
        delete: function () { q.op = 'delete'; return api; },
        eq: function (col, val) { q.filters.push([col, val]); return api; },
        then: function (resolve, reject) { return Promise.resolve().then(function () { return execute(q); }).then(resolve, reject); },
      };
      return api;
    }

    var auth = {
      onAuthStateChange: function (cb) {
        listeners.push(cb);
        // The real SDK fires INITIAL_SESSION asynchronously on startup; the
        // app's boot relies on that to drive the first (demo) load.
        Promise.resolve().then(function () { cb('INITIAL_SESSION', session); });
        return { data: { subscription: { unsubscribe: function () {} } } };
      },
      signInWithPassword: function (creds) {
        var u = users[creds.email];
        if (!u || creds.password !== PASSWORD) {
          return Promise.resolve({ data: {}, error: { message: 'Invalid login credentials' } });
        }
        session = { user: u };
        emit('SIGNED_IN');
        return Promise.resolve({ data: { session: session }, error: null });
      },
      signUp: function () {
        return Promise.resolve({ data: {}, error: { message: 'Sign-ups are disabled in tests' } });
      },
      signOut: function () {
        session = null;
        emit('SIGNED_OUT');
        return Promise.resolve({ error: null });
      },
      updateUser: function () {
        return Promise.resolve({ data: { user: session && session.user }, error: null });
      },
    };

    return { auth: auth, from: from };
  }

  window.supabase = { createClient: createClient };
})();
