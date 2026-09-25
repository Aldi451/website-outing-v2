# Kenapa data hanya masuk ke lokal (tidak terkirim ke Supabase)

Aplikasi ini menyimpan data di dua tempat:

1. **localStorage browser** — selalu berhasil, tidak butuh internet.
2. **Supabase** — hanya berhasil kalau permintaan tulis diterima server.

Tabel yang dikirim ke Supabase ada **6**:

| Tabel | Isi |
| --- | --- |
| `participants` | data peserta (nama, telepon, status, pembayaran) |
| `rundown` | susunan acara |
| `expenses` | pembelian barang |
| `consumption` | konsumsi |
| `outing` | tujuan, tanggal, catatan outing |
| `outing_categories` | kategori custom |

Jika muncul **"Data tersimpan lokal"**, ada dua kemungkinan: perubahan belum pernah
diupload (browser ini belum dikonfirmasi tersinkron), atau upload dicoba tetapi ditolak
server. Status kanan atas menunjukkan **⚠ Data lokal belum terunggah**, **⚠ Login lokal
(tanpa session)**, atau **⚠ Gagal sinkronisasi**. Pesan hover dan Console browser
berisi detail percobaan upload yang *benar-benar dilakukan*.

## Cara paling cepat tahu penyebabnya

Login sebagai admin, lalu tekan tombol **🩺 Cek Supabase**. Pemeriksaan ini hanya melakukan
HEAD/SELECT terhadap **semua kolom yang dibutuhkan** tiap tabel dan menampilkan jumlah baris
yang bisa dilihat. **Tidak mengirim atau menghapus data; akses tulis ditandai "belum diuji".**
Bahkan hasil baca "OK, 0 baris" tidak membuktikan tabel kosong apabila RLS menyembunyikan
baris. Jalankan juga `supabase-diagnose.sql` lewat SQL Editor untuk memeriksa policy/kolom.

Setelah schema diperbaiki dan login email admin Supabase, cek isi browser, lalu klik
**↻ Upload ke Supabase** untuk sungguh-sungguh menguji tulis. **Peringatan:** upload
menyamakan tabel server dengan browser ini dan dapat menghapus baris server yang tidak ada
di browser; dialog meminta konfirmasi. Jangan hapus data browser yang belum terupload.

## Penyebab, berurutan dari yang paling sering

### 1. Login masih mode lokal, jadi tidak ada session Supabase

**Ini penyebab nomor satu.** Login `admin / power88` dan `member / member` hanya membuka
aplikasi di browser. Keduanya **tidak** membuat session Supabase, sehingga server hanya
melihat permintaan "anon" (pengunjung biasa) dan menolak tulis.

Pesan yang muncul:

```
new row violates row-level security policy for table "participants"   (code 42501)
```

Semua tabel yang **skema dan kolomnya sudah ada** dapat ditolak saat tulis;
tabel/kolom yang belum ada memberikan error berbeda. Login lokal tidak dapat menggantikan
session email/password Supabase.

**Solusi A (disarankan, aman):**

1. Supabase → **Authentication → Users → Add user**, buat admin dengan email + password.
2. Set `app_metadata` user tersebut (SQL Editor):

   ```sql
   update auth.users
      set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}'::jsonb
    where email = 'admin@domainanda.com';
   ```

3. Login di aplikasi memakai **email + password Supabase** itu (bukan `admin/power88`).
   Kalau akun belum punya role admin, aplikasi akan menolak dengan pesan
   "Akun Supabase ini belum memiliki role admin".

**Jangan gunakan login lokal sebagai solusi RLS.** OPSI 3 (anon write) di schema
dinonaktifkan secara default: jika diaktifkan, **siapa pun** yang mengetahui anon key
publik, bahkan tanpa login admin/power88, dapat mengubah/menghapus seluruh data peserta.
Password lokal bukan pengaman database.

### 2. Policy RLS belum ada / masih versi lama

Gejala: pesan sama seperti nomor 1 (`42501`) **walaupun** sudah login dengan akun Supabase,
atau malah tidak bisa membaca data sama sekali (daftar selalu kembali ke data lokal).

- Sudah login tapi tetap ditolak → `app_metadata.role` user belum `admin`, atau policy
  `admin write ...` belum dibuat.
- Belum bisa membaca → policy baca masih `to authenticated` (versi schema lama) sedangkan
  login yang dipakai mode lokal. `supabase-schema.sql` versi terbaru membuat policy baca
  untuk publik (`to anon` + `to authenticated`) sehingga mode lihat tetap jalan; kalau
  privasi lebih penting, pakai OPSI 2; ingat login member lokal tidak lagi bisa memuat
  data online, dan aplikasi perlu alur login pembaca Supabase tersendiri.
- Jalankan ulang `supabase-schema.sql` versi terbaru. Policy bawaan di-drop dan dibuat
  ulang sehingga tidak error "policy already exists". Periksa juga policy lain yang dibuat
  manual dengan `supabase-diagnose.sql`. Default baca publik membocorkan nama + nomor
  telepon peserta kepada siapa pun yang memiliki URL + anon key; OPSI 2 membatasi baca
  tetapi memerlukan alur login pembaca tambahan.

### 3. Tabel atau kolomnya belum ada di Supabase

Pesan:

```
relation "public.participants" does not exist                       (code 42P01)
Could not find the 'name' column of 'participants' in the schema cache (PGRST204)
Could not find the table 'public.rundown' in the schema cache          (PGRST205)
```

Penyebab: `supabase-schema.sql` belum pernah dijalankan, dijalankan sebagian, atau database
masih memakai struktur lama (`member_id` / `member_password`).

Solusi: jalankan **seluruh file TERBARU** `supabase-schema.sql` di SQL Editor. `CREATE
TABLE IF NOT EXISTS` saja tidak memperbaiki tabel `participants` yang sudah ada tetapi
belum punya kolom `name`; blok migrasi sekarang menambahkan `name` dan kolom lain yang
kurang, memindahkan `member_id` ke `phone`, lalu menyuruh PostgREST me-refresh cache.
Baris lama tanpa nama sengaja tidak diberi nama palsu; lengkapi namanya manual.

### 4. Isi data tidak memenuhi aturan kolom

Pesan:

```
null value in column "date" of relation "expenses" violates not-null constraint   (code 23502)
invalid input syntax for type date: "12 Mei 2026"                                  (code 22007)
new row for relation "participants" violates check constraint                     (code 23514)
```

Penyebab: kolom `date` wajib diisi, sedangkan datanya kosong atau formatnya bukan tanggal
(mis. hasil import Excel berupa serial number atau "12/05/2026"). Nilai `amount` dari Excel
bisa juga berbentuk "Rp 1.500.000" sehingga menjadi `NaN`.

Sudah ditangani otomatis oleh lapisan sinkronisasi sekarang:

- tanggal `12/05/2026`, `2026-05-12`, serial Excel `45870`, dan `5 Mei 2026` dikonversi ke
  format `YYYY-MM-DD` yang diterima Postgres (tanggal kosong memakai tanggal hari ini,
  disertai peringatan di Console);
- `amount` "Rp 1.500.000" → `1500000`, "2.750.000" → `2750000`, "1,5" → `1.5`;
- `status`/`payment` yang tidak dikenal dikembalikan ke nilai yang sah (`Ikut`, `Belum bayar`).

Kalau tetap muncul error tanggal, berarti ada nilai yang tidak bisa dikenali: perbaiki data
tersebut (biasanya dari import Excel), lalu upload ulang.

### 5. Kapan data lokal dikirim / diterima

Project kosong **tidak lagi diisi otomatis dengan data demo** ketika halaman dibuka.
Browser dengan data lokal yang belum pernah sukses upload juga **tidak otomatis ditimpa**
oleh data Supabase yang baru dapat dibaca. Setelah upload pertama berhasil, perubahan
berikutnya otomatis tersinkron; jika gagal, browser kembali masuk mode "belum terunggah"
dan perlu upload ulang dengan sengaja. Percobaan upload memproses enam tabel secara
terpisah agar error satu tabel tidak menyembunyikan error tabel lain. Data dari
browser berbeda tidak otomatis digabung: tombol **↓ Muat dari Supabase** mengganti
lokal, sedangkan tombol **↻ Upload ke Supabase** bisa mengganti/menghapus isi server.
Buat cadangan sebelum memilih apabila kedua sisi berisi perubahan penting.

### 6. Library Supabase gagal dimuat dari CDN

Kalau `window.supabase` tidak ada (CDN diblokir jaringan/kantor), aplikasi langsung berhenti
sinkronisasi dan hanya jalan lokal. Sekarang:

- `index.html` menyediakan **fallback otomatis ke unpkg** kalau jsDelivr gagal;
- `supabase-sync.js` **menunggu sampai 15 detik** untuk library itu, bukan langsung
  menyerah;
- kalau tetap gagal: status menjadi **⚠ Library Supabase gagal dimuat** dan login memberi
  pesan bahwa library belum termuat.

### 7. Project Supabase sedang pause / jaringan bermasalah

Pesan: `Failed to fetch`. Project gratis Supabase pause otomatis setelah lama tidak dipakai
— buka dashboard Supabase untuk mengaktifkannya kembali, lalu coba lagi.

### 8. Hal yang bukan penyebab

- **Bucket storage `outing-receipts`** di `config.js` tidak dipakai oleh proses upload data.
  Foto bukti disimpan sebagai data URL di kolom `photo_url`, jadi bucket tidak perlu dibuat.
- **Kunci `service_role`** tidak dan tidak boleh dipakai di frontend. Cukup `anon key`.
- **Hosting InfinityFree** tidak menghalangi permintaan ke Supabase; masalah MIME di
  InfinityFree hanya memengaruhi file CSS/JS milik situs sendiri, bukan koneksi ke Supabase
  (lihat `TROUBLESHOOTING-INFINITYFREE.md`).

## Kalau masih gagal

Kirimkan hasil ini supaya bisa dipastikan:

1. Laporan dari tombol **🩺 Cek Supabase** (atau hasil `supabase-diagnose.sql`).
2. Tab **Console** browser: baris `Supabase sync failed for table "..."` berisi pesan asli
   dari Supabase beserta kodenya.
3. Status pill di kanan atas (**⚠ Data lokal belum terunggah** / **⚠ Login lokal** /
   **⚠ Gagal sinkronisasi**) dan pesan hover-nya.

Jangan kirim password, service_role key, atau data pribadi peserta. Dengan pesan error
tersebut penyebabnya dapat dibedakan: akun/claim, policy, tabel/kolom, atau isi data.
