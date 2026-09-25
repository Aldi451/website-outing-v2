const APP_STORAGE_KEY = 'outing-hub-v1';
const DEFAULT_ADMIN = { userId: 'admin', password: 'power88' };
const DEFAULT_MEMBER = { userId: 'member', password: 'member' };
const PARTICIPANT_STATUSES = ['Ikut', 'Batal ikut', 'Tidak ikut'];
const PAYMENT_STATUSES = ['Belum bayar', 'Bayar sebagian', 'Sudah bayar'];
const ADMIN_PAGES = ['participants', 'reports'];
const ADDABLE_PAGES = ['participants', 'rundown', 'expenses', 'consumption'];

const DEFAULT_DB = {
  participants: [
    { id: 'p1', name: 'Budi Santoso', phone: '0812-3456-7890', status: 'Ikut', payment: 'Sudah bayar' },
    { id: 'p2', name: 'Siti Aminah', phone: '0813-2222-3344', status: 'Ikut', payment: 'Bayar sebagian' },
    { id: 'p3', name: 'Andi Wijaya', phone: '0821-9876-5432', status: 'Batal ikut', payment: 'Belum bayar' }
  ],
  outing: {
    destination: 'Bandung, Jawa Barat',
    date: '2026-10-18',
    description: 'Outing tahunan tim internal dengan agenda edukasi dan liburan.'
  },
  rundown: [
    { id: 'r1', time: '07:00', activity: 'Berkumpul dan registrasi', location: 'Kantor pusat', pic: 'Panitia', notes: 'Peserta hadir 15 menit sebelum berangkat.' },
    { id: 'r2', time: '08:00', activity: 'Perjalanan menuju Bandung', location: 'Bus outing', pic: 'Koordinator transportasi', notes: '' },
    { id: 'r3', time: '10:30', activity: 'Kunjungan dan aktivitas utama', location: 'Lokasi tujuan', pic: 'Tim acara', notes: '' },
    { id: 'r4', time: '16:00', activity: 'Perjalanan pulang', location: 'Bandung', pic: 'Koordinator transportasi', notes: '' }
  ],
  expenses: [
    { id: 'e1', date: '2026-10-05', item: 'Transportasi bus', category: 'Transportasi', amount: 2500000, photo: '' },
    { id: 'e2', date: '2026-10-05', item: 'Perlengkapan acara', category: 'Perlengkapan', amount: 1500000, photo: '' }
  ],
  consumption: [
    { id: 'c1', date: '2026-10-06', item: 'Nasi box', category: 'Makanan', amount: 980000, photo: '' },
    { id: 'c2', date: '2026-10-06', item: 'Air mineral', category: 'Minuman', amount: 320000, photo: '' }
  ],
  categories: ['Transportasi', 'Perlengkapan', 'ATK', 'Makanan', 'Minuman', 'Lainnya']
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

let db = loadDb();
let session = null;
let currentPage = 'dashboard';
let editingId = null;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createId(prefix = 'item') {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normaliseParticipant(item = {}, index = 0) {
  const status = PARTICIPANT_STATUSES.includes(item.status) ? item.status : 'Ikut';
  const payment = PAYMENT_STATUSES.includes(item.payment) ? item.payment : 'Belum bayar';
  // member_id is accepted only as a one-time migration fallback for older local data.
  const phone = item.phone || item.telephone || item.nomor_telepon || item.member_id || '';
  return {
    id: item.id || `p-${index + 1}`,
    name: String(item.name || '').trim(),
    phone: String(phone).trim(),
    status,
    payment
  };
}

function normaliseRundown(item = {}, index = 0) {
  return {
    id: item.id || `r-${index + 1}`,
    time: String(item.time || item.waktu || '').trim(),
    activity: String(item.activity || item.agenda || item.kegiatan || '').trim(),
    location: String(item.location || item.lokasi || '').trim(),
    pic: String(item.pic || item.person_in_charge || item.penanggung_jawab || '').trim(),
    notes: String(item.notes || item.catatan || '').trim()
  };
}

function normaliseLedgerItem(item = {}, index = 0, prefix = 'item') {
  return {
    id: item.id || `${prefix}-${index + 1}`,
    date: String(item.date || '').trim(),
    item: String(item.item || '').trim(),
    category: String(item.category || '').trim(),
    amount: Number(item.amount || 0),
    photo: item.photo || item.photo_url || ''
  };
}

function normaliseDatabase(source = {}) {
  const outing = source.outing || {};
  return {
    participants: Array.isArray(source.participants)
      ? source.participants.map(normaliseParticipant)
      : clone(DEFAULT_DB.participants),
    outing: {
      id: outing.id || '',
      destination: String(outing.destination || '').trim(),
      date: String(outing.date || outing.outing_date || '').trim(),
      description: String(outing.description || '').trim()
    },
    rundown: Array.isArray(source.rundown)
      ? source.rundown.map(normaliseRundown)
      : clone(DEFAULT_DB.rundown),
    expenses: Array.isArray(source.expenses)
      ? source.expenses.map((item, index) => normaliseLedgerItem(item, index, 'e'))
      : clone(DEFAULT_DB.expenses),
    consumption: Array.isArray(source.consumption)
      ? source.consumption.map((item, index) => normaliseLedgerItem(item, index, 'c'))
      : clone(DEFAULT_DB.consumption),
    categories: Array.isArray(source.categories)
      ? source.categories.filter(Boolean)
      : clone(DEFAULT_DB.categories)
  };
}

function loadDb() {
  try {
    const raw = localStorage.getItem(APP_STORAGE_KEY);
    if (!raw) return clone(DEFAULT_DB);
    return normaliseDatabase(JSON.parse(raw));
  } catch {
    return clone(DEFAULT_DB);
  }
}

function saveDb() {
  // Never reconcile an unknown/unsynced browser snapshot against server rows
  // just because an admin edited one field. First upload must be deliberate.
  const autoSync = window.OUTING_SYNC?.canAutoSync?.();
  window.OUTING_SYNC?.markLocalChanges?.();
  localStorage.setItem(APP_STORAGE_KEY, JSON.stringify(db));
  if (autoSync && window.OUTING_SYNC?.queue) return window.OUTING_SYNC.queue(db);
  return Promise.resolve(window.OUTING_SYNC?.queue
    ? { ok: false, pendingUpload: true }
    : { ok: true, localOnly: true });
}

/**
 * Turns a sync result into a message that names the failing table and the most
 * likely cause, instead of a generic "cek koneksi atau RLS".
 */
function syncFailureMessage(result) {
  const hint = result?.hint ? ` ${result.hint}` : '';
  const failedTables = result?.failedTables || [];
  const skippedTables = result?.skippedTables || [];
  const failedText = failedTables.join(', ');
  // Say which tables were skipped (empty in this browser) so "2 tabel" never
  // looks like the whole story again.
  const skippedText = skippedTables.length
    ? ` Tabel ${skippedTables.join(', ')} kosong di browser ini, jadi tidak perlu dikirim.`
    : '';
  if (result?.localOnlyLogin) {
    if (!result.results) return `Data hanya tersimpan lokal. ${result.hint || 'Session Supabase lama perlu ditutup.'}`;
    const schema = result.schemaFailures?.length
      ? `${result.schemaFailures.length} tabel perlu perbaikan skema (${result.schemaFailures.join(', ')}). `
      : '';
    return `Upload ditolak RLS pada ${failedTables.length} tabel: ${failedText}. ${schema}Login memakai email/password admin Supabase.${skippedText}`;
  }
  if (failedTables.length) {
    return `Upload gagal pada ${failedTables.length} tabel: ${failedText}.${hint}${skippedText}`;
  }
  return `Data tersimpan lokal, tetapi belum masuk ke Supabase.${hint || ' Cek koneksi atau policy RLS.'}`;
}

function showSyncResult(result, successMessage = 'Data berhasil disimpan ke Supabase.', { openReport = false } = {}) {
  if (result?.pendingUpload) {
    showToast('Data tersimpan lokal. Periksa isinya, lalu login admin Supabase dan klik Upload ke Supabase.');
  } else if (result?.ok && !result.localOnly) {
    if (result.skippedTables?.length) {
      showToast(`${successMessage} Tabel ${result.skippedTables.join(', ')} kosong, jadi dilewati.`);
    } else {
      showToast(successMessage);
    }
  } else if (result?.ok) {
    showToast('Data tersimpan di browser; Supabase belum siap atau belum dikonfigurasi.');
  } else {
    if (result?.error) console.error('Sinkronisasi Supabase gagal:', result.error);
    if (result?.results) console.table(result.results.map(({ table, ok, label, message }) => ({ table, ok, label, message })));
    showToast(syncFailureMessage(result));
    // A short toast cannot show which tables failed and why; on an explicit
    // Upload the full per-table report is opened so the reason is visible
    // without the browser console (background failures keep the toast + button).
    if (openReport && result?.report) openUploadReport(result.report);
  }
  refreshSyncDetailButton();
}

function showToast(message) {
  const toast = $('#toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('show'), 2600);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }[char]));
}

function formatMoney(value) {
  const number = Number(value || 0);
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0
  }).format(number);
}

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  }).format(date);
}

