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
