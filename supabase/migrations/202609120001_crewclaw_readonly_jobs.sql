create table public.crewclaw_job_tokens (
 token_hash text primary key check(length(token_hash)=64),
 user_id uuid not null references auth.users(id) on delete cascade,
 workspace_id uuid not null, company_id uuid not null,
 expires_at timestamptz not null, created_at timestamptz not null default now()
);
alter table public.crewclaw_job_tokens enable row level security;
revoke all on public.crewclaw_job_tokens from public,anon,authenticated;
grant select,insert,delete on public.crewclaw_job_tokens to service_role;
comment on table public.crewclaw_job_tokens is 'Hashed 15-minute read-only CrewClaw import grants. No estimate or proposal write access.';
