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
-- CREATE TABLE IF NOT EXISTS tidak menambah kolom pada tabel lama. Di beberapa
-- project participants sudah ada tetapi kolom name belum ada; tambahkan juga
-- semua kolom yang dipakai aplikasi (termasuk created_at untuk pengurutan).
-- Kolom baru di tabel yang sudah berisi data dibuat nullable dulu supaya tidak
-- menghapus/mengarang data lama; lihat NOTICE untuk baris yang perlu dilengkapi.
alter table public.participants add column if not exists name text;
alter table public.participants add column if not exists phone text;
alter table public.participants add column if not exists status text default 'Ikut';
alter table public.participants add column if not exists payment text default 'Belum bayar';
alter table public.participants add column if not exists created_at timestamptz default now();
alter table public.rundown add column if not exists schedule_time text;
alter table public.rundown add column if not exists activity text;
alter table public.rundown add column if not exists location text;
alter table public.rundown add column if not exists pic text;
alter table public.rundown add column if not exists notes text;
alter table public.rundown add column if not exists created_at timestamptz default now();
alter table public.outing add column if not exists destination text;
alter table public.outing add column if not exists outing_date date;
alter table public.outing add column if not exists description text;
alter table public.outing add column if not exists created_at timestamptz default now();
alter table public.expenses add column if not exists date date;
alter table public.expenses add column if not exists item text;
alter table public.expenses add column if not exists category text;
alter table public.expenses add column if not exists amount numeric default 0;
alter table public.expenses add column if not exists photo_url text;
alter table public.expenses add column if not exists created_at timestamptz default now();
alter table public.consumption add column if not exists date date;
alter table public.consumption add column if not exists item text;
alter table public.consumption add column if not exists category text;
alter table public.consumption add column if not exists amount numeric default 0;
alter table public.consumption add column if not exists photo_url text;
alter table public.consumption add column if not exists created_at timestamptz default now();
alter table public.outing_categories add column if not exists created_at timestamptz default now();

-- Pindahkan nomor telepon dari kolom lama, lalu rapikan kolomnya.
-- Catatan: project lama memakai enum member_status untuk participants.status
-- sehingga UPDATE status='Ikut' gagal 22P02. Di beberapa project ada VIEW
-- v_outing_participant_summary yang depend pada kolom status sehingga ALTER TYPE
-- gagal 0A000 cannot alter type of a column used by a view or rule.
-- Blok di bawah menangani keduanya: tambah nilai enum yang hilang, simpan definisi
-- VIEW, DROP VIEW, ubah ke text, lalu recreate.
do $$
declare
  v_def text;
  rec record;
