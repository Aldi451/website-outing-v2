// 1) User defaults
const APP_STORAGE_KEY = 'outing-hub-v1';
const DEFAULT_ADMIN = { userId: 'admin', password: 'power88' };
const DEFAULT_DB = {
  participants: [
    { id: 'p1', name: 'Budi Santoso', member_id: 'MBR001', member_password: 'member123', status: 'Ikut', payment: 'Sudah bayar' },
    { id: 'p2', name: 'Siti Aminah', member_id: 'MBR002', member_password: 'member123', status: 'Ikut', payment: 'Bayar sebagian' },
    { id: 'p3', name: 'Andi Wijaya', member_id: 'MBR003', member_password: 'member123', status: 'Batal ikut', payment: 'Belum bayar' }
  ],
  outing: {
    destination: 'Bandung, Jawa Barat',
    date: '2026-10-18',
    description: 'Outing tahunan tim internal dengan agenda edukasi dan liburan.'
  },
  expenses: [
    { id: 'e1', date: '2026-10-05', item: 'Transportasi bus', category: 'Transportasi', amount: 2500000, photo: '' },
    { id: 'e2', date: '2026-10-05', item: 'Perlengkapan acara', category: 'Perlengkapan', amount: 1500000, photo: '' }
  ],
  consumption: [
    { id: 'c1', date: '2026-10-06', item: 'Nasi box', category: 'Makanan', amount: 980000, photo: '' },
    { id: 'c2', date: '2026-10-06', item: 'Air mineral', category: 'Minuman', amount: 320000, photo: '' }
  ],
  categories: ['Transportasi','Perlengkapan','ATK','Makanan','Minuman','Lainnya']
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

let db = loadDb();
let session = null;
let currentPage = 'dashboard';
let editingId = null;

function loadDb() {
  try {
    const raw = localStorage.getItem(APP_STORAGE_KEY);
    if (!raw) return structuredClone(DEFAULT_DB);
    const parsed = JSON.parse(raw);
    return {
      participants: Array.isArray(parsed.participants) ? parsed.participants : [],
      outing: parsed.outing || DEFAULT_DB.outing,
      expenses: Array.isArray(parsed.expenses) ? parsed.expenses : [],
      consumption: Array.isArray(parsed.consumption) ? parsed.consumption : [],
      categories: Array.isArray(parsed.categories) && parsed.categories.length ? parsed.categories : DEFAULT_DB.categories
    };
  } catch {
    return structuredClone(DEFAULT_DB);
  }
}

function saveDb() {
  localStorage.setItem(APP_STORAGE_KEY, JSON.stringify(db));
}

function showToast(msg) {
  const toast = $('#toast');
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2400);
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

function statusBadge(value) {
  const label = String(value || '-');
  let type = 'neutral';
  if (/ikut|sudah bayar/i.test(label)) type = 'success';
  if (/batal|sebagian/i.test(label)) type = 'warning';
  if (/tidak ikut|belum bayar/i.test(label)) type = 'danger';
  return `<span class="badge ${type}">${escapeHtml(label)}</span>`;
}

function getParticipantByMemberId(memberId) {
  return db.participants.find((item) => item.member_id && item.member_id.toLowerCase() === String(memberId || '').toLowerCase());
}

function getLoggedUserName() {
  if (!session) return 'Guest';
  return session.role === 'admin' ? 'Administrator' : session.name;
}

function login(e) {
  e.preventDefault();
  const userId = $('#login-id').value.trim();
  const pass = $('#login-password').value;

  if (userId === DEFAULT_ADMIN.userId && pass === DEFAULT_ADMIN.password) {
    session = { role: 'admin', name: 'Administrator' };
    startApp();
    return;
  }

  const member = getParticipantByMemberId(userId);
  if (member && member.member_password && member.member_password === pass) {
    session = { role: 'member', name: member.name, memberId: member.member_id };
    startApp();
    return;
  }

  if (window.OUTING_CONFIG && window.OUTING_CONFIG.SUPABASE_URL && window.OUTING_CONFIG.SUPABASE_ANON_KEY && window.supabase) {
    window.supabase.createClient(window.OUTING_CONFIG.SUPABASE_URL, window.OUTING_CONFIG.SUPABASE_ANON_KEY)
      .auth.signInWithPassword({ email: userId, password: pass })
      .then(({ data, error }) => {
        if (!error && data?.user) {
          session = { role: 'admin', name: data.user.email || 'Admin Supabase' };
          startApp();
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
  $('#profile-role').textContent = session.role === 'admin' ? 'Administrator' : 'Peserta';
  $('#avatar').textContent = session.role === 'admin' ? 'A' : (session.name || 'P').charAt(0).toUpperCase();
  render();
}

function render() {
  const titles = {
    dashboard: 'Dashboard',
    participants: 'Data Peserta',
    outing: 'Data Outing',
    expenses: 'Pembelian Barang',
    consumption: 'Konsumsi',
    reports: 'Reporting & Import'
  };

  $('#page-title').textContent = titles[currentPage];
  $$('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.page === currentPage));

  const handlers = {
    dashboard: renderDashboard,
    participants: renderParticipants,
    outing: renderOuting,
    expenses: renderExpenses,
    consumption: renderConsumption,
    reports: renderReports
  };

  $('#page-content').innerHTML = handlers[currentPage]();

  if (session?.role !== 'admin') {
    $$('.admin-only').forEach((item) => item.classList.add('hidden'));
  }
}

function renderDashboard() {
  const totalPeserta = db.participants.length;
  const ikut = db.participants.filter((p) => p.status === 'Ikut').length;
  const sudahBayar = db.participants.filter((p) => p.payment === 'Sudah bayar').length;

  return `
    <div class="page-grid">
      <div class="card">
        <span class="stat-icon">♙</span>
        <span class="stat-label">Total peserta</span>
        <div class="stat-value">${totalPeserta}</div>
      </div>
      <div class="card">
        <span class="stat-icon">✓</span>
        <span class="stat-label">Peserta ikut</span>
        <div class="stat-value">${ikut}</div>
      </div>
      <div class="card">
        <span class="stat-icon">◷</span>
        <span class="stat-label">Sudah bayar</span>
        <div class="stat-value">${sudahBayar}</div>
      </div>
      <div class="card">
        <span class="stat-icon">⌖</span>
        <span class="stat-label">Tujuan outing</span>
        <div class="stat-value small-title">${escapeHtml(db.outing.destination || '-')}</div>
      </div>
    </div>

    <div class="section">
      <div class="section-head">
        <h3>Ringkasan outing</h3>
        <button class="link-btn" data-action="go-outing">Lihat detail →</button>
      </div>
      <div class="card">
        <div class="info">
          <b>${escapeHtml(db.outing.destination || 'Tujuan belum diatur')}</b> · ${escapeHtml(db.outing.date || 'Tanggal belum diatur')}<br>
          ${escapeHtml(db.outing.description || 'Tambahkan informasi outing untuk memulai.')}
        </div>
      </div>
    </div>

    <div class="section">
      <div class="section-head">
        <h3>Status pembayaran peserta</h3>
      </div>
      <div class="table-wrap">
        ${renderParticipantTable(db.participants.slice(0, 6), true)}
      </div>
    </div>
  `;
}

function renderParticipants() {
  return `
    <div class="toolbar">
      <input id="participant-search" class="search" placeholder="Cari nama atau member ID..." />
      <button class="btn primary" data-add="participants">+ Tambah peserta</button>
    </div>
    <div class="section">
      <div class="table-wrap" id="participant-table">
        ${renderParticipantTable(db.participants, true)}
      </div>
    </div>
  `;
}

function renderParticipantTable(rows, showActions = true) {
  if (!rows.length) {
    return '<div class="empty">Belum ada data peserta.</div>';
  }

  const rowsHtml = rows.map((p) => `
    <tr>
      <td><b>${escapeHtml(p.name)}</b></td>
      <td>${escapeHtml(p.member_id || '-')}</td>
      <td>${statusBadge(p.status)}</td>
      <td>${statusBadge(p.payment)}</td>
      ${showActions ? `
        <td class="actions">
          <button class="link-btn" data-edit="${p.id}" data-type="participants">Edit</button>
          <button class="link-btn" data-delete="${p.id}" data-type="participants">Hapus</button>
        </td>
      ` : ''}
    </tr>
  `).join('');

  return `
    <table class="table">
      <thead>
        <tr>
          <th>Nama</th>
          <th>Member ID</th>
          <th>Status peserta</th>
          <th>Status pembayaran</th>
          ${showActions ? '<th>Aksi</th>' : ''}
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>
  `;
}

function renderOuting() {
  const outing = db.outing || { destination: '', date: '', description: '' };
  return `
    <div class="card">
      <div class="section-head">
        <h3>Informasi tujuan outing</h3>
        ${session && session.role === 'admin' ? '<button class="btn primary" data-edit="outing" data-type="outing">Edit outing</button>' : ''}
      </div>
      <div class="form-grid">
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
    ${session?.role === 'member' ? `
      <div class="section">
        <div class="info">Halo ${escapeHtml(session.name)}, silakan hubungi admin jika ingin mengubah status keikutsertaan atau pembayaran.</div>
      </div>
    ` : ''}
  `;
}

function renderLedger(type, title) {
  const rows = db[type] || [];
  const total = rows.reduce((sum, item) => sum + Number(item.amount || 0), 0);

  return `
    <div class="toolbar">
      <button class="btn primary" data-add="${type}">+ Tambah data</button>
      <span class="status-pill">Total ${formatMoney(total)}</span>
    </div>
    <div class="section">
      <div class="table-wrap">
        ${rows.length ? `
          <table class="table">
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
                  <td>${escapeHtml(item.date || '-')}</td>
                  <td><b>${escapeHtml(item.item || '-')}</b></td>
                  <td>${escapeHtml(item.category || '-')}</td>
                  <td>${formatMoney(item.amount)}</td>
                  <td>${item.photo ? '<span class="badge success">Ada foto</span>' : '-'}</td>
                  <td class="actions">
                    <button class="link-btn" data-edit="${item.id}" data-type="${type}">Edit</button>
                    <button class="link-btn" data-delete="${item.id}" data-type="${type}">Hapus</button>
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
  return renderLedger('expenses', 'Pembelian Barang');
}

function renderConsumption() {
  return renderLedger('consumption', 'Konsumsi');
}

function renderReports() {
  const allData = [
    ...db.expenses.map((item) => ({ ...item, type: 'Pembelian' })),
    ...db.consumption.map((item) => ({ ...item, type: 'Konsumsi' }))
  ];
  const totalBiaya = allData.reduce((sum, item) => sum + Number(item.amount || 0), 0);

  return `
    <div class="page-grid">
      <div class="card">
        <span class="stat-label">Peserta</span>
        <div class="stat-value">${db.participants.length}</div>
      </div>
      <div class="card">
        <span class="stat-label">Pembelian</span>
        <div class="stat-value">${db.expenses.length}</div>
      </div>
      <div class="card">
        <span class="stat-label">Konsumsi</span>
        <div class="stat-value">${db.consumption.length}</div>
      </div>
      <div class="card">
        <span class="stat-label">Total biaya</span>
        <div class="stat-value small-title">${formatMoney(totalBiaya)}</div>
      </div>
    </div>

    <div class="section card">
      <div class="section-head">
        <h3>Export reporting</h3>
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
        <h3>Import data dari Excel</h3>
      </div>
      <div class="toolbar">
        <select id="import-type">
          <option value="participants">Peserta</option>
          <option value="expenses">Pembelian Barang</option>
          <option value="consumption">Konsumsi</option>
        </select>
        <input id="import-file" type="file" accept=".xlsx,.xls,.csv" />
        <button class="btn ghost" data-template="true">Download Template</button>
      </div>
      <p class="muted">Template Excel membantu import cepat untuk peserta, pembelian, dan konsumsi.</p>
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
        <input name="name" required value="${escapeHtml(item.name || '')}" />
      </label>
      <label>Member ID
        <input name="member_id" required value="${escapeHtml(item.member_id || '')}" />
      </label>
      <label>Password member
        <input name="member_password" type="password" value="" ${item.id ? 'placeholder="Kosongkan bila tidak diubah"' : 'required'} />
      </label>
      <label>Status peserta
        <select name="status">
          ${['Ikut', 'Batal ikut', 'Tidak ikut'].map((opt) => `<option value="${opt}" ${item.status === opt ? 'selected' : ''}>${opt}</option>`).join('')}
        </select>
      </label>
      <label>Status pembayaran
        <select name="payment">
          ${['Belum bayar', 'Bayar sebagian', 'Sudah bayar'].map((opt) => `<option value="${opt}" ${item.payment === opt ? 'selected' : ''}>${opt}</option>`).join('')}
        </select>
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
  editingId = id;
  const item = id ? (type === 'outing' ? db.outing : (db[type] || []).find((row) => row.id === id)) || {} : {};
  const titlePrefix = id ? 'Edit' : 'Tambah';
  const label = {
    participants: 'Peserta',
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
    if (!file || !file.type.startsWith('image/')) return resolve('');

    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const maxSize = 1280;
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.72);
        resolve(dataUrl);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

async function handleFormSubmit(e) {
  e.preventDefault();
  const type = $('#data-dialog').dataset.type;
  const formData = new FormData(e.target);
  const obj = Object.fromEntries(formData.entries());

  if (type === 'outing') {
    db.outing = {
      destination: obj.destination,
      date: obj.date,
      description: obj.description || ''
    };
    saveDb();
    closeDialog();
    render();
    showToast('Data outing berhasil disimpan.');
    return;
  }

  const photoInput = formData.get('photo');
  const photoValue = photoInput && photoInput instanceof File ? await compressImage(photoInput) : (db[type] || []).find((row) => row.id === editingId)?.photo || '';

  if (type === 'participants') {
    const existing = (db.participants || []).find((item) => item.id === editingId);
    const memberPassword = obj.member_password && obj.member_password.trim() ? obj.member_password.trim() : (existing?.member_password || 'member123');
    const participant = {
      id: editingId || crypto.randomUUID(),
      name: obj.name,
      member_id: obj.member_id,
      member_password: memberPassword,
      status: obj.status,
      payment: obj.payment
    };

    if (existing) {
      Object.assign(existing, participant);
    } else {
      db.participants.push(participant);
    }
  } else {
    const item = {
      id: editingId || crypto.randomUUID(),
      date: obj.date,
      item: obj.item,
      category: obj.category,
      amount: Number(obj.amount || 0),
      photo: photoValue
    };

    const list = db[type] || [];
    const index = list.findIndex((row) => row.id === editingId);
    if (index >= 0) list[index] = item;
    else list.push(item);
    db[type] = list;
  }

  saveDb();
  closeDialog();
  render();
  showToast('Data berhasil disimpan.');
}

function closeDialog() {
  $('#data-dialog').close();
  $('#data-form').reset();
}

function deleteData(type, id) {
  if (!confirm('Apakah Anda yakin ingin menghapus data ini?')) return;
  if (type === 'participants') {
    db.participants = db.participants.filter((item) => item.id !== id);
  } else {
    db[type] = (db[type] || []).filter((item) => item.id !== id);
  }
  saveDb();
  render();
  showToast('Data berhasil dihapus.');
}

function exportReport(kind) {
  const allData = [
    ...db.expenses.map((item) => ({ ...item, type: 'Pembelian' })),
    ...db.consumption.map((item) => ({ ...item, type: 'Konsumsi' }))
  ];

  if (kind === 'excel') {
    const wb = XLSX.utils.book_new();
    const summaryRows = [
      ['Tujuan', db.outing.destination || ''],
      ['Tanggal', db.outing.date || ''],
      ['Deskripsi', db.outing.description || ''],
      [],
      ['Type', 'Item', 'Kategori', 'Tanggal', 'Jumlah'],
      ...allData.map((item) => [item.type, item.item, item.category, item.date, item.amount])
    ];
    const ws = XLSX.utils.aoa_to_sheet(summaryRows);
    XLSX.utils.book_append_sheet(wb, ws, 'Report');
    XLSX.writeFile(wb, 'report-outing.xlsx');
    return;
  }

  if (kind === 'pdf') {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.text('Report Outing', 14, 18);
    doc.setFontSize(11);
    doc.text(`Tujuan: ${db.outing.destination || '-'}`, 14, 28);
    doc.text(`Tanggal: ${db.outing.date || '-'}`, 14, 35);

    allData.forEach((item, index) => {
      const y = 50 + index * 8;
      doc.text(`${index + 1}. ${item.type} - ${item.item} - ${item.category} - ${formatMoney(item.amount)}`, 14, y);
    });
    doc.save('report-outing.pdf');
    return;
  }

  const html = `
    <html>
      <body>
        <h1>Report Outing</h1>
        <p>Tujuan: ${escapeHtml(db.outing.destination || '')}</p>
        <table border="1" cellpadding="6" cellspacing="0">
          <tr><th>Type</th><th>Item</th><th>Kategori</th><th>Tanggal</th><th>Jumlah</th></tr>
          ${allData.map((item) => `<tr><td>${escapeHtml(item.type)}</td><td>${escapeHtml(item.item)}</td><td>${escapeHtml(item.category)}</td><td>${escapeHtml(item.date)}</td><td>${escapeHtml(formatMoney(item.amount))}</td></tr>`).join('')}
        </table>
      </body>
    </html>
  `;

  const blob = new Blob([html], { type: 'application/msword' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'report-outing.doc';
  anchor.click();
  URL.revokeObjectURL(url);
}

function downloadTemplate() {
  const type = $('#import-type').value;
  const headers = {
    participants: ['name', 'member_id', 'member_password', 'status', 'payment'],
    expenses: ['date', 'item', 'category', 'amount'],
    consumption: ['date', 'item', 'category', 'amount']
  }[type] || ['date', 'item', 'category', 'amount'];

  const sampleRow = {
    participants: ['Contoh Nama', 'MBR010', 'member123', 'Ikut', 'Belum bayar'],
    expenses: ['2026-10-08', 'Contoh item', 'Perlengkapan', '250000'],
    consumption: ['2026-10-08', 'Contoh menu', 'Makanan', '150000']
  }[type] || ['2026-10-08', 'Contoh item', 'Makanan', '150000'];

  const ws = XLSX.utils.aoa_to_sheet([headers, sampleRow]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, type);
  XLSX.writeFile(wb, `template-${type}.xlsx`);
}

function importExcelFile(file, type) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (event) => {
    try {
      const workbook = XLSX.read(event.target.result, { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[firstSheetName];
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

      if (!rows.length) {
        showToast('File Excel kosong.');
        return;
      }

      if (type === 'participants') {
        rows.forEach((row) => {
          const payload = {
            id: crypto.randomUUID(),
            name: row.name || row.Nama || row.nama,
            member_id: row.member_id || row['Member ID'] || row.memberid,
            member_password: row.member_password || row['Password member'] || 'member123',
            status: row.status || 'Ikut',
            payment: row.payment || 'Belum bayar'
          };

          if (payload.name && payload.member_id) {
            db.participants.push(payload);
          }
        });
      } else {
        rows.forEach((row) => {
          const payload = {
            id: crypto.randomUUID(),
            date: row.date || row.Tanggal || row.tanggal,
            item: row.item || row.Item || row.Nama,
            category: row.category || row.Kategori || row.kategori,
            amount: Number(row.amount || row.Jumlah || row.jumlah || 0),
            photo: ''
          };

          if (payload.date && payload.item && payload.category) {
            const list = db[type] || [];
            list.push(payload);
            db[type] = list;
          }
        });
      }

      saveDb();
      render();
      showToast(`${rows.length} data berhasil diimport.`);
    } catch (error) {
      showToast('Format file tidak valid. Cek template Excel Anda.');
    }
  };
  reader.readAsArrayBuffer(file);
}

$('#login-form').addEventListener('submit', login);
$('#logout').addEventListener('click', () => {
  session = null;
  $('#app').classList.add('hidden');
  $('#login-screen').classList.remove('hidden');
  $('#login-form').reset();
});

$('#navigation').addEventListener('click', (event) => {
  const item = event.target.closest('[data-page]');
  if (!item) return;
  currentPage = item.dataset.page;
  render();
});

$('#quick-add').addEventListener('click', () => {
  const type = currentPage === 'dashboard' ? 'participants' : currentPage;
  if (session?.role === 'admin') openDialog(type);
});

$('#data-form').addEventListener('submit', handleFormSubmit);

$('#data-dialog').addEventListener('click', (event) => {
  if (event.target === $('#data-dialog') && event.target.open) {
    closeDialog();
  }
});

document.addEventListener('click', (event) => {
  const addButton = event.target.closest('[data-add]');
  if (addButton && session?.role === 'admin') openDialog(addButton.dataset.add);

  const editButton = event.target.closest('[data-edit]');
  if (editButton && session?.role === 'admin') openDialog(editButton.dataset.type, editButton.dataset.edit);

  const deleteButton = event.target.closest('[data-delete]');
  if (deleteButton && session?.role === 'admin') deleteData(deleteButton.dataset.type, deleteButton.dataset.delete);

  const exportButton = event.target.closest('[data-export]');
  if (exportButton) exportReport(exportButton.dataset.export);

  const templateButton = event.target.closest('[data-template]');
  if (templateButton) downloadTemplate();

  if (event.target.closest('[data-action="go-outing"]')) {
    currentPage = 'outing';
    render();
  }
});

document.addEventListener('input', (event) => {
  if (event.target.id === 'participant-search') {
    const term = event.target.value.toLowerCase();
    const filtered = db.participants.filter((p) => `${p.name} ${p.member_id}`.toLowerCase().includes(term));
    const table = $('#participant-table');
    if (table) table.innerHTML = renderParticipantTable(filtered, true);
  }
});

document.addEventListener('change', (event) => {
  if (event.target.id === 'import-file' && event.target.files[0]) {
    const type = $('#import-type').value;
    importExcelFile(event.target.files[0], type);
  }
});

window.OUTING_CONFIG = {
  SUPABASE_URL: '',
  SUPABASE_ANON_KEY: '',
  STORAGE_BUCKET: 'outing-receipts'
};

if (window.OUTING_CONFIG.SUPABASE_URL && window.OUTING_CONFIG.SUPABASE_ANON_KEY && !window.supabase) {
  const script = document.createElement('script');
  script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
  script.onload = () => {
    if (window.supabase) {
      console.log('Supabase ready.');
    }
  };
  document.head.appendChild(script);
}

$('#login-form').reset();
