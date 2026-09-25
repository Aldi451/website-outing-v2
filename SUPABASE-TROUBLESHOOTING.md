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

Kalau muncul notifikasi **"Data tersimpan lokal, tetapi belum masuk ke Supabase"**, berarti
salah satu (atau beberapa) tabel di atas ditolak server. Sejak versi sekarang:
notifikasi **menyebut nama tabel** yang gagal, dan status di kanan atas berubah menjadi
**⚠ Login lokal (tanpa session)** atau **⚠ Gagal sinkronisasi**. Arahkan kursor ke status itu
untuk melihat pesan asli dari Supabase, dan buka **Console browser** untuk detail lengkapnya.

## Cara paling cepat tahu penyebabnya

Login sebagai admin, lalu tekan tombol **🩺 Cek Supabase** di kanan atas. Tombol itu
memeriksa satu per satu: bisa dibaca atau tidak, ada berapa baris, dan bisa ditulis atau
tidak — lalu menampilkan laporan per tabel beserta langkah perbaikannya.

Di Supabase, jalankan juga **`supabase-diagnose.sql`** (SQL Editor → Run). Hasilnya
menunjukkan tabel/kolom/policy mana yang belum siap. Kedua cara ini tidak mengubah data.

## Penyebab, berurutan dari yang paling sering

### 1. Login masih mode lokal, jadi tidak ada session Supabase

**Ini penyebab nomor satu.** Login `admin / power88` dan `member / member` hanya membuka
aplikasi di browser. Keduanya **tidak** membuat session Supabase, sehingga server hanya
melihat permintaan "anon" (pengunjung biasa) dan menolak tulis.

Pesan yang muncul:

```
new row violates row-level security policy for table "participants"   (code 42501)
```

Semua tabel akan gagal sekaligus, karena policy tulis mensyaratkan claim admin.

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

**Solusi B (tanpa akun Supabase):** aktifkan **OPSI 3** di `supabase-schema.sql`, yaitu
policy yang mengizinkan `anon` menulis. Login `admin/power88` langsung bisa upload.
Risikonya nyata: anon key terlihat di `config.js`, jadi siapa pun yang membuka website bisa
mengubah data. Pakai hanya kalau risikonya diterima.

### 2. Policy RLS belum ada / masih versi lama

Gejala: pesan sama seperti nomor 1 (`42501`) **walaupun** sudah login dengan akun Supabase,
atau malah tidak bisa membaca data sama sekali (daftar selalu kembali ke data lokal).

- Sudah login tapi tetap ditolak → `app_metadata.role` user belum `admin`, atau policy
  `admin write ...` belum dibuat.
- Belum bisa membaca → policy baca masih `to authenticated` (versi schema lama) sedangkan
  login yang dipakai mode lokal. `supabase-schema.sql` versi terbaru membuat policy baca
  untuk publik (`to anon` + `to authenticated`) sehingga mode lihat tetap jalan; kalau
  privasi lebih penting, pakai OPSI 2 di file itu dan login dengan akun Supabase.
- Jalankan ulang `supabase-schema.sql` — sekarang **aman diulang** (semua policy di-drop
  dulu sebelum dibuat), jadi tidak akan error "policy already exists".

### 3. Tabel atau kolomnya belum ada di Supabase

Pesan:

```
relation "public.participants" does not exist                       (code 42P01)
column "phone" of relation "participants" does not exist            (code 42703)
Could not find the table 'public.rundown' in the schema cache
```

Penyebab: `supabase-schema.sql` belum pernah dijalankan, dijalankan sebagian, atau database
masih memakai struktur lama (`member_id` / `member_password`).

Solusi: jalankan **seluruh** `supabase-schema.sql` di SQL Editor. Blok 2 di file itu
memindahkan data lama dari `member_id` ke `phone` dan menambahkan kolom yang kurang
(`payment`, `location`, `pic`, `notes`, `amount`, `photo_url`, dan lainnya).

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

### 5. Kegagalan satu tabel tidak lagi memblokir tabel lain

Sebelumnya semua tabel di-upload bersamaan dan satu error membatalkan seluruh proses,
sehingga terasa seperti "semua masuk lokal". Sekarang keenam tabel dikirim dan dinilai
terpisah, jadi laporan menunjukkan tabel mana yang benar-benar bermasalah.

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
3. Status pill di kanan atas (**⚠ Login lokal** / **⚠ Gagal sinkronisasi**) dan pesan
   hover-nya.

Dengan tiga hal itu, penyebabnya bisa ditentukan tanpa menebak: apakah di user/claim,
di policy, di tabel/kolom, atau di isi data.
