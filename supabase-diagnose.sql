-- ============================================================================
-- Outing Hub - pemeriksaan Supabase
-- Tempel seluruh file ini di Supabase -> SQL Editor -> Run.
-- Tidak mengubah data apa pun. Hasilnya menunjukkan tabel/kolom/policy mana
-- yang belum siap, sehingga penyebab "data hanya tersimpan lokal" langsung
-- kelihatan.
-- ============================================================================

-- ------------------------------------------- 1. RINGKASAN TABEL & POLICY -----
with expected(table_name) as (
  values ('participants'), ('rundown'), ('expenses'), ('consumption'),
         ('outing'), ('outing_categories')
),
keberadaan as (
  select e.table_name,
         c.relname is not null as tabel_ada,
         coalesce(c.relrowsecurity, false) as rls_aktif,
         (select count(*) from pg_policies p
           where p.schemaname = 'public' and p.tablename = e.table_name) as jumlah_policy,
         (select count(*) from pg_policies p
           where p.schemaname = 'public' and p.tablename = e.table_name and p.cmd = 'SELECT') as policy_baca,
         (select count(*) from pg_policies p
           where p.schemaname = 'public' and p.tablename = e.table_name and p.cmd <> 'SELECT') as policy_tulis
  from expected e
  left join pg_namespace n on n.nspname = 'public'
  left join pg_class c on c.relnamespace = n.oid and c.relname = e.table_name and c.relkind in ('r', 'p')
)
select 'Tabel ' || table_name as pemeriksaan,
       case
         when not tabel_ada then 'HILANG'
         when not rls_aktif then 'RLS NONAKTIF'
         when policy_baca = 0 then 'TANPA POLICY BACA'
         when policy_tulis = 0 then 'TANPA POLICY TULIS'
         else 'OK'
       end as status,
       case
         when not tabel_ada then 'Jalankan supabase-schema.sql untuk membuat tabel ini.'
         when not rls_aktif then 'Jalankan supabase-schema.sql (blok RLS) atau: alter table public.' || table_name || ' enable row level security;'
         when policy_baca = 0 then 'Tabel tidak bisa dibaca aplikasi. Jalankan supabase-schema.sql (blok 4).'
         when policy_tulis = 0 then 'Tabel tidak bisa ditulis -> data hanya masuk lokal. Jalankan supabase-schema.sql (blok 5) atau aktifkan OPSI 3 di blok itu.'
         else 'Siap dipakai. Policy: ' || policy_baca || ' baca, ' || policy_tulis || ' tulis.'
       end as keterangan
from keberadaan
order by pemeriksaan;

-- -------------------------------------------- 2. KOLOM YANG BELUM LENGKAP ----
-- Menampilkan kolom yang diharapkan aplikasi tetapi belum ada di tabel.
with expected(table_name, kolom) as (
  values
    ('participants', 'id'), ('participants', 'name'), ('participants', 'phone'),
    ('participants', 'status'), ('participants', 'payment'), ('participants', 'created_at'),
    ('rundown', 'id'), ('rundown', 'schedule_time'), ('rundown', 'activity'),
    ('rundown', 'location'), ('rundown', 'pic'), ('rundown', 'notes'), ('rundown', 'created_at'),
    ('expenses', 'id'), ('expenses', 'date'), ('expenses', 'item'),
    ('expenses', 'category'), ('expenses', 'amount'), ('expenses', 'photo_url'), ('expenses', 'created_at'),
    ('consumption', 'id'), ('consumption', 'date'), ('consumption', 'item'),
    ('consumption', 'category'), ('consumption', 'amount'), ('consumption', 'photo_url'), ('consumption', 'created_at'),
    ('outing', 'id'), ('outing', 'destination'), ('outing', 'outing_date'), ('outing', 'description'), ('outing', 'created_at'),
    ('outing_categories', 'name')
)
select e.table_name || '.' || e.kolom as kolom_hilang,
       'Jalankan blok 2 (migrasi) di supabase-schema.sql.' as keterangan
from expected e
where exists (select 1 from information_schema.tables t
              where t.table_schema = 'public' and t.table_name = e.table_name)
  and not exists (select 1 from information_schema.columns c
                  where c.table_schema = 'public' and c.table_name = e.table_name and c.column_name = e.kolom)
order by 1;

-- ------------------------------------ 3. KOLOM LAMA DARI VERSI SEBELUMNYA ----
select c.table_name,
       c.column_name,
       'Kolom lama. Jalankan blok 2 di supabase-schema.sql untuk memindahkan data ke kolom phone.' as keterangan
from information_schema.columns c
where c.table_schema = 'public'
  and c.column_name in ('member_id', 'member_password')
order by 1, 2;

-- ------------------------------------------------- 4. DAFTAR SEMUA POLICY ----
-- Untuk memastikan policy baca/tulis benar-benar ada dan untuk siapa.
select p.tablename, p.policyname, p.cmd as perintah, p.roles, p.qual as syarat_baca, p.with_check as syarat_tulis
from pg_policies p
where p.schemaname = 'public'
order by p.tablename, p.cmd, p.policyname;

-- ------------------------------------------- 5. AKUN ADMIN SUPAYA BISA NULIS --
-- Menampilkan user Supabase beserta claim role-nya. Yang bisa menulis adalah
-- user dengan raw_app_meta_data ->> 'role' = 'admin'.
select u.email,
       coalesce(u.raw_app_meta_data ->> 'role', '(tidak ada)') as role_admin,
       case when u.raw_app_meta_data ->> 'role' = 'admin'
            then 'OK - bisa dipakai login admin di aplikasi'
            else 'Belum admin. Jalankan contoh perintah di bawah.' end as keterangan
from auth.users u
order by u.created_at;

-- Contoh perintah untuk menjadikan sebuah user sebagai admin (ganti emailnya):
-- update auth.users
--    set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}'::jsonb
--  where email = 'admin@domainanda.com';
