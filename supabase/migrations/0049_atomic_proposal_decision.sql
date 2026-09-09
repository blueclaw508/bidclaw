-- Status and signature must succeed together. Service-only; the public edge
-- handler validates the request and this function rechecks the live share.
create or replace function public.record_proposal_decision(p_token text, p_decision jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  link public.proposal_shares%rowtype;
  proposal public.proposals%rowtype;
  signature public.proposal_signatures%rowtype;
  decision text := p_decision->>'decision';
begin
  select * into link from public.proposal_shares where token = p_token for update;
  if not found or link.revoked_at is not null or link.expires_at <= now() then
    raise exception 'This proposal link is no longer available';
  end if;
  select * into proposal from public.proposals where id = link.proposal_id for update;
  if not found or proposal.status <> 'sent' or exists (
    select 1 from public.proposal_signatures s where s.proposal_id = link.proposal_id and s.decision = 'accepted'
  ) then raise exception 'This proposal is no longer open for a decision'; end if;
  if decision is null or decision not in ('accepted', 'declined')
    or length(btrim(coalesce(p_decision->>'signer_name', ''))) < 2 then
    raise exception 'A decision and signer name are required';
  end if;
  if decision = 'accepted' and (
    p_decision->'agree' is distinct from 'true'::jsonb
    or coalesce(p_decision->>'signature_data', '') !~ '^data:image/png;base64,[A-Za-z0-9+/=]{100,}$'
    or length(p_decision->>'signature_data') > 300000
  ) then raise exception 'A signature and agreement are required'; end if;

  if decision = 'accepted' then
    update public.proposals set status = 'approved' where id = proposal.id;
  end if;
  insert into public.proposal_signatures (
    proposal_id, share_id, decision, signer_name, signer_email,
    signature_data, decline_reason, ip_address, user_agent
  ) values (
    proposal.id, link.id, decision, left(btrim(p_decision->>'signer_name'), 120),
    left(p_decision->>'signer_email', 254),
    case when decision = 'accepted' then p_decision->>'signature_data' end,
    case when decision = 'declined' then left(p_decision->>'decline_reason', 2000) end,
    left(p_decision->>'ip_address', 64), left(p_decision->>'user_agent', 500)
  ) returning * into signature;
  return jsonb_build_object(
    'id', signature.id, 'decision', signature.decision,
    'signer_name', signature.signer_name, 'signer_email', signature.signer_email,
    'signature_data', signature.signature_data, 'decline_reason', signature.decline_reason,
    'signed_at', signature.signed_at
  );
end;
$$;
revoke all on function public.record_proposal_decision(text, jsonb) from public, anon, authenticated;
grant execute on function public.record_proposal_decision(text, jsonb) to service_role;