function statusBadge(value) {
  const label = String(value || '-');
  let type = 'neutral';
  if (/batal|sebagian/i.test(label)) type = 'warning';
  if (/tidak ikut|belum bayar/i.test(label)) type = 'danger';
  if (/^ikut$|sudah bayar/i.test(label)) type = 'success';
  return `<span class="badge ${type}">${escapeHtml(label)}</span>`;
}

function isAdmin() {
  return session?.role === 'admin';
}

function getLoggedUserName() {
  if (!session) return 'Guest';
  return session.role === 'admin' ? 'Administrator' : session.name;
}

function sortedRundown() {
  return [...(db.rundown || [])].sort((a, b) => String(a.time || '').localeCompare(String(b.time || '')));
}

// Mount point of the currently open report/detail dialog, so delegated handlers
// can read what is being shown without stuffing base64 into HTML attributes.
const $reportData = { __item: null };

async function login(event) {
  event.preventDefault();
  const userId = $('#login-id').value.trim();
  const password = $('#login-password').value;

  if ((userId === DEFAULT_ADMIN.userId && password === DEFAULT_ADMIN.password) ||
      (userId === DEFAULT_MEMBER.userId && password === DEFAULT_MEMBER.password)) {
    // A local login must not silently reuse a Supabase admin token left in this
    // browser from an earlier session (or the "member" login could write).
    window.OUTING_LOCAL_LOGIN = true;
    try {
      const { error } = (await window.OUTING_SYNC?.client?.auth.signOut({ scope: 'local' })) || {};
      if (error) console.warn('Gagal keluar dari session Supabase:', error);
    } catch (error) { console.warn('Gagal keluar dari session Supabase:', error); }
    session = userId === DEFAULT_ADMIN.userId
      ? { role: 'admin', name: 'Administrator', local: true }
      : { role: 'member', name: 'Peserta', local: true };
    startApp();
    return;
  }

  const config = window.OUTING_CONFIG || {};
  const supabaseConfigured = Boolean(config.SUPABASE_URL && config.SUPABASE_ANON_KEY);
  if (!supabaseConfigured) return showToast('User ID atau password tidak sesuai.');
  if (!window.OUTING_SYNC?.client) {
    showToast('Koneksi Supabase belum siap. Tunggu sebentar atau periksa koneksi CDN.');
    return;
  }

  const authClient = window.OUTING_SYNC.client;
  try {
    const { data, error } = await authClient.auth.signInWithPassword({ email: userId, password });
    if (error || !data?.user) {
      showToast(/invalid login credentials/i.test(error?.message || '')
        ? 'Email/password Supabase tidak sesuai. Login lokal admin/power88 hanya menyimpan data di browser.'
        : `Login Supabase gagal: ${error?.message || 'penyebab tidak diketahui'}.`);
      return;
    }
    if (data.user.app_metadata?.role !== 'admin') {
      await authClient.auth.signOut({ scope: 'local' });
      showToast('Akun Supabase ini belum memiliki role admin (app_metadata.role = "admin").');
      return;
    }
    window.OUTING_LOCAL_LOGIN = false;
    session = { role: 'admin', name: data.user.email || 'Admin Supabase', local: false };
    startApp();
    // Preserve unsynced local rows; explicitly choose Upload or Muat if needed.
    const loaded = await window.OUTING_SYNC.load();
    if (loaded?.preservedLocal) showToast('Data lokal dipertahankan. Periksa isinya sebelum memilih Upload atau Muat dari Supabase.');
    else if (loaded && !loaded.ok && !loaded.superseded) showToast('Supabase belum bisa dibaca. Jalankan SQL schema lalu cek dengan tombol 🩺 Cek Supabase.');
  } catch (error) {
    showToast(`Login Supabase gagal: ${error?.message || 'cek config.js'}.`);
  }
}

function startApp() {
  $('#login-screen').classList.add('hidden');
  $('#app').classList.remove('hidden');
  $('#profile-name').textContent = getLoggedUserName();
  $('#profile-role').textContent = isAdmin() ? (session.local ? 'Admin lokal (belum online)' : 'Admin Supabase') : 'Mode lihat';
  $('#avatar').textContent = isAdmin() ? 'A' : 'P';
  closeMobileMenu();
  render();
  refreshSyncDetailButton();
  // Warn before the first upload attempt instead of after a confusing failure.
  if (isAdmin() && session.local) {
    showToast('Login lokal: data hanya tersimpan di browser ini. Untuk upload ke Supabase, login dengan email/password admin Supabase.');
  }
}

function render() {
  if (!isAdmin() && ADMIN_PAGES.includes(currentPage)) currentPage = 'dashboard';

  const titles = {
    dashboard: 'Dashboard',
    participants: 'Data Peserta',
    outing: 'Data Outing',
    rundown: 'Rundown',
    expenses: 'Pembelian Barang',
    consumption: 'Konsumsi',
    reports: 'Reporting & Import'
  };

  $('#page-title').textContent = titles[currentPage] || 'Dashboard';
  $$('.nav-item').forEach((item) => {
    item.classList.toggle('active', item.dataset.page === currentPage);
    if (item.classList.contains('admin-only')) item.classList.toggle('hidden', !isAdmin());
  });
  $$('.admin-only').forEach((item) => {
    if (!item.closest('#navigation')) item.classList.toggle('hidden', !isAdmin());
  });

  const handlers = {
    dashboard: renderDashboard,
    participants: renderParticipants,
    outing: renderOuting,
    rundown: renderRundown,
    expenses: renderExpenses,
    consumption: renderConsumption,
    reports: renderReports
  };

  $('#page-content').innerHTML = (handlers[currentPage] || renderDashboard)();

  // Content inserted after the navigation also needs the permission state applied.
  if (!isAdmin()) $$('.admin-only').forEach((item) => item.classList.add('hidden'));
  const quickAdd = $('#quick-add');
  if (quickAdd) quickAdd.classList.toggle('hidden', !isAdmin() || (currentPage !== 'dashboard' && !ADDABLE_PAGES.includes(currentPage)));
}

