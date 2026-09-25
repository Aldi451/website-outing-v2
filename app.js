const APP_STORAGE_KEY = 'outing-hub-v1';
const DEFAULT_ADMIN = { userId: 'admin', password: 'power88' };
const DEFAULT_MEMBER = { userId: 'member', password: 'member' };
const PARTICIPANT_STATUSES = ['Ikut', 'Batal ikut', 'Tidak ikut'];
const PAYMENT_STATUSES = ['Belum bayar', 'Bayar sebagian', 'Sudah bayar'];
const ADMIN_PAGES = ['participants', 'expenses', 'consumption', 'reports'];
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
    categories: Array.isArray(source.categories) && source.categories.length
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
  localStorage.setItem(APP_STORAGE_KEY, JSON.stringify(db));
  if (window.OUTING_SYNC?.queue) return window.OUTING_SYNC.queue(db);
  return Promise.resolve({ ok: true, localOnly: true });
}

function showSyncResult(result, successMessage = 'Data berhasil disimpan ke Supabase.') {
  if (result?.ok && !result.localOnly) {
    showToast(successMessage);
  } else if (result?.ok) {
    showToast('Data tersimpan di browser. Supabase belum dikonfigurasi.');
  } else {
    showToast('Data tersimpan lokal, tetapi belum masuk ke Supabase. Cek koneksi atau RLS.');
  }
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

function login(event) {
  event.preventDefault();
  const userId = $('#login-id').value.trim();
  const password = $('#login-password').value;

  if (userId === DEFAULT_ADMIN.userId && password === DEFAULT_ADMIN.password) {
    session = { role: 'admin', name: 'Administrator' };
    startApp();
    return;
  }

  // A viewer uses one shared read-only login; participants no longer need accounts.
  if (userId === DEFAULT_MEMBER.userId && password === DEFAULT_MEMBER.password) {
    session = { role: 'member', name: 'Peserta' };
    startApp();
    return;
  }

  const config = window.OUTING_CONFIG || {};
  if (config.SUPABASE_URL && config.SUPABASE_ANON_KEY && window.supabase) {
    const authClient = window.OUTING_SYNC?.client || window.supabase.createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY);
    authClient.auth.signInWithPassword({ email: userId, password })
      .then(({ data, error }) => {
        if (!error && data?.user) {
          const role = data.user.app_metadata?.role;
          if (role !== 'admin') {
            authClient.auth.signOut();
            showToast('Akun Supabase ini belum memiliki role admin.');
            return;
          }
          session = { role: 'admin', name: data.user.email || 'Admin Supabase' };
          startApp();
          // Re-read Supabase using the authenticated session before the next input.
          window.OUTING_SYNC?.load?.();
          return;
        }
        showToast('User ID atau password tidak sesuai.');
      })
      .catch(() => showToast('Login gagal. Cek konfigurasi Supabase Anda.'));
    return;
  }

  showToast('User ID atau password tidak sesuai.');
}

function startApp() {
  $('#login-screen').classList.add('hidden');
  $('#app').classList.remove('hidden');
  $('#profile-name').textContent = getLoggedUserName();
  $('#profile-role').textContent = isAdmin() ? 'Administrator' : 'Mode lihat';
  $('#avatar').textContent = isAdmin() ? 'A' : 'P';
  closeMobileMenu();
  render();
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
        ${renderParticipantTable(participants.slice(0, 6), isAdmin())}
      </div>
    </div>
  `;
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

function renderLedger(type, title) {
  const rows = db[type] || [];
  const total = rows.reduce((sum, item) => sum + Number(item.amount || 0), 0);

  return `
    <div class="page-toolbar toolbar">
      <div>
        <p class="section-kicker">${escapeHtml(title).toUpperCase()}</p>
        <h3 class="toolbar-title">${escapeHtml(rows.length)} data tersimpan</h3>
      </div>
      <div class="toolbar toolbar-right">
        <span class="status-pill">Total ${formatMoney(total)}</span>
        <button class="btn primary" data-add="${type}">+ Tambah data</button>
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
                <th>Foto</th>
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map((item) => `
                <tr>
                  <td data-label="Tanggal">${escapeHtml(formatDate(item.date))}</td>
                  <td data-label="Item"><b>${escapeHtml(item.item || '-')}</b></td>
                  <td data-label="Kategori">${escapeHtml(item.category || '-')}</td>
                  <td data-label="Jumlah">${formatMoney(item.amount)}</td>
                  <td data-label="Foto">${item.photo ? '<span class="badge success">Ada foto</span>' : '-'}</td>
                  <td data-label="Aksi" class="actions">
                    <button class="link-btn" data-edit="${escapeHtml(item.id)}" data-type="${type}">Edit</button>
                    <button class="link-btn danger-link" data-delete="${escapeHtml(item.id)}" data-type="${type}">Hapus</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        ` : '<div class="empty">Belum ada data.</div>'}
      </div>
    </div>
  `;
}

function renderExpenses() {
  return renderLedger('expenses', 'Pembelian barang');
}

function renderConsumption() {
  return renderLedger('consumption', 'Konsumsi');
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
  $('#dialog-fields').innerHTML = formFields(type, item);
  $('#data-dialog').showModal();
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
  if (dialog?.open) dialog.close();
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
  window.OUTING_SYNC?.client?.auth.signOut();
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

$('#sync-now')?.addEventListener('click', async () => {
  if (!isAdmin()) return showToast('Hanya admin yang dapat upload data.');
  if (!window.OUTING_SYNC?.queue) {
    showToast('Supabase belum terhubung. Cek konfigurasi dan koneksi.');
    return;
  }
  const button = $('#sync-now');
  button.disabled = true;
  button.textContent = '⟳ Mengupload...';
  const result = await window.OUTING_SYNC.queue(db);
  button.disabled = false;
  button.textContent = '↻ Upload ke Supabase';
  showSyncResult(result, 'Semua data berhasil diupload ke Supabase.');
});

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

  if (event.target.closest('[data-action="go-outing"]')) {
    currentPage = 'outing';
    render();
  }
  if (event.target.closest('[data-action="go-rundown"]')) {
    currentPage = 'rundown';
    render();
  }
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
