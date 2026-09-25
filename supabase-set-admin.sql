-- ============================================================================
-- Outing Hub - jadikan sebuah akun sebagai ADMIN Supabase (siap tempel-jalankan)
-- ----------------------------------------------------------------------------
-- Gunakan file ini untuk memperbaiki upload yang "ditolak RLS/permission denied".
-- Penyebab error itu: login memakai admin LOKAL (admin/power88) sehingga tidak
-- ada session Supabase; server melihat peran "anon" yang HAK TULISNYA dicabut.
-- Solusinya: buat user Supabase, beri role admin (file ini), lalu login di
-- aplikasi memakai email + password user tersebut (BUKAN admin/power88).
--
-- Cara pakai:
--   1) Buat user dulu: Supabase -> Authentication -> Users -> Add user
--      (isi email + password, centang "Auto Confirm User").
--   2) Ganti 'admin@domainanda.com' di bawah dengan email user tadi.
--   3) Supabase -> SQL Editor -> tempel SELURUH file ini -> Run.
--   4) Lihat tab Results: baris terakhir harus menunjukkan role = admin.
--   5) Di aplikasi: logout, lalu login memakai email + password itu.
--
-- Aman dijalankan berulang kali. TIDAK menyentuh data peserta/outing.
-- ============================================================================

-- >>>>>>>>>>>>>>>>>>>>>>>> GANTI EMAIL DI BARIS INI <<<<<<<<<<<<<<<<<<<<<<<<<<<<
-- Ketik email akun admin Anda di antara tanda kutip.
\set admin_email 'admin@domainanda.com'
-- Catatan: baris \set di atas hanya bekerja di psql. Di Supabase SQL Editor
-- (yang tidak mengenal \set), abaikan baris itu dan langsung ganti setiap
-- 'admin@domainanda.com' di bawah dengan email Anda.

-- ------------------------------------------------------------- 1. SET ROLE ---
-- Menambahkan {"role":"admin"} ke app_metadata tanpa menghapus metadata lain.
update auth.users
   set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
                           || '{"role":"admin"}'::jsonb
 where email = 'admin@domainanda.com';

-- Jika 0 baris terupdate, emailnya salah ATAU user-nya belum dibuat di
-- Authentication -> Users. Buat dulu, baru jalankan ulang file ini.
do $$
declare
  n int;
begin
  select count(*) into n from auth.users where email = 'admin@domainanda.com';
  if n = 0 then
    raise notice 'PERINGATAN: tidak ada user dengan email itu. Buat dulu di Authentication -> Users, atau perbaiki emailnya.';
  end if;
end $$;

-- ------------------------------------------------------- 2. VERIFIKASI ROLE ---
-- Baris ini HARUS muncul dengan role_terbaca = admin.
select email,
       (raw_app_meta_data ->> 'role') as role_terbaca,
       case when (raw_app_meta_data ->> 'role') = 'admin'
            then 'OK - akun ini boleh menulis (upload)'
            else 'BELUM admin - upload akan tetap ditolak'
       end as status
  from auth.users
 where email = 'admin@domainanda.com';

-- --------------------------------------------- 3. VERIFIKASI GRANT & POLICY ---
-- Memastikan skema tulis sudah terpasang. Kalau salah satu baris "HILANG",
-- jalankan seluruh file supabase-schema.sql sekali, lalu ulangi file ini.

-- 3a) Policy tulis khusus admin per tabel (harus ADA di keenam tabel).
select t.table_name,
       case when p.policyname is null then 'HILANG - jalankan supabase-schema.sql'
            else 'OK (' || p.policyname || ')' end as policy_tulis_admin
  from (values ('participants'),('rundown'),('expenses'),
               ('consumption'),('outing'),('outing_categories')) as t(table_name)
  left join pg_policies p
         on p.schemaname = 'public'
        and p.tablename  = t.table_name
        and p.policyname like 'admin write%'
 order by t.table_name;

-- 3b) Peran authenticated harus punya INSERT (bukti GRANT tulis sudah diberikan).
select t.table_name,
       case when has_table_privilege('authenticated', 'public.' || t.table_name, 'INSERT')
            then 'OK - authenticated boleh INSERT'
            else 'HILANG - jalankan supabase-schema.sql' end as grant_tulis
  from (values ('participants'),('rundown'),('expenses'),
               ('consumption'),('outing'),('outing_categories')) as t(table_name)
 order by t.table_name;

-- Setelah semua OK: logout di aplikasi, login pakai email + password admin ini,
-- lalu klik "↻ Upload ke Supabase".
