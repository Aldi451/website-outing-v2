const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const script = fs.readFileSync(path.join(__dirname, '..', 'supabase-sync.js'), 'utf8');
const columns = {
  participants: 'id,name,phone,status,payment,created_at',
  rundown: 'id,schedule_time,activity,location,pic,notes,created_at',
  expenses: 'id,date,item,category,amount,photo_url,created_at',
  consumption: 'id,date,item,category,amount,photo_url,created_at',
  outing_categories: 'name,created_at',
  outing: 'id,destination,outing_date,description,created_at'
};
const names = Object.keys(columns);
const localData = {
  participants: [{ id: 'p1', name: 'Peserta Lokal', phone: '08123', status: 'Ikut', payment: 'Belum bayar' }],
  rundown: [], expenses: [], consumption: [], categories: [],
  outing: { destination: 'Bandung', date: '2026-10-18', description: '' }
};

function setup({ local, syncState, schemas = {}, session = null } = {}) {
  const store = new Map();
  if (local) store.set('outing-hub-v1', JSON.stringify(local));
  if (syncState) store.set('outing-hub-v1-sync-state', syncState);
  const calls = [];
  const events = [];
  const db = Object.fromEntries(names.map((name) => [name, {
    columns: columns[name].split(','), rows: [], ...schemas[name]
  }]));
  const state = { session };
  const error = (code, message) => ({ code, message });
  const denied = () => error('42501', 'new row violates row-level security policy');
  const canWrite = () => state.session?.user?.app_metadata?.role === 'admin';

  class Query {
    constructor(table) { this.table = table; this.operation = ''; this.fields = ''; this.options = {}; this.orderBy = ''; this.ids = []; }
    select(fields, options = {}) { this.operation = 'select'; this.fields = fields; this.options = options; return this; }
    order(field) { this.orderBy = field; return this; }
    limit(number) { this.limitBy = number; return this; }
    delete() { this.operation = 'delete'; return this; }
    in(column, ids) { this.idColumn = column; this.ids = ids; return this; }
    upsert(rows, { onConflict }) {
      calls.push({ operation: 'upsert', table: this.table, rows });
      const entry = db[this.table];
      if (!entry?.columns) return Promise.resolve({ error: error('PGRST205', `Could not find the table 'public.${this.table}' in the schema cache`) });
      const missing = Object.keys(rows[0]).find((field) => !entry.columns.includes(field));
      if (missing) return Promise.resolve({ error: error('PGRST204', `Could not find the '${missing}' column of '${this.table}' in the schema cache`) });
      if (!canWrite()) return Promise.resolve({ error: denied() });
      rows.forEach((row) => {
        const index = entry.rows.findIndex((current) => current[onConflict] === row[onConflict]);
        if (index < 0) entry.rows.push({ ...row });
        else entry.rows[index] = { ...entry.rows[index], ...row };
      });
      return Promise.resolve({ error: null });
    }
    async execute() {
      calls.push({ operation: this.operation, table: this.table, fields: this.fields, options: this.options });
      const entry = db[this.table];
      if (!entry?.columns) return { error: error('PGRST205', `Could not find the table 'public.${this.table}' in the schema cache`) };
      if (entry.waitRead && this.operation === 'select') await entry.waitRead;
      if (this.operation === 'delete') {
        if (!canWrite()) return { error: denied() };
        entry.rows = entry.rows.filter((row) => !this.ids.includes(row[this.idColumn]));
        return { error: null };
      }
      const missing = this.fields === '*' ? this.orderBy && !entry.columns.includes(this.orderBy) ? this.orderBy : ''
        : this.fields.split(',').find((field) => !entry.columns.includes(field));
      if (missing) return { error: error('PGRST204', `Could not find the '${missing}' column of '${this.table}' in the schema cache`) };
      let rows = entry.rows;
      if (this.limitBy !== undefined) rows = rows.slice(0, this.limitBy);
      return { data: this.options.head ? null : rows, count: this.options.count === 'exact' ? entry.rows.length : null, error: null };
    }
    then(resolve, reject) { return this.execute().then(resolve, reject); }
  }

  const client = {
    from: (table) => new Query(table),
    auth: {
      getSession: async () => ({ data: { session: state.session } }),
      signOut: async () => { state.session = null; return { error: null }; }
    }
  };
  const status = { dataset: {}, textContent: '', title: '' };
  const window = {
    OUTING_CONFIG: { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_ANON_KEY: 'public-key' },
    supabase: { createClient: () => client }, crypto: webcrypto
  };
  const context = {
    window,
    localStorage: {
      getItem: (key) => store.get(key) ?? null,
      setItem: (key, value) => store.set(key, value)
    },
    document: {
      querySelector: () => status,
      dispatchEvent: (event) => events.push(event.type)
    },
    CustomEvent: class { constructor(type) { this.type = type; } },
    console: { warn() {}, error() {} },
    setTimeout
  };
  vm.runInNewContext(script, context);
  return { window, store, calls, events, db, state, status };
}

const adminSession = { user: { email: 'admin@example.com', app_metadata: { role: 'admin' } } };

test('diagnosis is read-only and distinguishes missing column from missing table', async () => {
  const { window, calls } = setup({
    local: localData,
    schemas: {
      participants: { columns: columns.participants.split(',').filter((field) => field !== 'name') },
      rundown: { columns: null },
      outing_categories: { columns: null }
    }
  });
  await window.OUTING_SYNC_READY;
  const report = await window.OUTING_SYNC.diagnose(localData);
  assert.equal(report.problems.length, 3);
  assert.match(report.tables[0].readDetail, /kolom belum dibuat.*name/);
  assert.match(report.tables[1].readDetail, /tabel belum dibuat.*rundown/);
  assert.equal(report.tables[2].write, 'belum diuji');
  assert.equal(report.tables[2].remoteRows, 0);
  assert.ok(calls.filter(({ operation }) => operation === 'select').some(({ options }) => options.head === true));
  assert.equal(calls.filter(({ operation }) => operation === 'upsert' || operation === 'delete').length, 0);
});

