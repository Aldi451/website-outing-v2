const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const script = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

function app() {
  const data = new Map();
  const calls = { synced: false, upload: 0, pending: 0 };
  const window = {
    OUTING_SYNC: {
      canAutoSync: () => calls.synced,
      markLocalChanges: () => { calls.pending++; },
      queue: async () => { calls.upload++; return { ok: true }; }
    },
    OUTING_CONFIG: {}, crypto: { randomUUID: () => '00000000-0000-4000-8000-000000000001' }
  };
  const document = {
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {}
  };
  const localStorage = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value)
  };
  const context = vm.createContext({ window, document, localStorage, console, setTimeout, clearTimeout });
  vm.runInContext(script, context);
  return { context, calls, data };
}

test('editing preexisting local rows cannot silently delete different server rows', async () => {
  const { context, calls, data } = app();
  vm.runInContext('db.participants[0].name = "Berubah di browser"', context);
  const result = await vm.runInContext('saveDb()', context);
  assert.equal(result.pendingUpload, true);
  assert.equal(calls.upload, 0);
  assert.equal(calls.pending, 1);
  assert.equal(JSON.parse(data.get('outing-hub-v1')).participants[0].name, 'Berubah di browser');

  // After a successful explicit upload, later edits may auto-sync.
  calls.synced = true;
  const next = await vm.runInContext('saveDb()', context);
  assert.equal(next.ok, true);
  assert.equal(calls.upload, 1);
});

test('an empty category list loaded from Supabase stays empty, not demo categories', () => {
  const { context } = app();
  assert.equal(vm.runInContext('normaliseDatabase({ categories: [] }).categories.length', context), 0);
  assert.equal(vm.runInContext('normaliseDatabase({}).categories.length', context), 6);
});

test('upload report UI names every table, the skipped ones, and the login state', () => {
  const { context } = app();
  const report = {
    at: '2026-09-25T05:00:00.000Z',
    ok: false,
    blockedReason: '',
    blockedMessage: '',
    session: { active: false, email: '', role: '' },
    tables: [
      { table: 'participants', ok: false, status: 'ditolak', sent: 3, deleted: 0, skipped: false, code: '42501', detail: 'ditolak RLS/policy: new row violates row-level security policy', hint: 'Login dengan email & password admin Supabase.' },
      { table: 'rundown', ok: true, status: 'dilewati', sent: 0, deleted: 0, skipped: true, code: '', detail: 'Kosong di browser ini, jadi tidak dikirim.', hint: '' }
    ],
    failedTables: ['participants'],
    skippedTables: ['rundown'],
    sentTables: [],
    counts: { failed: 1, skipped: 1, sent: 0 }
  };
  context.__report = report;
  const html = vm.runInContext('renderUploadReport(__report)', context);
  assert.match(html, /Upload ditolak pada 1 tabel: participants/);
  assert.match(html, /ditolak<\/span>/);
  assert.match(html, /rundown/);
  assert.match(html, /dilewati<\/span>/);
  assert.match(html, /Tidak ada session Supabase/);
  assert.match(html, /app_metadata\.role/);

  const text = vm.runInContext('uploadReportText(__report)', context);
  assert.match(text, /- rundown: DILEWATI/);
  assert.match(text, /Login: tanpa session Supabase/);

  assert.match(vm.runInContext('renderUploadReport(null)', context), /Belum ada percobaan upload/);
});

test('the upload confirmation lists the tables that will be sent and the empty ones', () => {
  const { context } = app();
  vm.runInContext('db.rundown = []; db.consumption = []', context);
  const plan = vm.runInContext('uploadPlanText()', context);
  assert.match(plan, /Akan dikirim: .*participants/);
  assert.match(plan, /Dilewati karena kosong: rundown, consumption/);
});