begin
  -- 0a) Tambah nilai enum yang hilang agar UPDATE bisa sukses walau masih enum
  begin
    execute 'alter type public.member_status add value if not exists ''Ikut''';
  exception when duplicate_object then null when others then null;
  end;
  begin
    execute 'alter type public.member_status add value if not exists ''Batal ikut''';
  exception when duplicate_object then null when others then null;
  end;
  begin
    execute 'alter type public.member_status add value if not exists ''Tidak ikut''';
  exception when duplicate_object then null when others then null;
  end;
  declare
    pt text;
  begin
    select t.typname into pt
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_type t on t.oid = a.atttypid
    where n.nspname='public' and c.relname='participants' and a.attname='payment' and t.typtype='e';
    if pt is not null then
      begin execute format('alter type public.%I add value if not exists %L', pt, 'Belum bayar'); exception when others then null; end;
      begin execute format('alter type public.%I add value if not exists %L', pt, 'Bayar sebagian'); exception when others then null; end;
      begin execute format('alter type public.%I add value if not exists %L', pt, 'Sudah bayar'); exception when others then null; end;
    end if;
  end;

  -- 0b) Simpan dan DROP VIEW yang depend pada participants.status/payment
  create temp table if not exists _tmp_outing_view_defs(view_schema text, view_name text, definition text, kind text, primary key(view_schema, view_name));
  delete from _tmp_outing_view_defs;
  for rec in
    select distinct c2.oid as view_oid, c2.relname as view_name, n2.nspname as view_schema, c2.relkind as kind
    from pg_depend d
    join pg_attribute a on d.refobjid = a.attrelid and d.refobjsubid = a.attnum
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_class c2 on c2.oid = d.objid
    join pg_namespace n2 on n2.oid = c2.relnamespace
    where n.nspname='public' and c.relname='participants'
      and n2.nspname='public' and c2.relkind in ('v','m')
      and a.attname in ('status','payment')
  loop
    begin
      select pg_get_viewdef(rec.view_oid, true) into v_def;
      if v_def is not null then
        insert into _tmp_outing_view_defs(view_schema, view_name, definition, kind)
        values (rec.view_schema, rec.view_name, v_def, rec.kind)
        on conflict (view_schema, view_name) do update set definition = excluded.definition, kind = excluded.kind;
        if rec.kind = 'm' then
          execute format('drop materialized view if exists %I.%I cascade', rec.view_schema, rec.view_name);
        else
          execute format('drop view if exists %I.%I cascade', rec.view_schema, rec.view_name);
        end if;
        raise notice 'Dropped dependent % %.% for enum migration', case when rec.kind='m' then 'materialized view' else 'view' end, rec.view_schema, rec.view_name;
      end if;
    exception when others then
      raise notice 'Gagal drop view %.%: %', rec.view_schema, rec.view_name, SQLERRM;
    end;
  end loop;
  -- tangani v_outing_participant_summary secara eksplisit jika lolos deteksi
  begin
    select pg_get_viewdef('public.v_outing_participant_summary'::regclass, true) into v_def;
    if v_def is not null then
      insert into _tmp_outing_view_defs(view_schema, view_name, definition, kind)
      values ('public', 'v_outing_participant_summary', v_def, 'v')
      on conflict (view_schema, view_name) do update set definition = excluded.definition;
      execute 'drop view if exists public.v_outing_participant_summary cascade';
      raise notice 'Dropped view public.v_outing_participant_summary (explicit)';
    end if;
  exception when others then null;
  end;

  -- 0c) Ubah enum ke text (VIEW sudah di-drop jadi tidak 0A000)
  if exists (
    select 1 from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_type t on t.oid = a.atttypid
    where n.nspname = 'public' and c.relname = 'participants' and a.attname = 'status' and t.typtype = 'e'
  ) then
    begin execute 'alter table public.participants alter column status drop default'; exception when others then null; end;
    begin
      execute 'alter table public.participants alter column status type text using status::text';
    exception when others then raise notice 'Alter status to text failed: %', SQLERRM;
    end;
    begin execute 'alter table public.participants alter column status set default ''Ikut'''; exception when others then null; end;
  end if;
  if exists (
    select 1 from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_type t on t.oid = a.atttypid
    where n.nspname = 'public' and c.relname = 'participants' and a.attname = 'payment' and t.typtype = 'e'
  ) then
    begin execute 'alter table public.participants alter column payment drop default'; exception when others then null; end;
    begin
      execute 'alter table public.participants alter column payment type text using payment::text';
    exception when others then raise notice 'Alter payment to text failed: %', SQLERRM;
    end;
    begin execute 'alter table public.participants alter column payment set default ''Belum bayar'''; exception when others then null; end;
  end if;

  -- Fallback paksa ke text (hanya jika kolom ada)
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='participants' and column_name='status') then
    begin execute 'alter table public.participants alter column status type text using status::text'; exception when others then null; end;
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='participants' and column_name='payment') then
    begin execute 'alter table public.participants alter column payment type text using payment::text'; exception when others then null; end;
  end if;

  -- 0d) Recreate VIEW
  for rec in select * from _tmp_outing_view_defs loop
    begin
      v_def := replace(rec.definition, '::member_status', '::text');
      -- hapus cast ke enum lama yang mungkin masih ada (mis ::payment_status)
      -- biarkan generic, jika gagal recreate akan notice
      if rec.kind = 'm' then
        execute format('create materialized view %I.%I as %s', rec.view_schema, rec.view_name, v_def);
      else
        execute format('create view %I.%I as %s', rec.view_schema, rec.view_name, v_def);
      end if;
      raise notice 'Recreated % %.%', case when rec.kind='m' then 'materialized view' else 'view' end, rec.view_schema, rec.view_name;
    exception when others then
      begin
        -- fallback: coba sebagai view biasa jika materialized gagal atau sebaliknya
        if rec.kind = 'm' then
          execute format('create view %I.%I as %s', rec.view_schema, rec.view_name, v_def);
        else
          execute format('create materialized view %I.%I as %s', rec.view_schema, rec.view_name, v_def);
        end if;
        raise notice 'Recreated (fallback) %.%', rec.view_schema, rec.view_name;
      exception when others then
        raise notice 'Gagal recreate view %.%: % -- definisi: %', rec.view_schema, rec.view_name, SQLERRM, v_def;
      end;
    end;
  end loop;
end $$;

-- Lanjutan migrasi data (phone, status, payment, NOT NULL, dll)
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'participants' and column_name = 'member_id'
  ) then
    execute 'update public.participants set phone = coalesce(nullif(phone, ''''), member_id::text, ''-'') where phone is null or phone = '''''';
  end if;

  execute 'update public.participants set phone = ''-'' where phone is null or phone = '''''';
  begin execute 'alter table public.participants alter column phone set not null'; exception when others then null; end;
  -- pakai ::text agar aman baik untuk kolom text maupun sisa enum, dan hanya jika kolom ada
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='participants' and column_name='status') then
    execute 'update public.participants set status = ''Ikut'' where status::text is null or status::text not in (''Ikut'',''Batal ikut'',''Tidak ikut'')';
    begin execute 'alter table public.participants alter column status set default ''Ikut'''; exception when others then null; end;
    begin execute 'alter table public.participants alter column status set not null'; exception when others then null; end;
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='participants' and column_name='payment') then
    execute 'update public.participants set payment = ''Belum bayar'' where payment::text is null or payment::text not in (''Belum bayar'',''Bayar sebagian'',''Sudah bayar'')';
    begin execute 'alter table public.participants alter column payment set default ''Belum bayar'''; exception when others then null; end;
    begin execute 'alter table public.participants alter column payment set not null'; exception when others then null; end;
  end if;

  -- Jangan isi nama peserta lama dengan nama palsu. Bila tabel kosong (seperti
  -- pada laporan 0 baris) atau semua baris sudah bernama, aman memasang NOT NULL.
  if not exists (select 1 from public.participants where name is null) then
    execute 'alter table public.participants alter column name set not null';
  else
    raise notice 'Ada peserta lama tanpa nama. Lengkapi public.participants.name sebelum mewajibkan NOT NULL.';
  end if;

  execute 'alter table public.participants drop column if exists member_id';
  execute 'alter table public.participants drop column if exists member_password';

  -- bersihkan temp table VIEW jika masih ada
  begin execute 'drop table if exists _tmp_outing_view_defs'; exception when others then null; end;