test('empty remote never auto-uploads demo or unsynced local data', async () => {
  const { window, store, calls, state } = setup({ local: localData });
  await window.OUTING_SYNC_READY;
  assert.equal(store.get('outing-hub-v1'), JSON.stringify(localData));
  assert.equal(store.get('outing-hub-v1-sync-state'), undefined);
  assert.equal(calls.filter(({ operation }) => operation === 'upsert' || operation === 'delete').length, 0);
  const blocked = await window.OUTING_SYNC.queue(localData);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.localOnlyLogin, true);
  assert.equal(blocked.schemaFailures.length, 0);
  assert.equal(blocked.rlsFailures.includes('participants'), true);
  assert.equal(store.get('outing-hub-v1'), JSON.stringify(localData));

  state.session = adminSession;
  const uploaded = await window.OUTING_SYNC.queue(localData);
  assert.equal(uploaded.ok, true);
  assert.equal(store.get('outing-hub-v1-sync-state'), 'synced');
  assert.match(JSON.parse(store.get('outing-hub-v1')).participants[0].id, /^[0-9a-f]{8}-[0-9a-f]{4}-4/);
});

test('partial remote never overwrites older local data; explicit load replaces it', async () => {
  const { window, store, calls } = setup({
    local: { ...localData, categories: ['Custom'] },
    schemas: { expenses: { rows: [{ id: 'remote-1', item: 'Dari Supabase', date: '2026-10-05' }] } }
  });
  await window.OUTING_SYNC_READY;
  assert.equal(JSON.parse(store.get('outing-hub-v1')).participants[0].name, 'Peserta Lokal');
  assert.equal(JSON.parse(store.get('outing-hub-v1')).categories[0], 'Custom');
  const forced = await window.OUTING_SYNC.load({ replaceLocal: true });
  assert.equal(forced.loaded, true);
  assert.equal(JSON.parse(store.get('outing-hub-v1')).participants.length, 0);
  assert.equal(JSON.parse(store.get('outing-hub-v1')).categories.length, 0);
  assert.equal(JSON.parse(store.get('outing-hub-v1')).expenses[0].item, 'Dari Supabase');
  assert.equal(store.get('outing-hub-v1-sync-state'), 'synced');
  assert.equal(calls.filter(({ operation }) => operation === 'upsert' || operation === 'delete').length, 0);
});

test('a fresh browser reads remote; later unsynced edits are not overwritten', async () => {
  const { window, store } = setup({
    schemas: { participants: { rows: [{ id: 'remote-id', name: 'Online', phone: '08123' }] } }
  });
  await window.OUTING_SYNC_READY;
  assert.equal(JSON.parse(store.get('outing-hub-v1')).participants[0].name, 'Online');
  window.OUTING_SYNC.markLocalChanges();
  store.set('outing-hub-v1', JSON.stringify(localData));
  const result = await window.OUTING_SYNC.load();
  assert.equal(result.preservedLocal, true);
  assert.equal(JSON.parse(store.get('outing-hub-v1')).participants[0].name, 'Peserta Lokal');
});

test('editing locally during a slow remote read never loses the new edit', async () => {
  let release;
  const waitRead = new Promise((resolve) => { release = resolve; });
  const { window, store } = setup({
    local: localData, syncState: 'synced',
    schemas: { participants: { rows: [{ id: 'remote', name: 'Online' }], waitRead } }
  });
  window.OUTING_SYNC.markLocalChanges();
  const edited = { ...localData, participants: [{ ...localData.participants[0], name: 'Baru diedit' }] };
  store.set('outing-hub-v1', JSON.stringify(edited));
  release();
  const result = await window.OUTING_SYNC_READY;
  assert.equal(result.preservedLocal, true);
  assert.equal(JSON.parse(store.get('outing-hub-v1')).participants[0].name, 'Baru diedit');
});

test('automatic writes require a successful read/upload, not just a marker from another visit', async () => {
  const { window, store, state } = setup({ local: localData, syncState: 'synced' });
  await window.OUTING_SYNC_READY; // remote is now empty; previously synced local data must not auto-upload
  assert.equal(window.OUTING_SYNC.canAutoSync(), false);
  state.session = adminSession;
  await window.OUTING_SYNC.queue(localData); // deliberate first upload
  assert.equal(window.OUTING_SYNC.canAutoSync(), true);
  window.OUTING_LOCAL_LOGIN = true;
  assert.equal(window.OUTING_SYNC.canAutoSync(), false);
  window.OUTING_LOCAL_LOGIN = false;
  window.OUTING_SYNC.markLocalChanges();
  assert.equal(store.get('outing-hub-v1-sync-state'), 'pending');
  assert.equal(window.OUTING_SYNC.canAutoSync(), false);
});

test('a local login cannot reuse an active Supabase admin session for writes', async () => {
  const { window, calls } = setup({ local: localData, session: adminSession });
  await window.OUTING_SYNC_READY;
  window.OUTING_LOCAL_LOGIN = true; // e.g. signing out fails while offline
  const result = await window.OUTING_SYNC.queue(localData);
  assert.equal(result.ok, false);
  assert.match(result.hint, /Session Supabase lama masih aktif/);
  assert.equal(calls.filter(({ operation }) => operation === 'upsert' || operation === 'delete').length, 0);
});
