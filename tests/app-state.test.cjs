const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const script = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

function app() {
  const data = new Map();
  const calls = { synced: false, upload: 0, pending: 0 };
  const baseWindow = {
    OUTING_SYNC: {
      canAutoSync: () => calls.synced,
      markLocalChanges: () => { calls.pending++; },
      queue: async () => { calls.upload++; return { ok: true }; }
    },
    OUTING_CONFIG: {}, crypto: { randomUUID: () => '00000000-0000-4000-8000-000000000001' }
  };
  // Minimal DOM stub: every selector gets a persistent element so renderers and
  // dialogs can be inspected from the tests.
  const elements = new Map();
  const elementFor = (selector) => {
    if (!elements.has(selector)) {
      const classes = new Set();
      elements.set(selector, {
        innerHTML: '', textContent: '', dataset: {}, value: '', open: false,
        classList: {
          add: (name) => classes.add(name),
          remove: (name) => classes.delete(name),
          contains: (name) => classes.has(name),
          toggle: (name, force) => {
            const on = force === undefined ? !classes.has(name) : Boolean(force);
            if (on) classes.add(name); else classes.delete(name);
            return on;
          }
        },
        setAttribute() {}, removeAttribute() {}, addEventListener() {}, reset() {}
      });
    }
    return elements.get(selector);
  };
  const document = {
    querySelector: (selector) => elementFor(selector),
    querySelectorAll: () => [],
    addEventListener() {}
  };
  const localStorage = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value)
  };
  const window = { ...baseWindow, document };
  const context = vm.createContext({ window, document, localStorage, console, setTimeout, clearTimeout });
  vm.runInContext(script, context);
  return { context, calls, data, elements };
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

test('dashboard shows the complete participant list, not only the first few', () => {
  const { context } = app();
  vm.runInContext(`
    db.participants = Array.from({ length: 14 }, (_, index) => ({
      id: 'p' + index, name: 'Peserta ' + (index + 1), phone: '08123' + index, status: 'Ikut', payment: 'Belum bayar'
    }));
  `, context);
  const html = vm.runInContext('renderDashboard()', context);
  const rows = (html.match(/data-label="Nama"/g) || []).length;
  assert.equal(rows, 14);
  assert.match(html, /Peserta 14/);
  // Cost recap with links to the detail pages every login can read.
  assert.match(html, /data-action="go-expenses"/);
  assert.match(html, /data-action="go-consumption"/);
});

test('members can read expenses/consumption detail including the receipt photo', () => {
  const { context, elements } = app();
  vm.runInContext(`
    session = { role: 'member', name: 'Peserta', local: true };
    db.expenses = [{ id: 'e1', date: '2026-09-20', item: 'Tenda', category: 'Perlengkapan', amount: 250000, photo: 'data:image/jpeg;base64,AAAA' }];
    db.consumption = [{ id: 'c1', date: '2026-09-21', item: 'Katering', category: 'Makanan', amount: 150000, photo: '' }];
  `, context);

  // Cost pages stay reachable for members (not admin-only anymore).
  assert.equal(vm.runInContext('ADMIN_PAGES.includes("expenses") || ADMIN_PAGES.includes("consumption")', context), false);

  const html = vm.runInContext('renderLedger("expenses", "Pembelian barang", "Rincian")', context);
  assert.match(html, /data-receipt="expenses"/);
  assert.match(html, /data:image\/jpeg;base64,AAAA/);
  assert.doesNotMatch(html, /data-add="expenses"/); // no admin buttons for members

  vm.runInContext('openItemDetailDialog(db.expenses[0], { type: "expenses", index: 0 })', context);
  const detail = elements.get('#dialog-fields').innerHTML;
  assert.match(detail, /Rp\s*250\.000/);
  assert.match(detail, /data-action="receipt-next"/);
  assert.equal(elements.get('#dialog-title').textContent, 'Rincian pembelian barang');
  assert.equal(elements.get('#dialog-save').classList.contains('hidden'), true);

  // Row without a photo must not produce a broken thumbnail.
  const consumption = vm.runInContext('renderLedger("consumption", "Konsumsi", "Rincian")', context);
  assert.match(consumption, /Tanpa foto/);
  assert.doesNotMatch(consumption, /data-receipt="consumption"/);
});
