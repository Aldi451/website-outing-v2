# Outing Hub

Website ringan untuk pengelolaan outing yang dapat dijalankan langsung di InfinityFree, GitHub Pages, atau hosting statis lain. Tidak membutuhkan Node.js, database lokal, atau build step.

## Login untuk dipakai sekarang

- Admin **lokal**: `admin` / `power88` (hanya browser ini; **bukan** akun Supabase)
- Mode lihat: `member` / `member`
- Admin **online**: email/password yang dibuat di Supabase Authentication dengan `app_metadata.role = "admin"`.

Mode lihat hanya dapat membaca informasi outing dan rundown. Perubahan bersama di Supabase hanya dapat dilakukan admin online; password lokal yang ada di JavaScript bukan pengaman database.

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
- Sinkronisasi Supabase per tabel: nama tabel yang gagal dilaporkan, tanggal/angka dari Excel dinormalisasi sebelum upload, dan tombol **🩺 Cek Supabase** memeriksa skema secara *read-only* (tidak melakukan upload/hapus).
- Data demo tersedia lokal; perubahan disimpan di `localStorage` browser sampai berhasil diupload.

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

Aplikasi membaca Supabase saat dibuka, tetapi **tidak otomatis mengirim data demo/lokal** ke project kosong. Browser yang mempunyai data lokal belum terkonfirmasi tersinkron tidak akan ditimpa data server. Setelah upload pertama berhasil, tambah/edit/hapus/import berikutnya otomatis tersinkron; jika suatu upload gagal, data tetap lokal dan harus diupload ulang secara sadar. `photo_url` menyimpan foto sebagai data URL.

### Memperbaiki laporan 6 tabel bermasalah

1. **Jangan hapus penyimpanan browser ini**: data yang belum terupload hanya ada di browser yang dipakai. Jika database sudah punya data penting, cadangkan juga data Supabase sebelum mengubah skema.
2. Supabase → **SQL Editor** pada project yang benar → tempel dan jalankan **seluruh file [`supabase-schema.sql`](supabase-schema.sql)** versi terbaru. Ini membuat `rundown` dan `outing_categories`, menambah `participants.name` pada tabel lama (yang tidak dilakukan `CREATE TABLE IF NOT EXISTS`), melengkapi kolom lain, menyalakan RLS, serta memperbarui cache PostgREST. Aman diulang, tetapi versi default membuat nama + telepon peserta **bisa dibaca publik dengan anon key**. Bila perlu privasi, gunakan policy baca terbatas (OPSI 2); login member lokal tidak akan dapat memuat data online dan alur login untuk pembaca Supabase perlu disiapkan terpisah.
3. Jalankan [`supabase-diagnose.sql`](supabase-diagnose.sql) di SQL Editor untuk melihat kolom/policy yang masih kurang. Jika tabel peserta lama berisi baris tanpa `name`, lengkapi nama asli dulu; migrasi sengaja tidak membuat nama palsu untuk baris itu.
4. Supabase → **Authentication → Users → Add user**: buat akun dengan email dan password **baru**. Beri role admin dari SQL Editor (ganti email contoh ini):

   ```sql
   update auth.users
      set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}'::jsonb
    where email = 'admin@domainanda.com';
   ```

5. Deploy ulang file website yang berubah, muat ulang halaman, lalu login menggunakan **email/password Supabase** tersebut (bukan `admin/power88`). Klik **🩺 Cek Supabase**: ini hanya membaca kolom, **bukan** menguji atau melakukan penulisan. Periksa data lokal di halaman, lalu klik **↻ Upload ke Supabase** dan setujui konfirmasi. Upload menyamakan keenam tabel dengan browser ini, **termasuk menghapus baris server yang tidak ada di browser**. Verifikasi jumlah baris melalui Table Editor atau buka dari browser lain.
6. Jika browser sudah punya data lokal tetapi Anda justru ingin menampilkan data server, gunakan **↓ Muat dari Supabase** dengan sadar: tindakan ini mengganti data lokal yang belum terupload.

Policy tulis default hanya menerima user Supabase dengan claim `app_metadata.role = "admin"`; login lokal tidak memiliki session itu. Jangan menaruh `service_role key` atau password admin di frontend. Opsi anon menulis di schema **tidak aman** karena siapa pun dengan anon key publik dapat mengubah dan menghapus semua data; jangan gunakan untuk data peserta.

Kalau masih gagal, lihat [`SUPABASE-TROUBLESHOOTING.md`](SUPABASE-TROUBLESHOOTING.md) dan kirim hanya pesan error (bukan data peserta/password).

## Catatan penting

Mode lokal menyimpan data per-browser/per-device. Artinya data yang ditambahkan dari satu perangkat belum otomatis terlihat di perangkat lain. Untuk data bersama online, sambungkan Supabase dengan RLS/policy yang benar.
