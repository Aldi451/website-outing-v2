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
--   2) Ganti email pada DUA baris bertanda "<<< GANTI EMAIL DI SINI" (isinya sama).
--   3) Supabase -> SQL Editor -> tempel SELURUH file ini -> Run.
--   4) Lihat tab Results: baris "role admin" harus berstatus OK, dan baris
--      policy/grant keenam tabel tidak boleh "HILANG".
--   5) Di aplikasi: logout, lalu login memakai email + password itu.
--
-- Aman dijalankan berulang kali. TIDAK menyentuh data peserta/outing.
--
-- Catatan teknis: file ini 100% SQL biasa sehingga jalan di Supabase SQL Editor
-- maupun psql. Tidak ada meta-command psql (\set, \i, dst) yang bikin error
-- "42601: syntax error at or near \" --.
-- ============================================================================

-- ------------------------------------------------------- 1. SET ROLE ADMIN ---
-- Menambahkan {"role":"admin"} ke app_metadata tanpa menghapus metadata lain.
do $$
declare
  admin_email text := 'admin@domainanda.com';  -- <<< GANTI EMAIL DI SINI
  n int;
begin
  update auth.users
     set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
                             || '{"role":"admin"}'::jsonb
   where email = admin_email;

  get diagnostics n = row_count;

  if n = 0 then
    raise notice 'PERINGATAN: tidak ada user dengan email %. Buat dulu di Authentication -> Users (atau perbaiki emailnya), lalu jalankan ulang file ini.', admin_email;
  else
    raise notice 'OK: % baris diupdate, email % sekarang punya app_metadata.role = admin.', n, admin_email;
  end if;
end $$;

-- ------------------------------------------------------- 2. VERIFIKASI TOTAL ---
-- SATU hasil (tab Results) berisi: role admin + policy tulis + grant tulis.
-- Semua baris "status" harus diawali OK. Kalau ada "HILANG", jalankan seluruh
-- file supabase-schema.sql sekali, lalu ulangi file ini.
with cfg(admin_email) as (
  values ('admin@domainanda.com')            -- <<< GANTI EMAIL DI SINI (sama seperti di atas)
),
tabel(nama) as (
  values ('participants'), ('rundown'), ('expenses'),
         ('consumption'), ('outing'), ('outing_categories')
),
cek_role as (
  select 1 as urutan,
         'role admin' as kategori,
         coalesce(u.email, c.admin_email) as item,
         case when u.id is null
                then 'HILANG - user belum dibuat di Authentication -> Users (atau email salah)'
              when (u.raw_app_meta_data ->> 'role') = 'admin'
                then 'OK - akun ini boleh menulis (upload)'
              else 'BELUM admin - upload akan tetap ditolak'
         end as status
    from cfg c
    left join auth.users u on u.email = c.admin_email
),
cek_policy as (
  select 2 as urutan,
         'policy tulis admin' as kategori,
         t.nama as item,
         case when p.policyname is null
                then 'HILANG - jalankan supabase-schema.sql'
              else 'OK (' || p.policyname || ')'
         end as status
    from tabel t
    left join pg_policies p
           on p.schemaname = 'public'
          and p.tablename  = t.nama
          and p.policyname like 'admin write%'
),
cek_grant as (
  select 3 as urutan,
         'grant tulis (INSERT)' as kategori,
         t.nama as item,
         case when has_table_privilege('authenticated'::name,
                                       format('public.%I', t.nama)::regclass,
                                       'INSERT')
                then 'OK - authenticated boleh INSERT'
              else 'HILANG - jalankan supabase-schema.sql'
         end as status
    from tabel t
)
select kategori, item, status
  from (select * from cek_role
        union all
        select * from cek_policy
        union all
        select * from cek_grant) v
 order by urutan, item;

-- Setelah semua OK: logout di aplikasi, login pakai email + password admin ini,
-- lalu klik "↻ Upload ke Supabase".