function renderDashboard() {
  const participants = db.participants || [];
  const totalParticipants = participants.length;
  const attending = participants.filter((participant) => participant.status === 'Ikut').length;
  const paid = participants.filter((participant) => participant.payment === 'Sudah bayar').length;
  const scheduleCount = (db.rundown || []).length;
  const upcoming = sortedRundown().slice(0, 4);
  const ledgerTotal = ledgerTotalAmount();

  return `
    <div class="page-grid">
      <div class="card stat-card">
        <span class="stat-icon">♙</span>
        <span class="stat-label">Total peserta</span>
        <div class="stat-value">${totalParticipants}</div>
      </div>
      <div class="card stat-card">
        <span class="stat-icon">✓</span>
        <span class="stat-label">Peserta ikut</span>
        <div class="stat-value">${attending}</div>
      </div>
      <div class="card stat-card">
        <span class="stat-icon">◷</span>
        <span class="stat-label">Sudah bayar</span>
        <div class="stat-value">${paid}</div>
      </div>
      <div class="card stat-card">
        <span class="stat-icon">☷</span>
        <span class="stat-label">Agenda rundown</span>
        <div class="stat-value">${scheduleCount}</div>
      </div>
    </div>

    <div class="section">
      <div class="section-head">
        <div>
          <p class="section-kicker">INFORMASI UTAMA</p>
          <h3>Ringkasan outing</h3>
        </div>
        <button class="link-btn" data-action="go-outing">Lihat detail <span aria-hidden="true">→</span></button>
      </div>
      <div class="card">
        <div class="info">
          <b>${escapeHtml(db.outing.destination || 'Tujuan belum diatur')}</b>
          <span class="info-separator">·</span>
          ${escapeHtml(formatDate(db.outing.date))}<br>
          ${escapeHtml(db.outing.description || 'Tambahkan informasi outing untuk memulai.')}
        </div>
      </div>
    </div>

    <div class="section">
      <div class="section-head">
        <div>
          <p class="section-kicker">JADWAL</p>
          <h3>Rundown outing</h3>
        </div>
        <button class="link-btn" data-action="go-rundown">Lihat semua <span aria-hidden="true">→</span></button>
      </div>
      <div class="rundown-list compact-list">
        ${upcoming.length ? upcoming.map((item) => renderRundownCard(item, false)).join('') : '<div class="empty card">Belum ada rundown.</div>'}
      </div>
    </div>

    <div class="section">
      <div class="section-head">
        <div>
          <p class="section-kicker">KEIKUTSERTAAN</p>
          <h3>Status peserta</h3>
        </div>
      </div>
      <div class="table-wrap">
        ${renderParticipantTable(participants, isAdmin())}
      </div>
    </div>

    <div class="section">
      <div class="section-head">
        <div>
          <p class="section-kicker">BIAYA</p>
          <h3>Pembelian &amp; konsumsi</h3>
        </div>
        <span class="status-pill">Total ${formatMoney(ledgerTotal)}</span>
      </div>
      <div class="page-grid">
        <div class="card stat-card">
          <span class="stat-icon">▣</span>
          <span class="stat-label">Pembelian barang</span>
          <div class="stat-value">${(db.expenses || []).length}</div>
          <small class="muted">Total ${formatMoney(ledgerTotalAmount('expenses'))}</small>
        </div>
        <div class="card stat-card">
          <span class="stat-icon">◉</span>
          <span class="stat-label">Konsumsi</span>
          <div class="stat-value">${(db.consumption || []).length}</div>
          <small class="muted">Total ${formatMoney(ledgerTotalAmount('consumption'))}</small>
        </div>
      </div>
      <div class="toolbar">
        <button class="link-btn" data-action="go-expenses">Rincian pembelian barang <span aria-hidden="true">→</span></button>
        <button class="link-btn" data-action="go-consumption">Rincian konsumsi <span aria-hidden="true">→</span></button>
      </div>
    </div>
  `;
}

/** Total of one ledger (expenses/consumption) or of both together. */
function ledgerTotalAmount(type) {
  const sum = (rows) => (rows || []).reduce((total, item) => total + Number(item.amount || 0), 0);
  if (type) return sum(db[type]);
  return sum(db.expenses) + sum(db.consumption);
}

function renderParticipants() {
  return `
    <div class="toolbar page-toolbar">
      <input id="participant-search" class="search" placeholder="Cari nama atau nomor telepon..." aria-label="Cari peserta" />
      <button class="btn primary" data-add="participants">+ Tambah peserta</button>
    </div>
    <div class="section">
      <div class="section-head table-heading">
        <div>
          <p class="section-kicker">DAFTAR PESERTA</p>
          <h3>Nama, nomor telepon, dan status</h3>
        </div>
        <span class="status-pill">${db.participants.length} peserta</span>
      </div>
      <div class="table-wrap" id="participant-table">
        ${renderParticipantTable(db.participants, true)}
      </div>
    </div>
  `;
}

function renderParticipantTable(rows, showActions = false) {
  if (!rows.length) return '<div class="empty">Belum ada data peserta.</div>';

  const rowsHtml = rows.map((participant) => `
    <tr>
      <td data-label="Nama"><b>${escapeHtml(participant.name || '-')}</b></td>
      <td data-label="Nomor telepon">${escapeHtml(participant.phone || '-')}</td>
      <td data-label="Status peserta">${statusBadge(participant.status)}</td>
      <td data-label="Status pembayaran">${statusBadge(participant.payment)}</td>
      ${showActions && isAdmin() ? `
        <td data-label="Aksi" class="actions">
          <button class="link-btn" data-edit="${escapeHtml(participant.id)}" data-type="participants">Edit</button>
          <button class="link-btn danger-link" data-delete="${escapeHtml(participant.id)}" data-type="participants">Hapus</button>
        </td>
      ` : ''}
    </tr>
  `).join('');

  return `
    <table class="table participant-table">
      <thead>
        <tr>
          <th>Nama</th>
          <th>Nomor telepon</th>
          <th>Status peserta</th>
          <th>Status pembayaran</th>
          ${showActions && isAdmin() ? '<th>Aksi</th>' : ''}
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>
  `;
}

function renderOuting() {
  const outing = db.outing || { destination: '', date: '', description: '' };
  return `
    <div class="card outing-card">
      <div class="section-head">
        <div>
          <p class="section-kicker">DETAIL KEGIATAN</p>
          <h3>Informasi tujuan outing</h3>
        </div>
        ${isAdmin() ? '<button class="btn primary" data-edit="outing" data-type="outing">Edit outing</button>' : ''}
      </div>
      <div class="form-grid readonly-grid">
        <label>Tujuan
          <input disabled value="${escapeHtml(outing.destination || '')}" />
        </label>
        <label>Tanggal
          <input disabled type="date" value="${escapeHtml(outing.date || '')}" />
        </label>
        <label class="full-span">Catatan
          <textarea disabled>${escapeHtml(outing.description || '')}</textarea>
        </label>
      </div>
    </div>
    <div class="section">
      <div class="info">${isAdmin() ? 'Perbarui tujuan dan tanggal outing agar informasi di dashboard dan rundown tetap sinkron.' : `Halo ${escapeHtml(session?.name || 'Peserta')}, halaman ini dapat dilihat tanpa akses untuk mengubah data.`}</div>
    </div>
  `;
}

function renderRundown() {
  const rows = sortedRundown();
  return `
    <div class="rundown-intro card">
      <div>
        <p class="section-kicker">JADWAL KEGIATAN</p>
        <h3>Rundown outing</h3>
        <p class="muted">Lihat urutan agenda, lokasi, dan penanggung jawab kegiatan.</p>
      </div>
      ${isAdmin() ? `
        <div class="toolbar rundown-toolbar">
          <button class="btn primary" data-add="rundown">+ Tambah agenda</button>
          <label class="btn ghost file-button">Import Excel
            <input id="rundown-import-file" type="file" accept=".xlsx,.xls,.csv" />
          </label>
          <button class="btn ghost" data-template-type="rundown">Template</button>
        </div>
      ` : '<span class="status-pill readonly-pill">Mode lihat</span>'}
    </div>
    <div class="section">
      <div class="rundown-list">
        ${rows.length ? rows.map((item) => renderRundownCard(item, isAdmin())).join('') : '<div class="empty card">Belum ada agenda rundown.</div>'}
      </div>
    </div>
  `;
}

function renderRundownCard(item, showActions = false) {
  return `
    <article class="rundown-item">
      <div class="rundown-time">
        <span>WAKTU</span>
        <strong>${escapeHtml(item.time || '--:--')}</strong>
      </div>
      <div class="rundown-main">
        <h4>${escapeHtml(item.activity || 'Agenda belum diisi')}</h4>
        <div class="rundown-meta">
          ${item.location ? `<span>⌖ ${escapeHtml(item.location)}</span>` : ''}
          ${item.pic ? `<span>♙ ${escapeHtml(item.pic)}</span>` : ''}
        </div>
        ${item.notes ? `<p>${escapeHtml(item.notes)}</p>` : ''}
      </div>
      ${showActions && isAdmin() ? `
        <div class="actions rundown-actions">
          <button class="link-btn" data-edit="${escapeHtml(item.id)}" data-type="rundown">Edit</button>
          <button class="link-btn danger-link" data-delete="${escapeHtml(item.id)}" data-type="rundown">Hapus</button>
        </div>
      ` : ''}
    </article>
  `;
}

