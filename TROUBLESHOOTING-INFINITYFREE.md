# CSS tidak kebaca di InfinityFree (tampilan beda dari GitHub)

Gejala: di GitHub Pages tampilan rapi, tapi setelah di-upload ke InfinityFree halaman
tampil "telanjang" — teks polos, tombol tanpa warna, layout berantakan.

Pesan ini biasanya muncul di Console DevTools:

```
Refused to apply style from 'https://domainkamu/styles.css' because its MIME type
('text/html') is not a supported stylesheet MIME type, and strict MIME checking is enabled.
```

Pesan itu **bukan** berarti CSS-nya rusak atau sintaksnya salah. Artinya: browser meminta
`styles.css`, tetapi server menjawab dengan **halaman HTML**, bukan file CSS. Karena tipe
isinya `text/html`, browser menolak memakainya sebagai stylesheet.

## Penyebab paling mungkin

### 1. Browser Security System InfinityFree (paling sering)

Semua akun InfinityFree gratis dijalankan di belakang sistem keamanan yang memverifikasi
"apakah pengunjung ini browser asli yang bisa menjalankan JavaScript dan menerima cookie".
Selama verifikasi belum selesai, semua permintaan aset (CSS, JS, gambar) dijawab dengan
halaman verifikasi.

Ciri-cirinya:

- URL memuat tambahan `?i=1` (atau `?i=2`, `?i=3`).
- Di tab Network, `styles.css` berstatus `200` tetapi `Content-Type: text/html` dan isinya
  halaman HTML verifikasi InfinityFree.
- Muncul setelah hapus cache, ganti jaringan, mode incognito, atau saat membuka dari HP.

Beberapa user melaporkan request CSS/JS bisa "kena" halaman verifikasi walaupun halaman HTML
utamanya sukses dimuat. Solusinya muat ulang halaman (refresh) sekali sampai cookie `__test`
tersimpan.

### 2. File belum ter-upload di folder yang benar

Folder web root InfinityFree adalah **`htdocs`**. Kalau isi proyek di-upload sebagai
`htdocs/website-outing-v2/index.html`, maka `https://domainkamu/index.html` akan 404 dan
`styles.css` juga tidak ketemu. Pastikan **`index.html`, `styles.css`, `app.js`, `config.js`,
`supabase-sync.js`, dan `.htaccess` berada langsung di dalam `htdocs`**.

### 3. Nama file beda huruf besar/kecil

Server Linux membedakan `Styles.css` dan `styles.css`. Di Windows (dan GitHub) tidak. Cek
satu per satu nama file di File Manager harus persis: `styles.css`, `app.js`, `config.js`,
`supabase-sync.js`.

### 4. Cache browser / cache InfinityFree

InfinityFree memasang cache cukup agresif untuk file statis. Kalau sebelumnya `styles.css`
pernah tersimpan sebagai halaman verifikasi, browser bisa terus memakai salinan itu. Tekan
`Ctrl + Shift + R` (hard reload) atau buka di jendela incognito.

### 5. Hotlink dari domain lain

Free hosting InfinityFree **tidak mendukung** memuat CSS/JS dari domain lain (termasuk
subdomain lain milik Anda sendiri). Semua file harus berada di domain yang sama.

## Langkah cek cepat

1. Buka `https://domainkamu/styles.css` langsung di address bar.
   - Yang benar: muncul kode CSS (diawali `:root { ... }`).
   - Yang salah: muncul halaman HTML, halaman "Cookies are not enabled", atau error 404.
2. Tekan `F12` → tab **Network** → refresh → klik `styles.css` → lihat **Response Headers**.
   Harus `Content-Type: text/css`. Kalau `text/html`, penyebabnya poin 1, 2, atau 4 di atas.
3. Tekan `F12` → tab **Console**. Kalau ada tulisan `Refused to apply style ... MIME type
   ('text/html')`, berarti halaman HTML yang dikirim sebagai CSS.
4. Refresh sekali lagi di tab baru (bukan reload cepat dari cache).

## Yang sudah diperbaiki di repo ini

1. **`index.html` memuat CSS dengan versi**: `styles.css?v=3`, `app.js?v=3`, dan seterusnya,
   supaya browser tidak memakai file lama dari cache InfinityFree.
2. **CSS fallback inline di dalam `index.html`** (blok `<style>` kecil di `<head>`). Login
   screen tetap layak dilihat walaupun `styles.css` gagal dimuat.
3. **Guard anti-MIME di dalam `index.html`.** Kalau `styles.css` tidak jadi terpasang,
   halaman akan (a) mengambil ulang CSS dengan `cache: 'reload'`; kalau isinya CSS asli, CSS
   itu langsung di-*inline* sehingga tampilan kembali normal; atau (b) kalau yang dikirim
   halaman verifikasi, halaman melakukan **satu kali reload** supaya cookie keamanan
   InfinityFree tersimpan. Hasil akhirnya: pengunjung melihat tampilan yang benar tanpa
   perlu tahu ada masalah MIME.
   Saat semuanya normal, guard ini tidak melakukan apa-apa (tidak ada request tambahan).
4. **`.htaccess`** memastikan MIME `text/css` dan `application/javascript` terdaftar, dan
   `index.html` dipakai sebagai halaman pembuka.

## Opsi paling aman: file standalone

Kalau ingin bebas total dari masalah MIME CSS/JS, pakai file yang sudah digabung:

```
outing-hub-standalone.html
```

File ini sudah berisi CSS, `config.js`, `supabase-sync.js`, dan `app.js` di dalam satu file.
Upload file itu ke `htdocs`, lalu buka `https://domainkamu/outing-hub-standalone.html`
(kalau ingin jadi halaman utama, ubah `.htaccess` menjadi `DirectoryIndex outing-hub-standalone.html`).

Buat ulang file tersebut setiap kali ada perubahan kode:

```bash
node tools/build-standalone.mjs
```

File ini tetap memuat library CDN (Supabase JS, xlsx, jsPDF), jadi koneksi internet tetap
dibutuhkan untuk fitur export/import dan sinkronisasi Supabase — sama seperti versi biasa.

## Kalau masih tidak terbaca

Kirimkan 3 informasi ini agar bisa dipastikan penyebabnya:

1. Alamat halaman yang bermasalah.
2. Isi tab **Console** (teks lengkapnya).
3. Untuk request `styles.css` di tab **Network**: status code dan `Content-Type` responsnya.

Dengan itu bisa dibedakan apakah masalahnya di sisi hosting (halaman verifikasi), di file
yang belum ter-upload dengan benar, atau di cache browser.
