# Outing Hub

Website ringan untuk pengelolaan outing yang dapat dijalankan langsung di InfinityFree, GitHub Pages, atau hosting statis lain. Tidak membutuhkan Node.js, database lokal, atau build step.

## Login untuk dipakai sekarang

- Admin: `admin` / `power88`
- Mode lihat: `member` / `member`

Mode lihat hanya dapat membaca informasi outing dan rundown. Semua perubahan data dilakukan admin.

## Fitur

- Admin dapat menambah, mengedit, menghapus, dan mengimport data peserta.
- Data peserta hanya membutuhkan **nama, nomor telepon, dan status**. Tidak ada member ID, akun, atau password per peserta.
- Status peserta: Ikut, Batal ikut, Tidak ikut.
- Status pembayaran tetap tersedia untuk kebutuhan administrasi outing.
- Rundown outing dengan waktu, agenda, lokasi, PIC, dan catatan.
- Admin dapat menambah, mengedit, menghapus, serta import rundown melalui Excel. Peserta/member hanya dapat melihat rundown.
- Data tujuan, tanggal, dan catatan outing.
- Pembelian barang dan konsumsi dengan kategori bawaan atau custom.
- Upload foto bukti dengan kompresi JPEG di browser.
- Export laporan Excel, PDF, dan Word langsung ke komputer.
- Import XLSX/CSV serta download template Excel untuk peserta, rundown, pembelian, dan konsumsi.
- Tampilan responsif dengan menu mobile dan daftar data yang lebih mudah dibaca di layar kecil.
- Data demo tersimpan di `localStorage` browser, sehingga ringan dan langsung digunakan.

## Upload ke InfinityFree

1. Upload `index.html`, `styles.css`, `app.js`, `config.js`, dan `supabase-sync.js` ke folder `htdocs`.
2. Pastikan nama file dan huruf besar/kecil sama persis.
3. Buka domain Anda.
4. Gunakan login di atas.

Library Excel dan PDF dimuat dari CDN. Jika jaringan CDN diblokir, login dan CRUD lokal tetap bisa digunakan, tetapi fitur export/import membutuhkan koneksi CDN.

## Supabase (opsional)

Jalankan `supabase-schema.sql` di SQL Editor Supabase untuk membuat tabel peserta, outing, rundown, pembelian, dan konsumsi. Schema tersebut juga berisi migrasi untuk database lama yang masih memakai `member_id` dan `member_password`. Tambahkan policy insert/update/delete yang membatasi akses hanya ke user admin.

Jangan memasukkan `service_role key` ke frontend.

## Catatan penting

Mode lokal menyimpan data per-browser/per-device. Artinya data yang ditambahkan dari satu perangkat belum otomatis terlihat di perangkat lain. Untuk data bersama online, sambungkan Supabase dengan RLS/policy yang benar.