function renderLedger(type, title, subtitle) {
  const rows = db[type] || [];
  const total = rows.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const admin = isAdmin();

  return `
    <div class="ledger-intro card">
      <div>
        <p class="section-kicker">${escapeHtml(title).toUpperCase()}</p>
        <h3>${escapeHtml(subtitle || title)}</h3>
        <p class="muted">Setiap item dilengkapi kategori, jumlah, dan foto bukti. Foto dibuka dengan menekan pratinjaunya.</p>
      </div>
      <div class="toolbar toolbar-right">
        <span class="status-pill">${escapeHtml(rows.length)} data · Total ${formatMoney(total)}</span>
        ${admin ? `<button class="btn primary" data-add="${type}">+ Tambah data</button>` : '<span class="status-pill readonly-pill">Mode lihat</span>'}
      </div>
    </div>
    <div class="section">
      <div class="table-wrap">
        ${rows.length ? `
          <table class="table ledger-table">
            <thead>
              <tr>
                <th>Tanggal</th>
                <th>Item</th>
                <th>Kategori</th>
                <th>Jumlah</th>
                <th>Foto bukti</th>
                ${admin ? '<th>Aksi</th>' : ''}
              </tr>
            </thead>
            <tbody>
              ${rows.map((item) => `
                <tr>
                  <td data-label="Tanggal">${escapeHtml(formatDate(item.date))}</td>
                  <td data-label="Item"><b>${escapeHtml(item.item || '-')}</b></td>
                  <td data-label="Kategori">${escapeHtml(item.category || '-')}</td>
                  <td data-label="Jumlah">${formatMoney(item.amount)}</td>
                  <td data-label="Foto bukti">${renderLedgerPhoto(item, type)}</td>
                  ${admin ? `
                  <td data-label="Aksi" class="actions">
                    <button class="link-btn" data-edit="${escapeHtml(item.id)}" data-type="${type}">Edit</button>
                    <button class="link-btn danger-link" data-delete="${escapeHtml(item.id)}" data-type="${type}">Hapus</button>
                  </td>
                  ` : ''}
                </tr>
              `).join('')}
            </tbody>
          </table>
        ` : '<div class="empty">Belum ada data pembelian/konsumsi yang bisa ditampilkan.</div>'}
      </div>
    </div>
  `;
}

/**
 * Receipt thumbnail for a ledger row. `detailIndex` lets the delegated click
 * handler open the full-size photo without embedding base64 in an attribute.
 */
function renderLedgerPhoto(item, type, detailIndex) {
  if (!item.photo) return '<span class="muted">Tanpa foto</span>';
  const index = detailIndex === undefined ? (db[type] || []).findIndex((row) => row.id === item.id) : detailIndex;
  return `
    <button type="button" class="receipt-thumb" data-receipt="${escapeHtml(type)}" data-receipt-index="${index}"
            title="Lihat foto bukti" aria-label="Lihat foto bukti ${escapeHtml(item.item || '')}">
      <img src="${escapeHtml(item.photo)}" alt="Foto bukti ${escapeHtml(item.item || '')}" loading="lazy">
    </button>`;
}

function renderExpenses() {
  return renderLedger('expenses', 'Pembelian barang', 'Rincian pembelian dan foto bukti');
}

function renderConsumption() {
  return renderLedger('consumption', 'Konsumsi', 'Rincian konsumsi dan foto bukti');
}

/** Read-only detail so members can inspect a purchase/consumption item. */
function openLedgerDetail(type, id) {
  const list = db[type] || [];
  const index = id && !/^\d+$/.test(String(id))
    ? list.findIndex((row) => row.id === id)
    : Number(id);
  const item = index >= 0 ? list[index] : null;
  if (!item) return showToast('Data tidak ditemukan. Muat ulang halaman lalu coba lagi.');
  openItemDetailDialog(item, { type, index });
}

function openItemDetailDialog(item, { type, index }) {
  const title = type === 'expenses' ? 'Rincian pembelian barang' : 'Rincian konsumsi';
  const rows = [
    ['Tanggal', formatDate(item.date)],
    ['Item', item.item || '-'],
    ['Kategori', item.category || '-'],
    ['Jumlah', formatMoney(item.amount)],
    ['Bukti foto', item.photo ? 'Foto tersedia' : 'Belum ada foto']
  ].map(([label, value]) => `
    <div class="detail-row"><span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b></div>`).join('');

  const photo = item.photo
    ? `<figure class="receipt-figure">
         <img src="${escapeHtml(item.photo)}" alt="Foto bukti ${escapeHtml(item.item || '')}">
         <figcaption class="muted">Foto bukti pembelian/konsumsi</figcaption>
       </figure>`
    : '<p class="report-note">Belum ada foto bukti untuk item ini.</p>';

  $reportData.__item = { item, type, index };
  openReportDialog(title, `
    <div class="report">
      <div class="detail-grid">${rows}</div>
      ${photo}
      <div class="toolbar">
        <button type="button" class="btn ghost" data-action="receipt-prev">← Sebelumnya</button>
        <button type="button" class="btn ghost" data-action="receipt-next">Berikutnya →</button>
      </div>
      <p class="muted">Halaman rincian ini hanya membaca data; tidak ada perubahan yang dikirim ke Supabase.</p>
    </div>`);
}

/** Prev/next within the same ledger, keeping the detail dialog open. */
function openLedgerDetailStep(step) {
  const current = $reportData.__item;
  if (!current) return;
  const list = db[current.type] || [];
  if (!list.length) return;
  const next = (current.index + step + list.length) % list.length;
  openItemDetailDialog(list[next], { type: current.type, index: next });
}

function renderReports() {
  const allData = [
    ...db.expenses.map((item) => ({ ...item, type: 'Pembelian' })),
    ...db.consumption.map((item) => ({ ...item, type: 'Konsumsi' }))
  ];
  const totalCost = allData.reduce((sum, item) => sum + Number(item.amount || 0), 0);

  return `
    <div class="page-grid">
      <div class="card stat-card"><span class="stat-label">Peserta</span><div class="stat-value">${db.participants.length}</div></div>
      <div class="card stat-card"><span class="stat-label">Agenda rundown</span><div class="stat-value">${db.rundown.length}</div></div>
      <div class="card stat-card"><span class="stat-label">Pembelian</span><div class="stat-value">${db.expenses.length}</div></div>
      <div class="card stat-card"><span class="stat-label">Total biaya</span><div class="stat-value small-title">${formatMoney(totalCost)}</div></div>
    </div>

    <div class="section card">
      <div class="section-head">
        <div><p class="section-kicker">FILE</p><h3>Export reporting</h3></div>
      </div>
      <div class="toolbar">
        <button class="btn primary" data-export="excel">Export Excel</button>
        <button class="btn ghost" data-export="pdf">Export PDF</button>
        <button class="btn ghost" data-export="word">Export Word</button>
      </div>
      <p class="muted">File dibuat dan diunduh lokal dari browser.</p>
    </div>

    <div class="section card">
      <div class="section-head">
        <div><p class="section-kicker">DATA MASUK</p><h3>Import data dari Excel</h3></div>
      </div>
      <div class="toolbar import-toolbar">
        <select id="import-type" aria-label="Jenis data yang diimport">
          <option value="participants">Peserta</option>
          <option value="rundown">Rundown</option>
          <option value="expenses">Pembelian Barang</option>
          <option value="consumption">Konsumsi</option>
        </select>
        <input id="import-file" type="file" accept=".xlsx,.xls,.csv" aria-label="Pilih file Excel" />
        <button class="btn ghost" data-template="true">Download Template</button>
      </div>
      <p class="muted">Untuk rundown, gunakan kolom waktu, agenda, lokasi, PIC, dan catatan. Import hanya tersedia untuk admin.</p>
    </div>
  `;
}

