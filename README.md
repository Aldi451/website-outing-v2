# Outing Hub

Website ringan untuk pengelolaan outing yang dapat dijalankan langsung di InfinityFree, GitHub Pages, atau hosting statis lain. Tidak membutuhkan Node.js, database lokal, atau build step.

## Login untuk dipakai sekarang

- Admin: `admin` / `power88`
- Member: `member` / `member`

## Fitur

- Admin dapat menambah, mengedit, dan menghapus data peserta.
- Member dapat masuk dengan akun sederhana `member/member` untuk melihat informasi outing.
- Status peserta: Ikut, Batal ikut, Tidak ikut.
- Status pembayaran: Belum bayar, Bayar sebagian, Sudah bayar.
- Data tujuan, tanggal, dan catatan outing.
- Pembelian barang dan konsumsi dengan kategori bawaan atau custom.
- Upload foto bukti dengan kompresi JPEG di browser.
- Export laporan Excel, PDF, dan Word langsung ke komputer.
- Import XLSX/CSV serta download template Excel.
- Data demo tersimpan di `localStorage` browser, sehingga ringan dan langsung digunakan.

## Upload ke InfinityFree

1. Upload `index.html`, `styles.css`, `app.js`, `config.js`, dan `member-login.js` ke folder `htdocs`.
2. Pastikan nama file dan huruf besar/kecil sama persis.
3. Buka domain Anda.
4. Gunakan login di atas.

Library Excel dan PDF dimuat dari CDN. Jika jaringan CDN diblokir, login dan CRUD tetap bisa digunakan, tetapi fitur export/import membutuhkan koneksi CDN.

## Catatan penting

Mode ini menyimpan data per-browser/per-device. Artinya data yang ditambahkan dari satu perangkat belum otomatis terlihat di perangkat lain. Untuk data bersama online, sambungkan Supabase dengan RLS/policy yang benar. Jangan memasukkan `service_role key` ke frontend.
