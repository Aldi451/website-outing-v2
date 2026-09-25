-- Jalankan di Supabase SQL Editor setelah project dibuat.
-- Peserta hanya menyimpan nama, nomor telepon, status keikutsertaan, dan status pembayaran.
-- Peserta tidak dibuatkan akun Supabase maupun password.
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

-- Kategori custom juga disimpan agar seluruh input aplikasi ikut tersinkron.
create table if not exists public.outing_categories (
  name text primary key,
  created_at timestamptz default now()
);

-- Migrasi satu kali untuk database lama yang masih memakai member_id/member_password.
-- Jalankan blok ini jika tabel participants sudah dibuat dari schema versi sebelumnya.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'participants' and column_name = 'member_id'
  ) then
    execute 'alter table public.participants add column if not exists phone text';
    execute 'update public.participants set phone = coalesce(nullif(phone, ''''), member_id, '''') where phone is null or phone = ''''';
    execute 'alter table public.participants alter column phone set default ''''';
    execute 'alter table public.participants alter column phone set not null';
    execute 'alter table public.participants drop column if exists member_id';
    execute 'alter table public.participants drop column if exists member_password';
  end if;
end $$;

-- Aktifkan RLS. Untuk produksi, batasi policy write hanya admin berdasarkan user id/email.
alter table public.participants enable row level security;
alter table public.outing enable row level security;
alter table public.rundown enable row level security;
alter table public.expenses enable row level security;
alter table public.consumption enable row level security;
alter table public.outing_categories enable row level security;

create policy "authenticated read participants" on public.participants for select to authenticated using (true);
create policy "authenticated read outing" on public.outing for select to authenticated using (true);
create policy "authenticated read rundown" on public.rundown for select to authenticated using (true);
create policy "authenticated read expenses" on public.expenses for select to authenticated using (true);
create policy "authenticated read consumption" on public.consumption for select to authenticated using (true);
create policy "authenticated read outing categories" on public.outing_categories for select to authenticated using (true);

-- User admin Supabase harus memiliki app_metadata: {"role":"admin"}.
-- Policy berikut membuat hanya user dengan claim tersebut yang dapat menulis data.
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

-- Jangan simpan service_role key di frontend.