function formFields(type, item = {}) {
  if (type === 'outing') {
    return `
      <label>Tujuan
        <input name="destination" required value="${escapeHtml(item.destination || '')}" />
      </label>
      <label>Tanggal
        <input name="date" type="date" required value="${escapeHtml(item.date || '')}" />
      </label>
      <label class="full-span">Catatan
        <textarea name="description">${escapeHtml(item.description || '')}</textarea>
      </label>
    `;
  }

  if (type === 'participants') {
    return `
      <label>Nama lengkap
        <input name="name" required autocomplete="name" value="${escapeHtml(item.name || '')}" />
      </label>
      <label>Nomor telepon
        <input name="phone" type="tel" inputmode="tel" required autocomplete="tel" placeholder="08xxxxxxxxxx" value="${escapeHtml(item.phone || '')}" />
      </label>
      <label>Status peserta
        <select name="status">
          ${PARTICIPANT_STATUSES.map((option) => `<option value="${option}" ${item.status === option ? 'selected' : ''}>${option}</option>`).join('')}
        </select>
      </label>
      <label>Status pembayaran
        <select name="payment">
          ${PAYMENT_STATUSES.map((option) => `<option value="${option}" ${item.payment === option ? 'selected' : ''}>${option}</option>`).join('')}
        </select>
      </label>
      <p class="form-note full-span">Peserta tidak perlu dibuatkan akun atau password. Data ini hanya digunakan untuk daftar outing.</p>
    `;
  }

  if (type === 'rundown') {
    return `
      <label>Waktu
        <input name="time" type="time" required value="${escapeHtml(item.time || '')}" />
      </label>
      <label>Agenda / kegiatan
        <input name="activity" required value="${escapeHtml(item.activity || '')}" />
      </label>
      <label>Lokasi
        <input name="location" value="${escapeHtml(item.location || '')}" />
      </label>
      <label>PIC / penanggung jawab
        <input name="pic" value="${escapeHtml(item.pic || '')}" />
      </label>
      <label class="full-span">Catatan
        <textarea name="notes" placeholder="Catatan tambahan untuk agenda ini">${escapeHtml(item.notes || '')}</textarea>
      </label>
    `;
  }

  return `
    <label>Tanggal
      <input name="date" type="date" required value="${escapeHtml(item.date || new Date().toISOString().slice(0, 10))}" />
    </label>
    <label>Nama item / menu
      <input name="item" required value="${escapeHtml(item.item || '')}" />
    </label>
    <label>Kategori
      <input name="category" list="category-list" required value="${escapeHtml(item.category || '')}" />
      <datalist id="category-list">
        ${(db.categories || DEFAULT_DB.categories).map((category) => `<option value="${escapeHtml(category)}"></option>`).join('')}
      </datalist>
    </label>
    <label>Jumlah (Rp)
      <input name="amount" type="number" min="0" required value="${escapeHtml(item.amount || 0)}" />
    </label>
    <label class="full-span">Foto bukti
      <input name="photo" type="file" accept="image/*" />
      <small class="muted">Foto akan dikompres otomatis sebelum disimpan.</small>
    </label>
  `;
}

/**
 * <dialog>.showModal() is missing in older browsers; fall back to the `open`
 * attribute so a report is never lost to an exception.
 */
function showDialogElement(dialog) {
  if (!dialog) return;
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
}

function closeDialogElement(dialog) {
  if (!dialog) return;
  if (typeof dialog.close === 'function') dialog.close();
  else dialog.removeAttribute('open');
}

function openDialog(type, id = null) {
  if (!isAdmin()) {
    showToast('Hanya admin yang dapat mengubah data.');
    return;
  }

  editingId = id;
  const item = id
    ? (type === 'outing' ? db.outing : (db[type] || []).find((row) => row.id === id)) || {}
    : {};
  const titlePrefix = id ? 'Edit' : 'Tambah';
  const label = {
    participants: 'Peserta',
    rundown: 'Rundown',
    expenses: 'Pembelian Barang',
    consumption: 'Konsumsi',
    outing: 'Outing'
  }[type] || 'Data';

  $('#dialog-title').textContent = `${titlePrefix} ${label}`;
  $('#data-dialog').dataset.type = type;
  $('#dialog-save').classList.remove('hidden');
  $('#dialog-fields').innerHTML = formFields(type, item);
  showDialogElement($('#data-dialog'));
}

/** Read-only dialog used by the Supabase diagnosis report. */
function openReportDialog(title, html) {
  const dialog = $('#data-dialog');
  if (!dialog) return;
  // showModal() throws when the dialog is already open (e.g. a report triggered
  // while the data form is open), so reopen it deliberately instead.
  if (dialog.open) closeDialogElement(dialog);
  $('#dialog-title').textContent = title;
  dialog.dataset.type = 'report';
  $('#dialog-save').classList.add('hidden');
  $('#dialog-fields').innerHTML = html;
  showDialogElement(dialog);
}

const UPLOAD_STATUS_TAG = { terkirim: 'ok', ditolak: 'bad', dilewati: '' };

/**
 * Upload results in a table, plus the exact reason and next step per table.
 * `report` comes from supabase-sync.js (window.OUTING_SYNC_LAST_UPLOAD).
 */
function renderUploadReport(report) {
  if (!report) {
    return '<div class="report"><p class="report-note">Belum ada percobaan upload pada sesi ini. Klik <b>↻ Upload ke Supabase</b> untuk mencoba; hasilnya akan tampil di sini.</p></div>';
  }

  const rows = report.tables.map((table) => {
    const tag = UPLOAD_STATUS_TAG[table.status] ?? '';
    const extra = table.hint ? `<br><small class="muted">Langkah: ${escapeHtml(table.hint)}</small>` : '';
    return `
    <tr>
      <td><b>${escapeHtml(table.table)}</b></td>
      <td><span class="tag ${tag}">${escapeHtml(table.status)}</span></td>
      <td>${escapeHtml(table.detail)}${extra}</td>
    </tr>`;
  }).join('');

  const counts = report.counts || { failed: 0, skipped: 0, sent: 0 };
  const failedList = report.failedTables.join(', ');
  const conclusion = report.ok
    ? `<p class="report-note ok"><b>Upload diterima server.</b> ${counts.sent} tabel dikirim${counts.skipped ? `, ${counts.skipped} tabel dilewati karena kosong di browser ini` : ''}.</p>`
    : `<p class="report-note bad"><b>Upload ditolak pada ${counts.failed} tabel: ${escapeHtml(failedList)}.</b></p>
       ${report.blockedMessage ? `<p class="report-note">${escapeHtml(report.blockedMessage)}</p>` : ''}
       ${report.tables.find((table) => table.hint) ? `<p class="report-note">Langkah berikutnya: ${escapeHtml(report.tables.find((table) => table.hint).hint)}</p>` : ''}`;

  const session = report.session || {};
  const sessionText = session.active
    ? `Session Supabase aktif sebagai <b>${escapeHtml(session.email || '-')}</b> (role: ${escapeHtml(session.role || 'tidak ada')})`
    : '<b>Tidak ada session Supabase.</b> Login lokal <code>admin / power88</code> hanya membuka aplikasi di browser; policy tulis default menolak role anon, sehingga tabel yang berisi data akan gagal.';

  const adminHint = report.ok || session.role === 'admin'
    ? ''
    : '<p class="report-note">Perbaiki dengan: Supabase → Authentication → Users → Add user (email + password), set <code>app_metadata.role = "admin"</code> lewat SQL Editor, lalu di aplikasi isi form login dengan email/password itu — bukan <code>admin/power88</code>.</p>';

  return `
    <div class="report">
      ${conclusion}
      ${adminHint}
      <p class="muted"><b>Dikirim:</b> ${escapeHtml(new Date(report.at).toLocaleString('id-ID'))}<br>${sessionText}</p>
      <table class="diagnose-table">
        <thead><tr><th>Tabel</th><th>Status</th><th>Keterangan</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p class="muted">Tabel yang kosong di browser ini dilewati: tidak ada yang dikirim dan tidak ada yang dihapus. Baris Supabase yang tidak ada di browser ini <b>dihapus</b> pada tabel yang dikirim.</p>
      <button type="button" class="btn ghost" data-action="copy-upload-report">📋 Salin detail</button>
    </div>`;
}

function uploadReportText(report) {
  const session = report.session || {};
  const lines = report.tables.map((table) => `- ${table.table}: ${table.status.toUpperCase()} — ${table.detail}${table.hint ? ` | langkah: ${table.hint}` : ''}`);
  return [
    `Hasil upload ke Supabase (${new Date(report.at).toLocaleString('id-ID')})`,
    `Status: ${report.ok ? 'diterima' : `ditolak pada ${report.counts?.failed ?? report.failedTables.length} tabel`}`,
    report.blockedMessage ? `Catatan: ${report.blockedMessage}` : '',
    `Login: ${session.active ? `${session.email} (role: ${session.role || 'tidak ada'})` : 'tanpa session Supabase (login lokal)'}`,
    `Dilewati (kosong di browser): ${report.skippedTables.join(', ') || 'tidak ada'}`,
    ...lines
  ].filter(Boolean).join('\n');
}

