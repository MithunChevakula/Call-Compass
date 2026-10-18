create extension if not exists "pgcrypto";

create table if not exists calls (
  id uuid primary key default gen_random_uuid(),
  prospect_name text not null,
  company text not null,
  caller_name text not null default 'Me',
  context text not null default '',
  current_stage text not null default 'opening',
  status text not null default 'active' check (status in ('active', 'closed')),
  outcome text,
  ai_summary text,
  ai_model text,
  started_at timestamptz not null default now(),
  ended_at timestamptz
);

create table if not exists stage_results (
  id uuid primary key default gen_random_uuid(),
  call_id uuid not null references calls(id) on delete cascade,
  stage text not null,
  result text not null,
  prospect_words text not null default '',
  recorded_at timestamptz not null default now()
);

alter table calls enable row level security;
alter table stage_results enable row level security;
