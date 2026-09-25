const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const script = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const setAdminSql = fs.readFileSync(path.join(__dirname, '..', 'supabase-set-admin.sql'), 'utf8');

/**
 * Harness for the "upload ditolak RLS karena login lokal" path: an app context
 * whose Supabase client can pretend to be any account (or none at all).
 */
function app({ user = null, signInError = null, queueResult = { ok: true } } = {}) {
  const data = new Map();
  const calls = { upload: 0, signIn: 0, signOut: 0 };
  const elements = new Map();
  const classes = () => {
    const set = new Set();
    return {
      add: (name) => set.add(name),
      remove: (name) => set.delete(name),
      contains: (name) => set.has(name),
      toggle: (name, force) => {
        const on = force === undefined ? !set.has(name) : Boolean(force);
        if (on) set.add(name); else set.delete(name);
        return on;
      }
    };
  };
  const elementFor = (selector) => {
    if (!elements.has(selector)) {
      elements.set(selector, {
        innerHTML: '', textContent: '', dataset: {}, value: '', open: false, disabled: false,
        classList: classes(),
        setAttribute() {}, removeAttribute() {}, addEventListener() {}, reset() {}
      });
    }
    return elements.get(selector);
  };
  const document = {
    querySelector: (selector) => elementFor(selector),
    querySelectorAll: () => [],
    addEventListener() {},
    contains: () => true,
    body: { classList: classes() }
  };
  const localStorage = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value)
  };
  const window = {
    OUTING_CONFIG: {
      SUPABASE_URL: 'https://ncylyddceptiukzzanlm.supabase.co',
      SUPABASE_ANON_KEY: 'anon-key'
    },
    OUTING_SYNC: {
      canAutoSync: () => false,
      markLocalChanges: () => {},
      queue: async () => { calls.upload++; return queueResult; },
      client: {
        auth: {
          signInWithPassword: async () => {
            calls.signIn++;
            if (signInError) return { data: null, error: signInError };
            return { data: user ? { user } : null, error: user ? null : { message: 'Invalid login credentials' } };
          },
          signOut: async () => { calls.signOut++; return {}; }
        }
      }
    },
    crypto: { randomUUID: () => '00000000-0000-4000-8000-000000000001' }
  };
  window.document = document;
  const context = vm.createContext({ window, document, localStorage, console, setTimeout, clearTimeout });
  vm.runInContext(script, context);
  return { context, calls, data, elements, el: elementFor };
}

const ADMIN_USER = { email: 'ketua@outing.id', app_metadata: { role: 'admin' } };
const PLAIN_USER = { email: 'anggota@outing.id', app_metadata: {} };

test('a local login opens the admin setup panel instead of sending doomed writes', () => {
  const { context, calls, elements, el } = app();
  vm.runInContext('session = { role: "admin", name: "Administrator", local: true }', context);

  assert.equal(vm.runInContext('uploadPreflight()', context), 'needs-admin');
  assert.equal(calls.upload, 0, 'no table may be written while there is no Supabase session');

  const panel = elements.get('#dialog-fields').innerHTML;
  assert.match(panel, /permission denied/);
  assert.match(panel, /42501/);
  assert.match(panel, /id="admin-setup-email"/);
  assert.match(panel, /data-action="copy-admin-sql"/);
  assert.match(panel, /data-action="admin-login-upload"/);
  // Deep links must point at this project, not at the dashboard root.
  assert.match(panel, /supabase\.com\/dashboard\/project\/ncylyddceptiukzzanlm\/auth\/users/);
  assert.match(panel, /supabase\.com\/dashboard\/project\/ncylyddceptiukzzanlm\/sql\/new/);
});

test('a real Supabase admin session is allowed straight through', () => {
  const { context } = app();
  vm.runInContext('session = { role: "admin", name: "ketua@outing.id", local: false }', context);
  assert.equal(vm.runInContext('uploadPreflight()', context), 'ready');
});

test('members never reach the upload path', () => {
  const { context } = app();
  vm.runInContext('session = { role: "member", name: "Peserta", local: true }', context);
  assert.equal(vm.runInContext('uploadPreflight()', context), 'denied');
});

