/* Supabase synchronization layer for the static app.
 *
 * Designed to work with a real Supabase project and to explain *why* a write
 * failed instead of silently keeping everything in the browser:
 * - waits for the Supabase CDN library instead of giving up immediately
 * - syncs every table independently, so one broken table does not block the rest
 * - normalises dates/amounts before upsert (NOT NULL and invalid date are the
 *   most common causes of "data only saved locally")
 * - maps RLS / missing table / legacy column errors to an actionable hint
 * - keeps diagnosis read-only: only the explicit Upload button writes a snapshot
 * - preserves unsynced local data instead of overwriting it on remote load
 * - exposes diagnose() for the "Cek Supabase" button in the UI
 */
(() => {
  const config = window.OUTING_CONFIG || {};
  const storageKey = 'outing-hub-v1';
  const syncStateKey = `${storageKey}-sync-state`;
  const categoriesTable = 'outing_categories';
  const TABLES = ['participants', 'rundown', 'expenses', 'consumption', categoriesTable, 'outing'];
  const READ_COLUMNS = {
    participants: 'id,name,phone,status,payment,created_at',
    rundown: 'id,schedule_time,activity,location,pic,notes',
    expenses: 'id,date,item,category,amount,photo_url',
    consumption: 'id,date,item,category,amount,photo_url',
    [categoriesTable]: 'name',
    outing: 'id,destination,outing_date,description,created_at'
  };
  const LIBRARY_WAIT_MS = 15000;

  const statusEl = () => document.querySelector('#connection-status');
  const setStatus = (text, tone = '') => {
    const status = statusEl();
    if (!status) return;
    status.textContent = text;
    status.dataset.tone = tone;
    status.title = window.OUTING_SYNC_STATUS_TEXT || '';
  };

  const readLocal = () => {
    try { return JSON.parse(localStorage.getItem(storageKey) || '{}'); } catch { return {}; }
  };
  let remoteReadReady = false;

  // Old browsers with existing localStorage but no marker are treated as
  // unsynced. Never silently replace that data on first load after an upgrade.
  const hasLocalChanges = () => localStorage.getItem(storageKey) !== null && localStorage.getItem(syncStateKey) !== 'synced';
  const canAutoSync = () => remoteReadReady && !window.OUTING_LOCAL_LOGIN && localStorage.getItem(storageKey) !== null && localStorage.getItem(syncStateKey) === 'synced';
  const markLocalChanges = () => {
    remoteReadReady = false;
    localStorage.setItem(syncStateKey, 'pending');
    window.OUTING_SYNC_STATUS_TEXT = 'Data tersimpan di browser; belum terkonfirmasi di Supabase. Gunakan Upload setelah memeriksa isinya.';
    setStatus('⚠ Data lokal belum terunggah', 'error');
  };
  const markSynced = () => localStorage.setItem(syncStateKey, 'synced');

  if (!config.SUPABASE_URL || !config.SUPABASE_ANON_KEY) {
    setStatus('Local mode');
    window.OUTING_SYNC_STATUS = { configured: false, libraryLoaded: false, ready: false };
    return;
  }

  let client = null;
  let activeSync = null;
  let pendingSnapshot = null;
  let loadRequest = 0;

  // ---------------------------------------------------------------- utilities
  const isUuid = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value || '');
  const makeId = (value) => {
    if (isUuid(value)) return value;
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
      const random = Math.random() * 16 | 0;
      const result = character === 'x' ? random : (random & 0x3 | 0x8);
      return result.toString(16);
    });
  };

  const text = (value) => String(value ?? '').trim();
  const todayIso = () => new Date().toISOString().slice(0, 10);

  const MONTHS = {
    jan: 1, januari: 1, january: 1, feb: 2, februari: 2, february: 2, mar: 3, maret: 3, march: 3,
    apr: 4, april: 4, mei: 5, may: 5, jun: 6, juni: 6, june: 6, jul: 7, juli: 7, july: 7,
    agu: 8, agt: 8, agustus: 8, aug: 8, august: 8, sep: 9, sept: 9, september: 9, okt: 10,
    oktober: 10, oct: 10, october: 10, nov: 11, november: 11, des: 12, desember: 12, dec: 12, december: 12
  };

  const pad = (value) => String(value).padStart(2, '0');
  const isoFromParts = (year, month, day) => {
    const y = Number(year);
    const m = Number(month);
    const d = Number(day);
    if (!y || !m || !d || m > 12 || d > 31) return '';
    const date = new Date(Date.UTC(y, m - 1, d));
    if (Number.isNaN(date.getTime())) return '';
    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
  };

  /**
   * Accepts what spreadsheets and <input type="date"> actually produce:
   * Date objects, Excel serial numbers, ISO strings, dd/mm/yyyy, and
   * "5 Mei 2026" / "5 May 2026". Returns "" when nothing usable is found.
   */
  function toIsoDate(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
    if (typeof value === 'number' && Number.isFinite(value)) {
      // Excel serial date (day 1 = 1900-01-01, with the usual leap-year bug).
      const excelEpoch = Date.UTC(1899, 11, 30);
      return new Date(excelEpoch + Math.round(value) * 86400000).toISOString().slice(0, 10);
    }
    const raw = text(value);
    if (!raw) return '';
    if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);

    const numeric = raw.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
    if (numeric) {
      const [, first, second, year] = numeric;
      const fullYear = year.length === 2 ? `20${year}` : year;
      // Indonesian users write dd/mm/yyyy; fall back to mm/dd/yyyy when impossible.
      const dayFirst = isoFromParts(fullYear, second, first);
      const monthFirst = isoFromParts(fullYear, first, second);
      return dayFirst || monthFirst;
    }

    const named = raw.toLowerCase().match(/^(\d{1,2})[\s-]*([a-z]{3,9})[\s,-]*(\d{4})$/);
    if (named && MONTHS[named[2]]) return isoFromParts(named[3], MONTHS[named[2]], named[1]);

    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
    return '';
  }

  /** "Rp 1.500.000", "1.500.000", "1500000,50", 1500000 -> number */
  function toAmount(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    let raw = text(value).replace(/[^\d.,-]/g, '');
    if (!raw) return 0;
    const dots = (raw.match(/\./g) || []).length;
    const commas = (raw.match(/,/g) || []).length;
    if (dots && commas) raw = raw.replace(/\./g, '').replace(',', '.');
    else if (commas) raw = raw.replace(',', '.');
    else if (dots > 1 || /\.\d{3}\b/.test(raw)) raw = raw.replace(/\./g, '');
    const number = Number(raw);
    return Number.isFinite(number) ? Math.round(number * 100) / 100 : 0;
  }

  const PARTICIPANT_STATUS = ['Ikut', 'Batal ikut', 'Tidak ikut'];
  const PAYMENT_STATUS = ['Belum bayar', 'Bayar sebagian', 'Sudah bayar'];

  // ------------------------------------------------------------ error helpers
  const RULES = [
    // PGRST204 also says "schema cache", but means a missing COLUMN (not table).
    { match: (error) => error.code === '42703' || error.code === 'PGRST204' || /could not find the .+ column|column .+ does not exist/i.test(error.message), hint: 'Kolom tabel belum lengkap -> jalankan seluruh supabase-schema.sql (blok migrasi) di SQL Editor.', label: 'kolom belum dibuat' },
    { match: (error) => error.code === '42P01' || error.code === 'PGRST205' || /relation .* does not exist|could not find the table/i.test(error.message), hint: 'Tabel belum ada di Supabase -> jalankan supabase-schema.sql di SQL Editor Supabase.', label: 'tabel belum dibuat' },
    { match: (error) => error.code === '42501' || /row-level security|permission denied/i.test(error.message), hint: 'Login lokal (admin/power88) tidak punya izin tulis. Logout, login dengan email+password admin Supabase (app_metadata.role = "admin", lihat supabase-set-admin.sql), lalu Upload lagi. Jangan aktifkan tulis anon untuk data peserta.', label: 'ditolak RLS/policy' },
    { match: (error) => error.code === '23502' || /null value in column/i.test(error.message), hint: 'Ada kolom wajib yang kosong (biasanya tanggal) -> isi tanggal di data tersebut.', label: 'kolom wajib kosong' },
    { match: (error) => error.code === '23514' || /check constraint/i.test(error.message), hint: 'Nilai status/pembayaran tidak sesuai daftar yang diizinkan (Ikut / Batal ikut / Tidak ikut).', label: 'nilai tidak valid' },
    { match: (error) => error.code === '23505' || /duplicate key/i.test(error.message), hint: 'Ada ID data yang bentrok -> hapus duplikatnya lalu upload lagi.', label: 'ID ganda' },
    { match: (error) => /invalid input syntax|date\/time field value out of range/i.test(error.message), hint: 'Ada tanggal yang tidak valid pada data -> perbaiki lalu upload lagi.', label: 'tanggal tidak valid' },
    { match: (error) => error.code === 'PGRST301' || /jwt/i.test(error.message), hint: 'Session login Supabase sudah kedaluwarsa -> masuk ulang lewat form login.', label: 'session kedaluwarsa' },
    { match: (error) => /invalid api key|no api key|401/i.test(`${error.code || ''} ${error.message}`), hint: 'SUPABASE_URL atau SUPABASE_ANON_KEY di config.js salah/berubah.', label: 'anon key salah' },
    { match: (error) => /failed to fetch|networkerror|fetch failed|load failed/i.test(error.message), hint: 'Supabase tidak bisa dihubungi (internet terputus atau project Supabase sedang pause).', label: 'koneksi gagal' }
  ];

  function describeError(error, table) {
    const normalised = {
      code: error?.code ? String(error.code) : '',
      message: text(error?.message || error?.error_description || error?.details || error) || 'kesalahan tidak diketahui'
    };
    const rule = RULES.find((item) => item.match(normalised));
    return {
      table,
      code: normalised.code,
      message: normalised.message,
      label: rule ? rule.label : 'gagal',
      hint: rule ? rule.hint : 'Lihat detail lengkap di Console browser.'
    };
  }

  // --------------------------------------------------------------- row mapping
  function toRemote(data) {
    const participants = (data.participants || []).map((participant) => ({
      id: makeId(participant.id),
      name: text(participant.name),
      phone: text(participant.phone ?? participant.member_id),
      status: PARTICIPANT_STATUS.includes(participant.status) ? participant.status : 'Ikut',
      payment: PAYMENT_STATUS.includes(participant.payment) ? participant.payment : 'Belum bayar'
    }));

    const rundown = (data.rundown || []).map((item) => ({
      id: makeId(item.id),
      schedule_time: text(item.time ?? item.schedule_time),
      activity: text(item.activity),
      location: text(item.location),
      pic: text(item.pic),
      notes: text(item.notes)
    }));

    const ledger = (rows = []) => rows.map((item) => {
      const date = toIsoDate(item.date);
      if (!date && text(item.date)) console.warn(`Supabase sync: tanggal "${item.date}" tidak dikenali, memakai tanggal hari ini.`);
      return {
        id: makeId(item.id),
        // date is NOT NULL in the schema, so an empty/invalid value would fail the whole upload.
        date: date || todayIso(),
        item: text(item.item),
        category: text(item.category),
        amount: toAmount(item.amount),
        photo_url: item.photo || item.photo_url || null
      };
    });

    const expenses = ledger(data.expenses);
    const consumption = ledger(data.consumption);

    const categories = [...new Set((data.categories || []).filter(Boolean).map((name) => text(name)))]
      .filter(Boolean)
      .map((name) => ({ name }));

    const outing = data.outing || {};
    const remoteOuting = {
      id: makeId(outing.id),
      destination: text(outing.destination),
      outing_date: toIsoDate(outing.date) || null,
      description: text(outing.description)
    };

    return {
      local: {
        ...data,
        outing: { ...outing, id: remoteOuting.id, date: toIsoDate(outing.date) || '' },
        participants: participants.map(({ id, name, phone, status, payment }) => ({ id, name, phone, status, payment })),
        rundown: rundown.map(({ id, schedule_time, activity, location, pic, notes }) => ({ id, time: schedule_time, activity, location, pic, notes })),
        expenses: expenses.map(({ photo_url, ...item }) => ({ ...item, photo: photo_url || '' })),
        consumption: consumption.map(({ photo_url, ...item }) => ({ ...item, photo: photo_url || '' })),
        categories: categories.map(({ name }) => name)
      },
      participants,
      rundown,
      expenses,
      consumption,
      categories,
      outing: remoteOuting
    };
  }

  // ------------------------------------------------------------- sync engine
  async function sessionInfo() {
    try {
      const { data } = await client.auth.getSession();
      const session = data?.session || null;
      return {
        active: Boolean(session),
        email: session?.user?.email || '',
        role: session?.user?.app_metadata?.role || ''
      };
    } catch {
      return { active: false, email: '', role: '' };
    }
  }

  async function syncTable(tableName, rows, conflictColumn = 'id') {
    const sent = rows.length;
    try {
      if (sent) {
        const { error } = await client.from(tableName).upsert(rows, { onConflict: conflictColumn });
        if (error) throw error;
      }

      // Upsert alone cannot remove rows deleted in the app. Reconcile the table so
      // Supabase remains an exact copy of the browser data.
      const { data: existing, error: readError } = await client.from(tableName).select(conflictColumn);
      if (readError) throw readError;
      const keep = new Set(rows.map((row) => String(row[conflictColumn])));
      const stale = (existing || [])
        .map((row) => row[conflictColumn])
        .filter((value) => !keep.has(String(value)));
      if (stale.length) {
        const { error } = await client.from(tableName).delete().in(conflictColumn, stale);
        if (error) throw error;
      }

      // A table with nothing to send and nothing to delete never reaches the
      // server, so it can neither succeed nor fail. Report it as skipped instead
      // of counting it as a successful upload (this is why a local login may see
      // only a few tables "fail" - the rest were simply empty in the browser).
      const skipped = sent === 0 && stale.length === 0;
      return {
        table: tableName,
        ok: true,
        rows: sent,
        sent,
        deleted: stale.length,
        skipped,
        code: '',
        label: skipped ? 'dilewati' : 'terkirim',
        message: skipped ? 'Kosong di browser ini, tidak ada yang dikirim.' : `${sent} baris dikirim.`,
        hint: ''
      };
    } catch (error) {
      const described = describeError(error, tableName);
      console.error(`Supabase sync failed for table "${tableName}":`, error);
      return { table: tableName, ok: false, rows: sent, sent, deleted: 0, skipped: false, error, ...described };
    }
  }

  /**
   * Plain-language summary of one table after an upload attempt. The UI uses it
   * to answer "which tables failed?" without opening the browser console.
   */
  function describeTableResult(result) {
    if (result.ok && result.skipped) {
      return { status: 'dilewati', detail: 'Kosong di browser ini, jadi tidak dikirim.' };
    }
    if (result.ok) {
      const deleted = result.deleted ? `, ${result.deleted} baris lama dihapus di Supabase` : '';
      return { status: 'terkirim', detail: `${result.sent} baris dikirim${deleted}.` };
    }
    return {
      status: 'ditolak',
      detail: `${result.label}: ${result.message}`,
      hint: result.hint || ''
    };
  }

  function buildUploadReport({ results, session, startedAt, blockedReason = '', blockedMessage = '' }) {
    const tables = results.map((result) => {
      const described = describeTableResult(result);
      return {
        table: result.table,
        ok: Boolean(result.ok),
        status: described.status,
        detail: described.detail,
        hint: described.hint || '',
        sent: result.sent ?? result.rows ?? 0,
        deleted: result.deleted || 0,
        skipped: Boolean(result.skipped),
        code: result.code || ''
      };
    });
    return {
      at: new Date().toISOString(),
      startedAt,
      ok: tables.every((table) => table.ok),
      blockedReason,
      blockedMessage,
      session,
      tables,
      failedTables: tables.filter((table) => !table.ok).map((table) => table.table),
      skippedTables: tables.filter((table) => table.skipped).map((table) => table.table),
      sentTables: tables.filter((table) => table.ok && !table.skipped).map((table) => table.table),
      counts: {
        failed: tables.filter((table) => !table.ok).length,
        skipped: tables.filter((table) => table.skipped).length,
        sent: tables.filter((table) => table.ok && !table.skipped).length
      }
    };
  }

  function recordUpload(report) {
    window.OUTING_SYNC_LAST_UPLOAD = report;
    return report;
  }

  /** Report used when the upload never reached the network at all. */
  function blockedReport(session, blockedReason, blockedMessage) {
    return recordUpload(buildUploadReport({
      results: TABLES.map((table) => ({
        table, ok: false, sent: 0, skipped: false, code: '', label: 'dibatalkan', message: blockedMessage
      })),
      session,
      startedAt: new Date().toISOString(),
      blockedReason,
      blockedMessage
    }));
  }

  async function syncSnapshot(snapshot, localAtStart) {
    const remote = toRemote(snapshot);
    const startedAt = new Date().toISOString();
    // Session state decides whether the default write policies can accept this
    // upload at all, so read it once and attach it to the report.
    const session = await sessionInfo();
    setStatus('☁ Menyimpan...', 'syncing');
    // If signing out failed, never reuse a previous admin's persisted JWT for a
    // local admin/member login. Anon writes, if deliberately enabled, still work.
    if (window.OUTING_LOCAL_LOGIN && session.active) {
      const error = new Error('Session Supabase lama masih aktif. Keluar lalu muat ulang sebelum mencoba upload dengan akun lain.');
      const failedTables = [...TABLES];
      window.OUTING_SYNC_ERROR = error;
      window.OUTING_SYNC_STATUS_TEXT = error.message;
      setStatus('⚠ Session lama masih aktif', 'error');
      const report = blockedReport(session, 'stale-session', error.message);
      return { ok: false, error, failedTables, hint: error.message, localOnlyLogin: true, session, report };
    }

    const results = await Promise.all([
      syncTable('participants', remote.participants),
      syncTable('rundown', remote.rundown),
      syncTable('expenses', remote.expenses),
      syncTable('consumption', remote.consumption),
      syncTable(categoriesTable, remote.categories, 'name'),
      syncTable('outing', [remote.outing])
    ]);
    const report = recordUpload(buildUploadReport({ results, session, startedAt }));

    const failed = results.filter((result) => !result.ok);
    if (!failed.length) {
      // Keep generated UUIDs locally and in the in-memory UI, but only if no
      // newer edit landed while the network request was running.
      if (localStorage.getItem(storageKey) === localAtStart) {
        localStorage.setItem(storageKey, JSON.stringify(remote.local));
        markSynced();
        remoteReadReady = true;
        notifyRemoteReady();
      }
      const pendingUpload = hasLocalChanges();
      window.OUTING_SYNC_STATUS_TEXT = pendingUpload ? 'Ada perubahan lokal baru yang belum masuk ke Supabase. Klik Upload untuk mengirimnya.' : '';
      setStatus(pendingUpload ? '⚠ Ada data lokal belum terunggah' : '☁ Supabase', pendingUpload ? 'error' : 'connected');
      return { ok: true, results, report, failedTables: [], skippedTables: report.skippedTables, pendingUpload };
    }

    markLocalChanges();
    const rlsFailures = failed.filter((result) => result.code === '42501').map((result) => result.table);
    const schemaFailures = failed.filter((result) => ['42703', 'PGRST204', '42P01', 'PGRST205'].includes(result.code)).map((result) => result.table);
    // No Supabase session + RLS denial on every table that was actually sent is
    // the "local login" signature. Empty tables are skipped by the server, so
    // the count here is the number of tables that had data in this browser.
    const sentTables = results.filter((result) => !result.skipped).map((result) => result.table);
    const localOnlyLogin = rlsFailures.length > 0 && !session.active && rlsFailures.length === sentTables.length;
    window.OUTING_SYNC_STATUS_TEXT = failed.map((result) => `${result.table}: ${result.message}`).join('\n');
    setStatus(localOnlyLogin ? '⚠ Login lokal (tanpa session)' : '⚠ Gagal sinkronisasi', 'error');

    const error = new Error(failed.map((result) => `${result.table}: ${result.message}`).join(' | '));
    error.results = results;
    window.OUTING_SYNC_ERROR = error;

    return {
      ok: false,
      error,
      results,
      report,
      failedTables: failed.map((result) => result.table),
      skippedTables: report.skippedTables,
      rlsFailures,
      schemaFailures,
      hint: failed[0].hint,
      code: failed[0].code,
      session,
      localOnlyLogin
    };
  }

  async function flushQueue() {
    let result = { ok: true, results: [], failedTables: [] };
    while (pendingSnapshot) {
      const { data, localAtStart } = pendingSnapshot;
      pendingSnapshot = null;
      result = await syncSnapshot(data, localAtStart);
    }
    return result;
  }

  function queueSync(snapshot) {
    pendingSnapshot = {
      data: JSON.parse(JSON.stringify(snapshot)),
      localAtStart: localStorage.getItem(storageKey)
    };
    if (!activeSync) {
      activeSync = flushQueue().finally(() => {
        activeSync = null;
      });
    }
    return activeSync;
  }

  const mapParticipant = (participant) => ({
    id: participant.id,
    name: text(participant.name),
    phone: text(participant.phone ?? participant.member_id),
    status: participant.status || 'Ikut',
    payment: participant.payment || 'Belum bayar'
  });
  const mapRundown = (item) => ({
    id: item.id,
    time: text(item.schedule_time ?? item.time),
    activity: text(item.activity),
    location: text(item.location),
    pic: text(item.pic),
    notes: text(item.notes)
  });
  const mapLedger = (item) => ({
    id: item.id,
    date: toIsoDate(item.date),
    item: text(item.item),
    category: text(item.category),
    amount: toAmount(item.amount),
    photo: item.photo_url || ''
  });

  async function readTable(tableName, orderBy) {
    let query = client.from(tableName).select('*');
    if (orderBy) query = query.order(orderBy);
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }

  function notifyRemoteReady() {
    window.OUTING_REMOTE_READY = true;
    document.dispatchEvent(new CustomEvent('outing:remote-ready'));
  }

  async function loadRemote({ replaceLocal = false } = {}) {
    const request = ++loadRequest;
    remoteReadReady = false;
    setStatus('☁ Memuat...', 'syncing');
    try {
      if (activeSync) await activeSync;
      const localAtStart = localStorage.getItem(storageKey);
      const stateAtStart = localStorage.getItem(syncStateKey);
      const [participants, outing, rundown, expenses, consumption, categories] = await Promise.all([
        readTable('participants', 'created_at'),
        client.from('outing').select('*').order('created_at').limit(1).then(({ data, error }) => {
          if (error) throw error;
          return data || [];
        }),
        readTable('rundown', 'schedule_time'),
        readTable('expenses', 'date'),
        readTable('consumption', 'date'),
        readTable(categoriesTable, 'name')
      ]);
      if (request !== loadRequest) return { superseded: true };

      // Edits (or a pending upload) made during the GETs must never be lost.
      if (localStorage.getItem(storageKey) !== localAtStart || localStorage.getItem(syncStateKey) !== stateAtStart) {
        window.OUTING_SYNC_STATUS_TEXT = 'Data lokal berubah saat Supabase sedang dimuat. Gunakan tombol Muat dari Supabase jika ingin menggantinya.';
        setStatus('⚠ Data lokal dipertahankan', 'error');
        return { ok: true, preservedLocal: true };
      }

      const hasRemote = participants.length || outing.length || rundown.length || expenses.length || consumption.length || categories.length;
      if (!replaceLocal && (!hasRemote || hasLocalChanges())) {
        const pending = hasLocalChanges();
        window.OUTING_SYNC_STATUS_TEXT = !hasRemote
          ? 'Supabase kosong. Data lokal dipertahankan; login admin Supabase lalu klik Upload untuk mengirimnya.'
          : 'Ada data lokal yang belum terkonfirmasi tersinkron (termasuk dari versi lama). Gunakan Upload atau Muat dari Supabase secara sadar.';
        setStatus(pending ? '⚠ Data lokal belum terunggah' : '☁ Supabase kosong (data lokal)', pending ? 'error' : 'connected');
        return { ok: true, empty: !hasRemote, preservedLocal: localAtStart !== null };
      }

      const remote = {
        participants: participants.map(mapParticipant),
        outing: outing[0]
          ? {
              id: outing[0].id,
              destination: outing[0].destination || '',
              date: outing[0].outing_date || '',
              description: outing[0].description || ''
            }
          : { id: '', destination: '', date: '', description: '' },
        rundown: rundown.map(mapRundown),
        expenses: expenses.map(mapLedger),
        consumption: consumption.map(mapLedger),
        categories: categories.map((item) => item.name).filter(Boolean)
      };
      localStorage.setItem(storageKey, JSON.stringify(remote));
      markSynced();
      remoteReadReady = true;
      window.OUTING_SYNC_STATUS_TEXT = '';
      window.OUTING_SYNC_ERROR = null;
      setStatus('☁ Baca Supabase', 'connected');
      notifyRemoteReady();
      return { ok: true, loaded: true, empty: !hasRemote };
    } catch (error) {
      if (request !== loadRequest) return { superseded: true };
      const described = describeError(error, 'baca data');
      console.error('Supabase load failed:', error);
      const session = await sessionInfo();
      const needsLogin = !session.active && ['42501', '401', 'PGRST301'].includes(described.code);
      window.OUTING_SYNC_STATUS_TEXT = `${described.table}: ${described.message}`;
      setStatus(needsLogin ? '⚠ Login Supabase diperlukan' : '⚠ Gagal memuat data', 'error');
      window.OUTING_SYNC_ERROR = error;
      return { ok: false, error: described };
    }
  }

  // ---------------------------------------------------------------- diagnosis
  async function diagnose(localSnapshot) {
    const session = await sessionInfo();
    const local = localSnapshot || readLocal();
    const localCounts = {
      participants: (local.participants || []).length,
      rundown: (local.rundown || []).length,
      expenses: (local.expenses || []).length,
      consumption: (local.consumption || []).length,
      [categoriesTable]: (local.categories || []).length,
      outing: local.outing ? 1 : 0
    };

    // A diagnosis must never upsert or reconcile (delete!) remote rows. Select
    // every column needed by the app so a missing participants.name is detected
    // even when the table is empty. HEAD + count avoids downloading private data.
    const readResults = {};
    for (const table of TABLES) {
      try {
        const { count, error } = await client.from(table).select(READ_COLUMNS[table], { head: true, count: 'exact' });
        if (error) throw error;
        readResults[table] = { ok: true, rows: typeof count === 'number' ? count : null };
      } catch (error) {
        readResults[table] = { ok: false, ...describeError(error, table) };
      }
    }

    const adminSession = session.active && session.role === 'admin';
    const tables = TABLES.map((table) => {
      const read = readResults[table];
      return {
        table,
        localRows: localCounts[table] ?? 0,
        read: read.ok ? 'ok' : 'gagal',
        readDetail: read.ok
          ? (read.rows === null ? 'query berhasil (jumlah baris tidak tersedia)' : `${read.rows} baris terlihat di Supabase`)
          : `${read.label}: ${read.message}`,
        remoteRows: read.ok ? read.rows : null,
        write: 'belum diuji',
        writeDetail: adminSession
          ? 'Belum diuji; gunakan tombol Upload untuk mengirim data setelah memeriksa isinya.'
          : 'Belum diuji; logout lalu login dengan email/password admin Supabase (lihat supabase-set-admin.sql). Login lokal pasti ditolak policy tulis.',
        hint: read.ok ? '' : read.hint
      };
    });

    const problems = tables.filter((table) => table.read === 'gagal');
    return {
      ok: problems.length === 0,
      url: config.SUPABASE_URL,
      session,
      tables,
      problems,
      localOnlyLogin: !session.active,
      hint: problems.find((table) => table.hint)?.hint || ''
    };
  }

  function start() {
    const ready = (async () => {
      if (window.OUTING_LOCAL_LOGIN) {
        try {
          const { error } = await client.auth.signOut({ scope: 'local' });
          if (error) console.warn('Gagal menghapus session Supabase lama:', error);
        } catch (error) { console.warn('Gagal menghapus session Supabase lama:', error); }
      }
      return loadRemote();
    })();
    window.OUTING_SYNC = {
      client,
      queue: queueSync,
      canAutoSync,
      markLocalChanges,
      load: loadRemote,
      diagnose,
      tables: TABLES,
      lastUpload: () => window.OUTING_SYNC_LAST_UPLOAD || null
    };
    window.OUTING_SYNC_READY = ready;
    window.OUTING_SYNC_STATUS = { configured: true, libraryLoaded: true, ready: true };
    document.dispatchEvent(new CustomEvent('outing:sync-layer-ready'));
  }

  // The CDN script may still be in flight (or may be replaced by a fallback CDN
  // from index.html), so wait for it before deciding that Supabase is offline.
  function waitForLibrary(attempt = 0) {
    if (window.supabase && typeof window.supabase.createClient === 'function') {
      client = window.supabase.createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY);
      start();
      return;
    }
    if (attempt * 200 >= LIBRARY_WAIT_MS) {
      const error = new Error('Library Supabase tidak termuat dari CDN.');
      console.error('Supabase sync disabled:', error.message);
      window.OUTING_SYNC_ERROR = error;
      window.OUTING_SYNC_STATUS = { configured: true, libraryLoaded: false, ready: false };
      setStatus('⚠ Library Supabase gagal dimuat', 'error');
      return;
    }
    setTimeout(() => waitForLibrary(attempt + 1), 200);
  }

  waitForLibrary();
})();