function openUploadReport(report) {
  const data = report || window.OUTING_SYNC?.lastUpload?.() || window.OUTING_SYNC_LAST_UPLOAD || null;
  if (!data) return showToast('Belum ada detail upload pada sesi ini. Klik Upload ke Supabase dulu.');
  openReportDialog('Hasil Upload ke Supabase', renderUploadReport(data));
}

/** What the next upload will actually send, table by table. */
function uploadPlanText() {
  const counts = [
    ['participants', (db.participants || []).length],
    ['rundown', (db.rundown || []).length],
    ['expenses', (db.expenses || []).length],
    ['consumption', (db.consumption || []).length],
    ['outing_categories', (db.categories || []).length],
    ['outing', 1]
  ];
  const sent = counts.filter(([, total]) => total > 0).map(([name, total]) => `${name} (${total})`);
  const empty = counts.filter(([, total]) => total === 0).map(([name]) => name);
  return `Akan dikirim: ${sent.join(', ') || 'tidak ada data'}${empty.length ? `. Dilewati karena kosong: ${empty.join(', ')}` : ''}.`;
}

/** Keeps the "Detail upload" button in sync with the last upload result. */
function refreshSyncDetailButton() {
  const button = $('#sync-detail');
  if (!button) return;
  const report = window.OUTING_SYNC?.lastUpload?.() || window.OUTING_SYNC_LAST_UPLOAD || null;
  const failed = report?.counts?.failed ?? report?.failedTables?.length ?? 0;
  button.classList.toggle('hidden', !report || !isAdmin());
  if (report) button.textContent = report.ok ? 'ℹ Detail upload' : `⚠ Detail upload (${failed} gagal)`;
}

async function copyUploadReport() {
  const report = window.OUTING_SYNC?.lastUpload?.() || window.OUTING_SYNC_LAST_UPLOAD;
  if (!report) return showToast('Belum ada detail upload untuk disalin.');
  const text = uploadReportText(report);
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
    else throw new Error('clipboard tidak tersedia');
    showToast('Detail upload disalin. Tempelkan ke chat bila perlu bantuan.');
  } catch {
    // Clipboard needs a secure context; show the text instead of failing silently.
    openReportDialog('Detail upload (salin manual)', `<div class="report"><pre style="white-space:pre-wrap;font-size:11px">${escapeHtml(text)}</pre></div>`);
  }
}

function renderDiagnoseReport(report) {
  const statusRow = (ok) => (ok === 'ok'
    ? '<span class="tag ok">OK</span>'
    : ok === 'gagal' ? '<span class="tag bad">Gagal</span>' : '<span class="tag">Belum diuji</span>');

  const rows = report.tables.map((table) => `
    <tr>
      <td><b>${escapeHtml(table.table)}</b><br><small class="muted">lokal: ${table.localRows} baris</small></td>
      <td>${statusRow(table.read)}<br><small class="muted">${escapeHtml(table.readDetail)}</small></td>
      <td>${statusRow(table.write)}<br><small class="muted">${escapeHtml(table.writeDetail)}</small></td>
    </tr>`).join('');

  const sessionText = report.session.active
    ? `Session Supabase aktif sebagai <b>${escapeHtml(report.session.email)}</b> (role: ${escapeHtml(report.session.role || 'tidak ada')})`
    : 'Belum ada session Supabase. Login lokal admin/power88 tidak memberi izin menulis pada policy default.';

  const conclusion = report.ok
    ? '<p class="report-note ok"><b>Permintaan baca berhasil untuk semua tabel.</b> RLS mungkin menyembunyikan baris; penulisan BELUM diuji.</p>'
    : `<p class="report-note bad"><b>Ada ${report.problems.length} tabel dengan masalah baca/skema.</b></p>
       ${report.hint ? `<p class="report-note">Langkah berikutnya: ${escapeHtml(report.hint)}</p>` : ''}`;
  const loginHint = report.session.role !== 'admin'
    ? '<p class="report-note">Untuk mengirim data, buat akun admin di Supabase Authentication dengan app_metadata.role = "admin", lalu login memakai email/password akun itu.</p>'
    : '';

  return `
    <div class="report">
      ${conclusion}
      ${loginHint}
      <p class="muted"><b>Project:</b> ${escapeHtml(report.url)}<br>${sessionText}</p>
      <table class="diagnose-table">
        <thead><tr><th>Tabel</th><th>Baca dari Supabase</th><th>Kirim ke Supabase</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p class="muted">Diagnosis ini hanya membaca: tidak ada data yang dikirim atau dihapus. Untuk menguji tulis, periksa data lokal lalu klik Upload ke Supabase (akan menyamakan seluruh tabel dengan isi browser ini).</p>
    </div>`;
}

function compressImage(file) {
  return new Promise((resolve) => {
    if (!file || !file.type || !file.type.startsWith('image/')) return resolve('');

    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => {
        const maxSize = 1280;
        const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const context = canvas.getContext('2d');
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.72));
      };
      image.onerror = () => resolve('');
      image.src = reader.result;
    };
    reader.onerror = () => resolve('');
    reader.readAsDataURL(file);
  });
}

async function handleFormSubmit(event) {
  if (event.submitter?.value === 'cancel') {
    event.preventDefault();
    closeDialog();
    return;
  }
  event.preventDefault();
  if (!isAdmin()) {
    closeDialog();
    showToast('Hanya admin yang dapat menyimpan perubahan.');
    return;
  }

  const type = $('#data-dialog').dataset.type;
  const formData = new FormData(event.target);
  const values = Object.fromEntries(formData.entries());

  if (type === 'outing') {
    db.outing = {
      id: db.outing.id || '',
      destination: values.destination.trim(),
      date: values.date,
      description: (values.description || '').trim()
    };
    const syncResult = await saveDb();
    closeDialog();
    render();
    showSyncResult(syncResult, 'Data outing berhasil disimpan ke Supabase.');
    return;
  }

  if (type === 'participants') {
    const existing = db.participants.find((participant) => participant.id === editingId);
    const participant = normaliseParticipant({
      id: editingId || createId('p'),
      name: values.name,
      phone: values.phone,
      status: values.status,
      payment: values.payment
    });

    if (existing) Object.assign(existing, participant);
    else db.participants.push(participant);
  } else if (type === 'rundown') {
    const agenda = normaliseRundown({
      id: editingId || createId('r'),
      time: values.time,
      activity: values.activity,
      location: values.location,
      pic: values.pic,
      notes: values.notes
    });
    const index = db.rundown.findIndex((row) => row.id === editingId);
    if (index >= 0) db.rundown[index] = agenda;
    else db.rundown.push(agenda);
  } else {
    const current = (db[type] || []).find((row) => row.id === editingId);
    const photoInput = formData.get('photo');
    const photo = photoInput instanceof File && photoInput.size
      ? await compressImage(photoInput)
      : (current?.photo || '');
    const category = (values.category || '').trim();
    if (category && !db.categories.includes(category)) db.categories.push(category);
    const ledgerItem = normaliseLedgerItem({
      id: editingId || createId(type === 'expenses' ? 'e' : 'c'),
      date: values.date,
      item: values.item,
      category,
      amount: Number(values.amount || 0),
      photo
    });
    const list = db[type] || [];
    const index = list.findIndex((row) => row.id === editingId);
    if (index >= 0) list[index] = ledgerItem;
    else list.push(ledgerItem);
    db[type] = list;
  }

  const syncResult = await saveDb();
  closeDialog();
  render();
  showSyncResult(syncResult);
}

function closeDialog() {
  const dialog = $('#data-dialog');
  if (dialog?.open) closeDialogElement(dialog);
  $('#data-form')?.reset();
  editingId = null;
}

async function deleteData(type, id) {
  if (!isAdmin()) {
    showToast('Hanya admin yang dapat menghapus data.');
    return;
  }
  if (!confirm('Apakah Anda yakin ingin menghapus data ini?')) return;

  if (type === 'participants') db.participants = db.participants.filter((item) => item.id !== id);
  else db[type] = (db[type] || []).filter((item) => item.id !== id);
  const syncResult = await saveDb();
  render();
  showSyncResult(syncResult, 'Data berhasil dihapus dari Supabase.');
}

