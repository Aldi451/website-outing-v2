-- Jalankan di Supabase SQL Editor setelah project dibuat.
-- Admin tetap memakai Supabase Auth (buat user admin dari Authentication > Users).
create table if not exists public.participants (
  id uuid primary key default gen_random_uuid(), name text not null, member_id text unique not null,
  member_password text not null, status text not null default 'Ikut' check (status in ('Ikut','Batal ikut','Tidak ikut')),
  payment text not null default 'Belum bayar' check (payment in ('Belum bayar','Bayar sebagian','Sudah bayar')),
  created_at timestamptz default now()
);
create table if not exists public.outing (id uuid primary key default gen_random_uuid(), destination text, outing_date date, description text, created_at timestamptz default now());
create table if not exists public.expenses (id uuid primary key default gen_random_uuid(), date date not null, item text not null, category text not null, amount numeric default 0, photo_url text, created_at timestamptz default now());
create table if not exists public.consumption (id uuid primary key default gen_random_uuid(), date date not null, item text not null, category text not null, amount numeric default 0, photo_url text, created_at timestamptz default now());
-- Aktifkan RLS. Untuk produksi, batasi policy write hanya admin berdasarkan user id/email.
alter table public.participants enable row level security; alter table public.outing enable row level security; alter table public.expenses enable row level security; alter table public.consumption enable row level security;
create policy "authenticated read participants" on public.participants for select to authenticated using (true);
create policy "authenticated read outing" on public.outing for select to authenticated using (true);
create policy "authenticated read expenses" on public.expenses for select to authenticated using (true);
create policy "authenticated read consumption" on public.consumption for select to authenticated using (true);
-- Tambahkan policy insert/update/delete admin sesuai email akun admin Anda.
-- Jangan simpan service_role key di frontend. Untuk login member production, lebih aman gunakan Supabase Auth user per member atau Edge Function.
