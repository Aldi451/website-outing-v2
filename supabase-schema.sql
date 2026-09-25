-- ============================================================================
-- Outing Hub - schema Supabase
-- Jalankan SELURUH file ini di Supabase -> SQL Editor -> Run.
-- Aman dijalankan berulang kali (idempotent), termasuk untuk database lama.
--
-- Tabel yang dipakai aplikasi:
--   participants, rundown, expenses, consumption, outing, outing_categories
-- ============================================================================

-- ---------------------------------------------------------------- 1. TABEL ---
create table if not exists public.participants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text not null,
  status text not null default 'Ikut' check (status in ('Ikut','Batal ikut','Tidak ikut')),
  payment text not null default 'Belum bayar' check (payment in ('Belum bayar','Bayar sebagian','Sudah bayar')),
  created_at timestamptz default now()
);

create table if not exists public.outing (
  id uuid primary key default gen_random_uuid(),
  destination text,
  outing_date date,
  description text,
  created_at timestamptz default now()
);

create table if not exists public.rundown (
  id uuid primary key default gen_random_uuid(),
  schedule_time text not null,
  activity text not null,
  location text,
  pic text,
  notes text,
  created_at timestamptz default now()
);

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  item text not null,
  category text not null,
  amount numeric default 0,
  photo_url text,
  created_at timestamptz default now()
);

create table if not exists public.consumption (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  item text not null,
  category text not null,
  amount numeric default 0,
  photo_url text,
  created_at timestamptz default now()
);

create table if not exists public.outing_categories (
  name text primary key,
  created_at timestamptz default now()
);

-- --------------------------------------------- 2. MIGRASI DATABASE LAMA -----
-- Mengisi kolom yang belum ada pada tabel versi sebelumnya (mis. tabel yang
-- dulu memakai member_id / member_password atau belum punya kolom payment).
alter table public.participants add column if not exists phone text;
alter table public.participants add column if not exists payment text;
alter table public.participants add column if not exists status text;
alter table public.rundown add column if not exists location text;
alter table public.rundown add column if not exists pic text;
alter table public.rundown add column if not exists notes text;
alter table public.outing add column if not exists destination text;
alter table public.outing add column if not exists outing_date date;
alter table public.outing add column if not exists description text;
alter table public.expenses add column if not exists amount numeric default 0;
alter table public.expenses add column if not exists photo_url text;
alter table public.consumption add column if not exists amount numeric default 0;
alter table public.consumption add column if not exists photo_url text;