function exportReport(kind) {
  if (!isAdmin()) {
    showToast('Hanya admin yang dapat export data.');
    return;
  }
  const allData = [
    ...db.expenses.map((item) => ({ ...item, type: 'Pembelian' })),
    ...db.consumption.map((item) => ({ ...item, type: 'Konsumsi' }))
  ];

  if (kind === 'excel') {
    if (!window.XLSX) return showToast('Library Excel belum tersedia.');
    const workbook = XLSX.utils.book_new();
    const appendSheet = (name, rows) => {
      const sheet = XLSX.utils.json_to_sheet(rows);
      XLSX.utils.book_append_sheet(workbook, sheet, name);
    };
    appendSheet('Ringkasan', [{
      Tujuan: db.outing.destination || '',
      Tanggal: db.outing.date || '',
      Deskripsi: db.outing.description || ''
    }]);
    appendSheet('Peserta', db.participants.map((item) => ({
      Nama: item.name,
      'Nomor Telepon': item.phone,
      Status: item.status,
      'Status Pembayaran': item.payment
    })));
    appendSheet('Rundown', sortedRundown().map((item) => ({
      Waktu: item.time,
      Agenda: item.activity,
      Lokasi: item.location,
      PIC: item.pic,
      Catatan: item.notes
    })));
    appendSheet('Biaya', allData.map((item) => ({
      Tipe: item.type,
      Tanggal: item.date,
      Item: item.item,
      Kategori: item.category,
      Jumlah: item.amount
    })));
    XLSX.writeFile(workbook, 'report-outing.xlsx');
    return;
  }

  if (kind === 'pdf') {
    if (!window.jspdf) return showToast('Library PDF belum tersedia.');
    const { jsPDF } = window.jspdf;
    const documentPdf = new jsPDF();
    documentPdf.setFontSize(16);
    documentPdf.text('Report Outing', 14, 18);
    documentPdf.setFontSize(11);
    documentPdf.text(`Tujuan: ${db.outing.destination || '-'}`, 14, 28);
    documentPdf.text(`Tanggal: ${formatDate(db.outing.date)}`, 14, 35);
    let y = 48;
    allData.forEach((item, index) => {
      if (y > 280) {
        documentPdf.addPage();
        y = 18;
      }
      documentPdf.text(`${index + 1}. ${item.type} - ${item.item} - ${item.category} - ${formatMoney(item.amount)}`, 14, y);
      y += 8;
    });
    documentPdf.save('report-outing.pdf');
    return;
  }

  const html = `
    <html><body>
      <h1>Report Outing</h1>
      <p>Tujuan: ${escapeHtml(db.outing.destination || '')}</p>
      <table border="1" cellpadding="6" cellspacing="0">
        <tr><th>Type</th><th>Item</th><th>Kategori</th><th>Tanggal</th><th>Jumlah</th></tr>
        ${allData.map((item) => `<tr><td>${escapeHtml(item.type)}</td><td>${escapeHtml(item.item)}</td><td>${escapeHtml(item.category)}</td><td>${escapeHtml(item.date)}</td><td>${escapeHtml(formatMoney(item.amount))}</td></tr>`).join('')}
      </table>
    </body></html>
  `;
  const blob = new Blob([html], { type: 'application/msword' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'report-outing.doc';
  anchor.click();
  URL.revokeObjectURL(url);
}

function downloadTemplate(typeOverride = null) {
  if (!isAdmin()) {
    showToast('Hanya admin yang dapat mengunduh template.');
    return;
  }
  if (!window.XLSX) return showToast('Library Excel belum tersedia.');
  const type = typeOverride || $('#import-type')?.value || 'participants';
  const templates = {
    participants: {
      headers: ['name', 'phone', 'status', 'payment'],
      sample: ['Contoh Nama', '081234567890', 'Ikut', 'Belum bayar']
    },
    rundown: {
      headers: ['time', 'activity', 'location', 'pic', 'notes'],
      sample: ['08:00', 'Contoh agenda', 'Lokasi kegiatan', 'Panitia', 'Catatan agenda']
    },
    expenses: {
      headers: ['date', 'item', 'category', 'amount'],
      sample: ['2026-10-08', 'Contoh item', 'Perlengkapan', '250000']
    },
    consumption: {
      headers: ['date', 'item', 'category', 'amount'],
      sample: ['2026-10-08', 'Contoh menu', 'Makanan', '150000']
    }
  };
  const template = templates[type] || templates.participants;
  const sheet = XLSX.utils.aoa_to_sheet([template.headers, template.sample]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, type);
  XLSX.writeFile(workbook, `template-${type}.xlsx`);
}

function getImportValue(row, keys) {
  const entries = Object.entries(row || {});
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== '') return row[key];
    const target = key.toLowerCase().replace(/[\s_.-]/g, '');
    const found = entries.find(([name, value]) => name.toLowerCase().replace(/[\s_.-]/g, '') === target && value !== '');
    if (found) return found[1];
  }
  return '';
}

