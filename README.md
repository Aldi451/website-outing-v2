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
- CSS fallback inline + guard anti-MIME di `index.html`, sehingga halaman tetap tampil rapi di hosting gratisan yang kadang mengirim file CSS sebagai `text/html`.
- Sinkronisasi Supabase per tabel: nama tabel yang gagal dilaporkan, tanggal/angka dari Excel dinormalisasi sebelum upload, dan tombol **🩺 Cek Supabase** menampilkan hasil diagnosa per tabel.
- Data demo tersimpan di `localStorage` browser, sehingga ringan dan langsung digunakan.

## Upload ke InfinityFree

1. Upload `index.html`, `styles.css`, `app.js`, `config.js`, `supabase-sync.js`, dan `.htaccess` ke folder `htdocs` (langsung di dalam `htdocs`, tanpa sub-folder).
2. Pastikan nama file dan huruf besar/kecil sama persis.
3. Buka domain Anda.
4. Gunakan login di atas.

Jika CSS tampak tidak terbaca (tampilan polos, berbeda dari GitHub), lihat
[`TROUBLESHOOTING-INFINITYFREE.md`](TROUBLESHOOTING-INFINITYFREE.md). Penyebab paling umum
adalah Browser Security System InfinityFree yang menjawab permintaan `styles.css` dengan
halaman HTML (`Content-Type: text/html`), sehingga browser menolak memakainya sebagai CSS.
`index.html` sekarang sudah punya fallback otomatis untuk kasus itu.

### Alternatif: satu file standalone

`outing-hub-standalone.html` adalah versi seluruh aplikasi dalam satu file (CSS + semua
JavaScript di-*inline*), sehingga tidak ada request CSS/JS terpisah yang bisa rusak karena
MIME atau cache hosting. Upload file itu ke `htdocs` dan buka
`https://domainanda/outing-hub-standalone.html`.

Buat ulang setelah mengubah kode:

```bash
node tools/build-standalone.mjs
```

`index.html` tetap menjadi sumber utama; file standalone dihasilkan otomatis dari file yang
sama.

Library Excel dan PDF dimuat dari CDN. Jika jaringan CDN diblokir, login dan CRUD lokal tetap bisa digunakan, tetapi fitur export/import membutuhkan koneksi CDN.

## Supabase (wajib untuk data bersama)

Aplikasi akan memuat data dari Supabase saat dibuka dan menyinkronkan setiap tambah, edit, hapus, serta import ke Supabase. Admin juga dapat menekan tombol **Upload ke Supabase** untuk mengirim ulang seluruh data lokal. Data yang disinkronkan mencakup peserta, outing, rundown, pembelian, konsumsi, kategori custom, dan foto bukti yang tersimpan di kolom `photo_url`.

Jalankan `supabase-schema.sql` di SQL Editor Supabase untuk membuat tabel dan policy dasar. Schema tersebut juga berisi migrasi untuk database lama yang masih memakai `member_id` dan `member_password`.

Agar write dari frontend diterima RLS, buat user admin di Supabase Authentication, isi `app_metadata` user tersebut dengan `{ "role": "admin" }`, lalu gunakan email/password Supabase saat login. `supabase-schema.sql` sudah menyediakan policy write berdasarkan claim admin tersebut. Login lokal `admin/power88` tetap dapat membuka aplikasi, tetapi tidak membawa session Supabase; jika dipakai saat RLS aktif, perubahan hanya tersimpan lokal dan akan muncul notifikasi gagal sinkronisasi.

`supabase-schema.sql` aman dijalankan berulang kali dan memuat tiga opsi akses: (1) baca publik + tulis admin Supabase (default), (2) baca & tulis hanya via akun Supabase, (3) izinkan `anon` menulis tanpa akun Supabase (paling cepat, tetapi siapa pun yang membuka website bisa mengubah data).

Kalau data hanya tersimpan lokal, tekan tombol **🩺 Cek Supabase** (admin) untuk melihat tabel mana yang gagal beserta sebabnya, dan jalankan `supabase-diagnose.sql` di SQL Editor. Penjelasan lengkap penyebabnya ada di [`SUPABASE-TROUBLESHOOTING.md`](SUPABASE-TROUBLESHOOTING.md).

Jangan memasukkan `service_role key` ke frontend.

## Catatan penting

Mode lokal menyimpan data per-browser/per-device. Artinya data yang ditambahkan dari satu perangkat belum otomatis terlihat di perangkat lain. Untuk data bersama online, sambungkan Supabase dengan RLS/policy yang benar.