test('the generated SQL targets the typed email and matches supabase-set-admin.sql', () => {
  const { context } = app();
  context.__email = 'ketua@outing.id';
  const sql = vm.runInContext('adminSetupSql(__email)', context);

  // Every placeholder of the shipped file is filled in, nothing left to edit.
  assert.match(sql, /admin_email text := 'ketua@outing\.id';/);
  assert.match(sql, /values \('ketua@outing\.id'\)/);
  assert.doesNotMatch(sql, /GANTI EMAIL DI SINI|admin@domainanda\.com/);

  // Same statements the repo file runs, so the two cannot drift apart.
  for (const needle of [
    "set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)",
    '\'{"role":"admin"}\'::jsonb',
    'update auth.users',
    "p.policyname like 'admin write%'",
    "has_table_privilege('authenticated'::name"
  ]) {
    assert.match(setAdminSql, new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `supabase-set-admin.sql kehilangan: ${needle}`);
    assert.ok(sql.includes(needle), `SQL hasil generate kehilangan: ${needle}`);
  }

  // Every table the app writes must be part of the verification result.
  for (const table of ['participants', 'rundown', 'expenses', 'consumption', 'outing', 'outing_categories']) {
    assert.ok(sql.includes(`('${table}')`), `tabel ${table} tidak diverifikasi`);
  }
});

test('the SQL preview follows the email being typed', () => {
  const { context, elements, el } = app();
  vm.runInContext('openAdminSetupDialog()', context);
  el('#admin-setup-email').value = 'bendahara@outing.id';
  vm.runInContext('refreshAdminSqlPreview()', context);
  assert.match(elements.get('#admin-setup-sql').textContent, /bendahara@outing\.id/);
});

test('logging in with an admin account from the panel uploads immediately', async () => {
  const { context, calls, elements, el } = app({ user: ADMIN_USER });
  vm.runInContext('session = { role: "admin", name: "Administrator", local: true }', context);
  el('#admin-login-email').value = 'ketua@outing.id';
  el('#admin-login-password').value = 'rahasia';

  const result = await vm.runInContext('adminLoginAndUpload()', context);

  assert.equal(result.ok, true);
  assert.equal(calls.signIn, 1);
  assert.equal(calls.upload, 1, 'upload runs right after a successful admin login');
  assert.equal(vm.runInContext('session.local', context), false);
  assert.equal(vm.runInContext('session.name', context), 'ketua@outing.id');
  assert.equal(vm.runInContext('window.OUTING_LOCAL_LOGIN', context), false);
});

test('an account without the admin role is signed out and uploads nothing', async () => {
  const { context, calls, elements, el } = app({ user: PLAIN_USER });
  vm.runInContext('session = { role: "admin", name: "Administrator", local: true }', context);
  el('#admin-login-email').value = 'anggota@outing.id';
  el('#admin-login-password').value = 'rahasia';

  const result = await vm.runInContext('adminLoginAndUpload()', context);

  assert.equal(result.ok, false);
  assert.match(result.message, /app_metadata\.role/);
  assert.equal(calls.signOut, 1);
  assert.equal(calls.upload, 0);
  // Still the local login, so the panel keeps explaining the fix.
  assert.equal(vm.runInContext('session.local', context), true);
});

test('an unconfirmed email is reported as the reason, not as a wrong password', async () => {
  const { context, elements, el } = app({ signInError: { message: 'Email not confirmed' } });
  el('#admin-login-email').value = 'ketua@outing.id';
  el('#admin-login-password').value = 'rahasia';

  const result = await vm.runInContext('adminLoginAndUpload()', context);
  assert.match(result.message, /belum dikonfirmasi|Auto Confirm User/);
});

test('wrong credentials do not touch the tables', async () => {
  const { context, calls, elements, el } = app({ signInError: { message: 'Invalid login credentials' } });
  el('#admin-login-email').value = 'ketua@outing.id';
  el('#admin-login-password').value = 'salah';

  const result = await vm.runInContext('adminLoginAndUpload()', context);
  assert.equal(result.ok, false);
  assert.equal(calls.upload, 0);
});

test('the upload report points at the panel when the login cannot write', () => {
  const { context } = app();
  const report = {
    at: '2026-09-25T16:20:20.000Z',
    ok: false,
    blockedMessage: '',
    session: { active: false, email: '', role: '' },
    tables: [
      { table: 'participants', ok: false, status: 'ditolak', sent: 3, deleted: 0, skipped: false, code: '42501', detail: 'ditolak RLS/policy: permission denied for table participants', hint: 'Login dengan email & password admin Supabase.' }
    ],
    failedTables: ['participants'],
    skippedTables: [],
    sentTables: [],
    counts: { failed: 1, skipped: 0, sent: 0 }
  };
  context.__report = report;
  const html = vm.runInContext('renderUploadReport(__report)', context);
  assert.match(html, /data-action="open-admin-setup"/);
  assert.match(html, /app_metadata\.role/);
});