function importExcelFile(file, type) {
  if (!isAdmin()) {
    showToast('Hanya admin yang dapat import data.');
    return;
  }
  if (!file) return;
  if (!window.XLSX) {
    showToast('Library Excel belum tersedia.');
    return;
  }

  const reader = new FileReader();
  reader.onload = async (event) => {
    try {
      const workbook = XLSX.read(event.target.result, { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
      if (!rows.length) {
        showToast('File Excel kosong.');
        return;
      }

      let imported = 0;
      if (type === 'participants') {
        rows.forEach((row) => {
          const participant = normaliseParticipant({
            id: createId('p'),
            name: getImportValue(row, ['name', 'Nama', 'nama']),
            phone: getImportValue(row, ['phone', 'nomor_telepon', 'Nomor Telepon', 'telepon', 'No Telepon', 'No. Telp', 'Nomor HP', 'member_id']),
            status: getImportValue(row, ['status', 'Status']) || 'Ikut',
            payment: getImportValue(row, ['payment', 'Status Pembayaran', 'status_pembayaran']) || 'Belum bayar'
          });
          if (participant.name && participant.phone) {
            if (!PARTICIPANT_STATUSES.includes(participant.status)) participant.status = 'Ikut';
            if (!PAYMENT_STATUSES.includes(participant.payment)) participant.payment = 'Belum bayar';
            db.participants.push(participant);
            imported += 1;
          }
        });
      } else if (type === 'rundown') {
        rows.forEach((row) => {
          const agenda = normaliseRundown({
            id: createId('r'),
            time: getImportValue(row, ['time', 'Waktu', 'waktu']),
            activity: getImportValue(row, ['activity', 'agenda', 'Agenda', 'kegiatan', 'Kegiatan']),
            location: getImportValue(row, ['location', 'Lokasi', 'lokasi']),
            pic: getImportValue(row, ['pic', 'PIC', 'person_in_charge', 'Penanggung Jawab']),
            notes: getImportValue(row, ['notes', 'Catatan', 'catatan'])
          });
          if (agenda.time && agenda.activity) {
            db.rundown.push(agenda);
            imported += 1;
          }
        });
      } else {
        rows.forEach((row) => {
          const item = normaliseLedgerItem({
            id: createId(type === 'expenses' ? 'e' : 'c'),
            date: getImportValue(row, ['date', 'Tanggal', 'tanggal']),
            item: getImportValue(row, ['item', 'Item', 'Nama', 'menu']),
            category: getImportValue(row, ['category', 'Kategori', 'kategori']),
            amount: Number(getImportValue(row, ['amount', 'Jumlah', 'jumlah']) || 0),
            photo: ''
          });
          if (item.date && item.item && item.category) {
            if (!db.categories.includes(item.category)) db.categories.push(item.category);
            db[type].push(item);
            imported += 1;
          }
        });
      }

      const syncResult = await saveDb();
      render();
      showSyncResult(syncResult, `${imported} dari ${rows.length} data berhasil diimport ke Supabase.`);
    } catch (error) {
      console.error(error);
      showToast('Format file tidak valid. Cek template Excel Anda.');
    }
  };
  reader.readAsArrayBuffer(file);
}

function closeMobileMenu() {
  document.body.classList.remove('menu-open');
}

function applyRemoteData() {
  db = loadDb();
  if (session) render();
}

document.addEventListener('outing:remote-ready', applyRemoteData);
if (window.OUTING_REMOTE_READY) applyRemoteData();
if (window.OUTING_SYNC_READY) window.OUTING_SYNC_READY.then(applyRemoteData);

const loginForm = $('#login-form');
if (loginForm) loginForm.addEventListener('submit', login);

$('#logout')?.addEventListener('click', () => {
  window.OUTING_LOCAL_LOGIN = true;
  window.OUTING_SYNC?.client?.auth.signOut({ scope: 'local' }).catch((error) => console.warn('Gagal keluar dari Supabase:', error));
  session = null;
  currentPage = 'dashboard';
  closeMobileMenu();
  $('#app').classList.add('hidden');
  $('#login-screen').classList.remove('hidden');
  $('#login-form').reset();
});

$('#navigation')?.addEventListener('click', (event) => {
  const item = event.target.closest('[data-page]');
  if (!item) return;
  const page = item.dataset.page;
  if (ADMIN_PAGES.includes(page) && !isAdmin()) {
    showToast('Halaman ini hanya dapat diakses admin.');
    return;
  }
  currentPage = page;
  render();
  closeMobileMenu();
});

$('#mobile-menu-toggle')?.addEventListener('click', () => {
  document.body.classList.toggle('menu-open');
});
$('#menu-backdrop')?.addEventListener('click', closeMobileMenu);

$('#quick-add')?.addEventListener('click', () => {
  if (!isAdmin()) return showToast('Hanya admin yang dapat menambah data.');
  const type = ADDABLE_PAGES.includes(currentPage) ? currentPage : 'participants';
  openDialog(type);
});

$('#sync-diagnose')?.addEventListener('click', async () => {
  if (!isAdmin()) return showToast('Hanya admin yang dapat memeriksa Supabase.');
  if (!window.OUTING_SYNC?.diagnose) {
    const detail = window.OUTING_SYNC_ERROR?.message ? ` (${window.OUTING_SYNC_ERROR.message})` : '';
    return showToast(`Supabase belum terhubung${detail}. Cek config.js dan koneksi ke CDN.`);
  }

  const button = $('#sync-diagnose');
  button.disabled = true;
  button.textContent = '🩺 Memeriksa...';
  try {
    const report = await window.OUTING_SYNC.diagnose(db);
    console.table(report.tables.map(({ table, read, remoteRows, write, readDetail, writeDetail }) => ({
      table, read, remoteRows, write, readDetail, writeDetail
    })));
    openReportDialog('Diagnosa Supabase', renderDiagnoseReport(report));
    if (report.ok) {
      showToast('Permintaan baca berhasil; RLS mungkin menyembunyikan baris. Tulis belum diuji.');
    } else {
      showToast(`${report.problems.length} tabel bermasalah saat dibaca. Lihat jendela diagnosa.`);
    }
  } catch (error) {
    console.error(error);
    showToast('Diagnosa gagal dijalankan. Lihat Console browser.');
  } finally {
    button.disabled = false;
    button.textContent = '🩺 Cek Supabase';
  }
});

$('#sync-load')?.addEventListener('click', async () => {
  if (!session) return;
  if (!window.OUTING_SYNC?.load) return showToast('Supabase belum terhubung. Cek konfigurasi dan koneksi.');
  if (!confirm('Muat data dari Supabase? Semua data lokal di browser ini, termasuk yang BELUM terupload, akan diganti. Batalkan jika belum membuat cadangan.')) return;
  const button = $('#sync-load');
  button.disabled = true;
  button.textContent = '↓ Memuat...';
  try {
    const result = await window.OUTING_SYNC.load({ replaceLocal: true });
    if (result?.ok && result.loaded) showToast('Data lokal diganti dengan data dari Supabase.');
    else if (!result?.superseded) showToast(`Gagal memuat Supabase: ${result?.error?.message || 'periksa koneksi dan skema'}.`);
  } finally {
    button.disabled = false;
    button.textContent = '↓ Muat dari Supabase';
  }
});

$('#sync-now')?.addEventListener('click', async () => {
  if (!isAdmin()) return showToast('Hanya admin yang dapat upload data.');
  if (!window.OUTING_SYNC?.queue) return showToast('Supabase belum terhubung. Cek konfigurasi dan koneksi.');
  // Show exactly what will be sent and with which login, so a later "only some
  // tables failed" message is easy to understand.
  const loginNote = session?.local
    ? 'Login saat ini LOKAL (admin/power88), bukan akun Supabase: policy tulis default akan menolak upload.'
    : `Login Supabase: ${session?.name || 'tidak diketahui'}.`;
  if (!confirm(`Upload akan mengirim seluruh data lokal ke tabel Supabase dan MENGHAPUS baris Supabase yang tidak ada di browser ini.\n\n${uploadPlanText()}\n${loginNote}\n\nUpload sekarang?`)) return;
  const button = $('#sync-now');
  button.disabled = true;
  button.textContent = '⟳ Mengupload...';
  try {
    const result = await window.OUTING_SYNC.queue(db);
    showSyncResult(result, 'Semua data berhasil diupload ke Supabase.', { openReport: true });
  } catch (error) {
    console.error('Upload Supabase gagal:', error);
    showToast('Upload gagal. Data lokal dipertahankan.');
  } finally {
    button.disabled = false;
    button.textContent = '↻ Upload ke Supabase';
    refreshSyncDetailButton();
  }
});

$('#sync-detail')?.addEventListener('click', () => openUploadReport());

$('#data-form')?.addEventListener('submit', handleFormSubmit);
$('#data-dialog')?.addEventListener('click', (event) => {
  if (event.target === $('#data-dialog') && event.target.open) closeDialog();
});

// Buttons inside dynamically rendered pages use delegated events.
document.addEventListener('click', (event) => {
  const addButton = event.target.closest('[data-add]');
  if (addButton) openDialog(addButton.dataset.add);

  const editButton = event.target.closest('[data-edit]');
  if (editButton) openDialog(editButton.dataset.type, editButton.dataset.edit);

  const deleteButton = event.target.closest('[data-delete]');
  if (deleteButton) deleteData(deleteButton.dataset.type, deleteButton.dataset.delete);

  const exportButton = event.target.closest('[data-export]');
  if (exportButton) exportReport(exportButton.dataset.export);

  const templateButton = event.target.closest('[data-template]');
  if (templateButton) downloadTemplate();

  const templateTypeButton = event.target.closest('[data-template-type]');
  if (templateTypeButton) downloadTemplate(templateTypeButton.dataset.templateType);

  const copyReportButton = event.target.closest('[data-action="copy-upload-report"]');
  if (copyReportButton) copyUploadReport();

  if (event.target.closest('[data-action="go-outing"]')) {
    currentPage = 'outing';
    render();
  }
  if (event.target.closest('[data-action="go-rundown"]')) {
    currentPage = 'rundown';
    render();
  }
  if (event.target.closest('[data-action="go-expenses"]')) {
    currentPage = 'expenses';
    render();
  }
  if (event.target.closest('[data-action="go-consumption"]')) {
    currentPage = 'consumption';
    render();
  }

  const receiptButton = event.target.closest('[data-receipt]');
  if (receiptButton) openLedgerDetail(receiptButton.dataset.receipt, receiptButton.dataset.receiptIndex);

  if (event.target.closest('[data-action="receipt-prev"]')) openLedgerDetailStep(-1);
  if (event.target.closest('[data-action="receipt-next"]')) openLedgerDetailStep(1);
});

document.addEventListener('input', (event) => {
  if (event.target.id !== 'participant-search') return;
  const term = event.target.value.toLowerCase().trim();
  const filtered = db.participants.filter((participant) => `${participant.name} ${participant.phone}`.toLowerCase().includes(term));
  const table = $('#participant-table');
  if (table) table.innerHTML = renderParticipantTable(filtered, true);
});

document.addEventListener('change', (event) => {
  if (event.target.id === 'import-file' && event.target.files[0]) {
    importExcelFile(event.target.files[0], $('#import-type')?.value || 'participants');
    event.target.value = '';
  }
  if (event.target.id === 'rundown-import-file' && event.target.files[0]) {
    importExcelFile(event.target.files[0], 'rundown');
    event.target.value = '';
  }
});

// config.js normally defines this. Keep a safe fallback without replacing its values.
window.OUTING_CONFIG = window.OUTING_CONFIG || {
  SUPABASE_URL: '',
  SUPABASE_ANON_KEY: '',
  STORAGE_BUCKET: 'outing-receipts'
};

if ($('#login-form')) $('#login-form').reset();