end $$;

-- Bersihkan tipe enum lama yang sudah tidak dipakai.
do $$
begin
  if exists (select 1 from pg_type where typname = 'member_status' and typnamespace = 'public'::regnamespace) then
    begin
      execute 'drop type public.member_status';
    exception when others then null;
    end;
  end if;
end $$;

-- Pastikan constraint text ada untuk migrasi (hanya jika kolom ada).
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='participants' and column_name='status') then
    if not exists (select 1 from pg_constraint where conname = 'participants_status_text_check' and conrelid = 'public.participants'::regclass) then
      begin
        execute 'alter table public.participants add constraint participants_status_text_check check (status in (''Ikut'',''Batal ikut'',''Tidak ikut''))';
      exception when others then null;
      end;
    end if;
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='participants' and column_name='payment') then
    if not exists (select 1 from pg_constraint where conname = 'participants_payment_text_check' and conrelid = 'public.participants'::regclass) then
      begin
        execute 'alter table public.participants add constraint participants_payment_text_check check (payment in (''Belum bayar'',''Bayar sebagian'',''Sudah bayar''))';
      exception when others then null;
      end;
    end if;
  end if;
end $$;

-- ------------------------------------------------------------------ 3. RLS ---
alter table public.participants enable row level security;
alter table public.outing enable row level security;
alter table public.rundown enable row level security;
alter table public.expenses enable row level security;
alter table public.consumption enable row level security;
alter table public.outing_categories enable row level security;

-- Grant SQL diperlukan selain policy RLS pada project yang tidak memakai
-- default privilege Supabase. Policy tetap menentukan baris mana yang boleh.
grant usage on schema public to anon, authenticated;
grant select on public.participants, public.outing, public.rundown,
  public.expenses, public.consumption, public.outing_categories to anon, authenticated;
grant insert, update, delete on public.participants, public.outing, public.rundown,
  public.expenses, public.consumption, public.outing_categories to authenticated;
revoke insert, update, delete on public.participants, public.outing, public.rundown,
  public.expenses, public.consumption, public.outing_categories from anon;

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
--   update auth.users
--      set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}'::jsonb
--    where email = 'admin@domainanda.com';
-- Login di aplikasi memakai email + password user tersebut.
drop policy if exists "admin write participants" on public.participants;
drop policy if exists "admin write outing" on public.outing;
drop policy if exists "admin write rundown" on public.rundown;
drop policy if exists "admin write expenses" on public.expenses;
drop policy if exists "admin write consumption" on public.consumption;
drop policy if exists "admin write outing categories" on public.outing_categories;
-- Menjalankan ulang schema mengembalikan mode aman, termasuk jika OPSI 3
-- pernah dinyalakan. Policy anon lain yang dibuat manual perlu diaudit sendiri.
drop policy if exists "anon write participants" on public.participants;
drop policy if exists "anon write outing" on public.outing;
drop policy if exists "anon write rundown" on public.rundown;
drop policy if exists "anon write expenses" on public.expenses;
drop policy if exists "anon write consumption" on public.consumption;
drop policy if exists "anon write outing categories" on public.outing_categories;

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

-- OPSI 3 (TIDAK AMAN, TANPA akun Supabase): siapa pun yang mengetahui anon key
-- di config.js bisa menulis/menghapus SELURUH data, tanpa perlu login lokal.
-- Tidak disarankan untuk data peserta. Jika benar-benar diperlukan, jalankan
-- GRANT berikut beserta keenam CREATE POLICY; menjalankan ulang file ini akan
-- menonaktifkan opsi ini lagi (REVOKE + DROP POLICY di atas).
-- grant insert, update, delete on public.participants, public.outing, public.rundown,
--   public.expenses, public.consumption, public.outing_categories to anon;
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
left join pg_namespace n on n.nspname = 'public'
left join pg_class c on c.relnamespace = n.oid and c.relname = expected.table_name and c.relkind in ('r', 'p')
order by pemeriksaan;

-- Meminta PostgREST memperbarui schema cache setelah membuat tabel/kolom.
notify pgrst, 'reload schema';
-- Jalankan supabase-diagnose.sql untuk memeriksa kolom dan policy secara lengkap.
-- Jangan simpan service_role key di frontend.
