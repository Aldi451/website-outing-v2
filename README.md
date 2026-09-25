# Outing Hub

Website sederhana untuk mengelola outing, peserta, biaya pembelian, konsumsi, dan laporan.

## Menjalankan

Buka `index.html` dengan static hosting (GitHub Pages/Netlify/Vercel). Mode awal menyimpan data di browser `localStorage` sehingga bisa langsung dicoba.

Untuk menghubungkan Supabase, isi `SUPABASE_URL` dan `SUPABASE_ANON_KEY` di `config.js`. Jangan pernah memasukkan `service_role key` ke frontend. SQL awal tersedia di `supabase-schema.sql`.

## Fitur

- Login admin dan login peserta menggunakan Member ID.
- Admin dapat menambah, mengedit, dan menghapus peserta; status ikut dan pembayaran tersedia.
- Data tujuan/tanggal outing.
- Pembelian barang dan konsumsi dengan kategori bebas/custom.
- Foto bukti dikompres di browser menjadi JPEG max 1280px sebelum disimpan.
- Export Excel, PDF, dan Word lokal.
- Import XLSX/CSV dan download template untuk peserta, pembelian, serta konsumsi.

> Catatan keamanan: password member pada demo/local mode hanya untuk prototipe. Untuk produksi, gunakan Supabase Auth (akun per member) atau Edge Function yang melakukan verifikasi password secara aman; jangan menyimpan password plaintext di tabel publik.
