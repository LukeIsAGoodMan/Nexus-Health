-- ============================================================
-- Nexus Health V1.4 — Cloud Soul & Persistence
-- DDL: profiles + daily_logs
-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor)
-- ============================================================

-- ── profiles ─────────────────────────────────────────────────
-- Stores user body metrics & calculated targets.
-- user_id is a client-generated UUID (no auth yet).
create table if not exists profiles (
  user_id          text primary key,
  height_cm        real        not null,
  weight_kg        real        not null,
  age              int         not null,
  gender           text        not null check (gender in ('male', 'female')),
  goal             text        not null check (goal in ('loss', 'gain', 'maintain')),
  activity_level   text        not null check (activity_level in ('sedentary','light','moderate','active','very_active')),
  bmr              int         not null,
  tdee             int         not null,
  target_calories  int         not null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- ── daily_logs ───────────────────────────────────────────────
-- One row per user per day. Composite PK (user_id, log_date).
create table if not exists daily_logs (
  user_id          text        not null references profiles(user_id) on delete cascade,
  log_date         date        not null default current_date,
  calories_in      int         not null default 0,
  calories_out     int         not null default 0,
  exercise_minutes int         not null default 0,
  sleep_hours      real        not null default 0,
  water_ml         int         not null default 0,
  flush_done       boolean     not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  primary key (user_id, log_date)
);

-- ── updated_at auto-trigger ──────────────────────────────────
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_profiles_updated
  before update on profiles
  for each row execute function set_updated_at();

create trigger trg_daily_logs_updated
  before update on daily_logs
  for each row execute function set_updated_at();

-- ── RLS (permissive for now — no auth) ───────────────────────
-- Enable RLS but allow anon full access so the app works
-- without authentication. Lock this down when auth is added.
alter table profiles   enable row level security;
alter table daily_logs enable row level security;

create policy "anon_profiles_all"  on profiles   for all using (true) with check (true);
create policy "anon_daily_logs_all" on daily_logs for all using (true) with check (true);
