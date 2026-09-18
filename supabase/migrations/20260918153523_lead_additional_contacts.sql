create table public.lead_contacts (
 id uuid primary key default gen_random_uuid(),
 lead_id uuid not null references public.leads(id) on delete cascade,
 user_id uuid not null default bidclaw_private.workspace_owner() references auth.users(id),
 slot smallint not null check(slot between 1 and 10),
 name text not null check(length(trim(name)) between 1 and 200),
 role text not null default '' check(length(role)<=200),
 company text not null default '' check(length(company)<=200),
 email text not null default '' check(length(email)<=254),
 phone text not null default '' check(length(phone)<=80),
 created_at timestamptz not null default now(),
 unique(lead_id,slot)
);
alter table public.lead_contacts enable row level security;
revoke all on public.lead_contacts from public,anon;
grant select,insert,update,delete on public.lead_contacts to authenticated;
create policy lead_contacts_workspace on public.lead_contacts for all to authenticated
 using(user_id=bidclaw_private.workspace_owner() and exists(select 1 from public.leads l where l.id=lead_id and l.user_id=bidclaw_private.workspace_owner()))
 with check(user_id=bidclaw_private.workspace_owner() and exists(select 1 from public.leads l where l.id=lead_id and l.user_id=bidclaw_private.workspace_owner()));
create trigger company_activity_save after insert or update on public.lead_contacts for each row execute function bidclaw_private.record_company_activity('name,role,company,email,phone','Lead contact');
create trigger company_activity_delete before delete on public.lead_contacts for each row execute function bidclaw_private.record_company_activity('name,role,company,email,phone','Lead contact');
