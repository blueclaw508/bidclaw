alter table public.company_settings
  add column if not exists pdf_show_company_name boolean not null default true;