-- Pindahkan nomor telepon dari kolom lama, lalu rapikan kolomnya.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'participants' and column_name = 'member_id'
  ) then
    execute 'update public.participants set phone = coalesce(nullif(phone, ''''), member_id, ''-'') where phone is null or phone = ''''';
  end if;

  execute 'update public.participants set phone = ''-'' where phone is null or phone = ''''';
  execute 'alter table public.participants alter column phone set not null';
  execute 'update public.participants set status = ''Ikut'' where status is null or status not in (''Ikut'',''Batal ikut'',''Tidak ikut'')';
  execute 'update public.participants set payment = ''Belum bayar'' where payment is null or payment not in (''Belum bayar'',''Bayar sebagian'',''Sudah bayar'')';
  execute 'alter table public.participants alter column status set not null';
  execute 'alter table public.participants alter column payment set not null';

  execute 'alter table public.participants drop column if exists member_id';
  execute 'alter table public.participants drop column if exists member_password';
end $$;

-- ------------------------------------------------------------------ 3. RLS ---
alter table public.participants enable row level security;
alter table public.outing enable row level security;
alter table public.rundown enable row level security;
alter table public.expenses enable row level security;
alter table public.consumption enable row level security;
alter table public.outing_categories enable row level security;

-- ------------------------------------------------------- 4. POLICY MEMBACA ---
-- OPSI 1 (default): siapa saja boleh MEMBACA. Ini yang membuat mode lihat /
-- login "member" bisa menampilkan data Supabase tanpa akun Supabase.
-- PERHATIAN privasi: data peserta (nama + nomor telepon) bisa dibaca siapa pun
-- yang tahu URL website dan anon key di config.js. Kalau tidak diinginkan,
-- komentari blok ini dan pakai OPSI 2 di bawah.
drop policy if exists "authenticated read participants" on public.participants;
drop policy if exists "authenticated read outing" on public.outing;
drop policy if exists "authenticated read rundown" on public.rundown;
drop policy if exists "authenticated read expenses" on public.expenses;
drop policy if exists "authenticated read consumption" on public.consumption;
drop policy if exists "authenticated read outing categories" on public.outing_categories;
drop policy if exists "public read participants" on public.participants;
drop policy if exists "public read outing" on public.outing;
drop policy if exists "public read rundown" on public.rundown;
drop policy if exists "public read expenses" on public.expenses;
drop policy if exists "public read consumption" on public.consumption;
drop policy if exists "public read outing categories" on public.outing_categories;

create policy "public read participants" on public.participants for select using (true);
create policy "public read outing" on public.outing for select using (true);
create policy "public read rundown" on public.rundown for select using (true);
create policy "public read expenses" on public.expenses for select using (true);
create policy "public read consumption" on public.consumption for select using (true);
create policy "public read outing categories" on public.outing_categories for select using (true);

-- OPSI 2: kalau data tidak boleh dibaca publik, komentari enam baris create
-- policy di atas dan aktifkan enam baris berikut. Ingat: dengan opsi ini semua
-- orang (termasuk admin) HARUS login memakai akun Supabase untuk melihat data.
-- create policy "authenticated read participants" on public.participants for select to authenticated using (true);
-- create policy "authenticated read outing" on public.outing for select to authenticated using (true);
-- create policy "authenticated read rundown" on public.rundown for select to authenticated using (true);
-- create policy "authenticated read expenses" on public.expenses for select to authenticated using (true);
-- create policy "authenticated read consumption" on public.consumption for select to authenticated using (true);
-- create policy "authenticated read outing categories" on public.outing_categories for select to authenticated using (true);

-- -------------------------------------------------------- 5. POLICY MENULIS ---
-- Hanya user Supabase dengan app_metadata {"role":"admin"} yang boleh menulis.
-- Buat user di Authentication -> Users, lalu set app_metadata-nya, mis:
--   update auth.users set raw_app_meta_data = '{"provider":"email","providers":["email"],"role":"admin"}'
--   where email = 'admin@domainanda.com';
-- Login di aplikasi memakai email + password user tersebut.
drop policy if exists "admin write participants" on public.participants;
drop policy if exists "admin write outing" on public.outing;
drop policy if exists "admin write rundown" on public.rundown;
drop policy if exists "admin write expenses" on public.expenses;
drop policy if exists "admin write consumption" on public.consumption;
drop policy if exists "admin write outing categories" on public.outing_categories;

create policy "admin write participants" on public.participants for all to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
create policy "admin write outing" on public.outing for all to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
create policy "admin write rundown" on public.rundown for all to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
create policy "admin write expenses" on public.expenses for all to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
create policy "admin write consumption" on public.consumption for all to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
create policy "admin write outing categories" on public.outing_categories for all to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- OPSI 3 (paling cepat, TANPA akun Supabase): biarkan login lokal admin/power88
-- bisa menulis. Risikonya: anon key ada di config.js, jadi siapa pun yang membuka
-- website bisa mengubah data. Aktifkan hanya kalau risikonya diterima.
-- create policy "anon write participants" on public.participants for all to anon using (true) with check (true);
-- create policy "anon write outing" on public.outing for all to anon using (true) with check (true);
-- create policy "anon write rundown" on public.rundown for all to anon using (true) with check (true);
-- create policy "anon write expenses" on public.expenses for all to anon using (true) with check (true);
-- create policy "anon write consumption" on public.consumption for all to anon using (true) with check (true);
-- create policy "anon write outing categories" on public.outing_categories for all to anon using (true) with check (true);

-- ------------------------------------------------------------- 6. VERIFIKASI ---
-- Lihat hasilnya di tab Results; semua baris harus "OK".
select 'tabel ' || expected.table_name as pemeriksaan,
       case when c.relname is null then 'HILANG' else 'OK' end as status_kolom,
       case when c.relname is null
            then 'Tabel belum ada. Pastikan blok 1 di atas berhasil dijalankan.'
            else 'RLS ' || case when c.relrowsecurity then 'aktif' else 'nonaktif' end end as keterangan
from (values ('participants'),('rundown'),('expenses'),('consumption'),('outing'),('outing_categories')) as expected(table_name)
left join pg_class c on c.relname = expected.table_name
left join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
where c.relname is null or n.nspname = 'public'
order by pemeriksaan;

-- Jangan simpan service_role key di frontend.
