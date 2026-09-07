-- 0042 — a watermarked trial proposal cannot be sent.
--
-- 0037 gave a comped Pro contractor one free Jamie estimate and watermarked
-- everything that run produced until they hold Pro + AI. The watermark was
-- the whole lever: see what Jamie built, buy to lift the PREVIEW off it.
--
-- The lever had a hole. enforce_send_gate (0030) asks one question — is
-- this account entitled at all — and a comped Pro is entitled. So the
-- watermarked proposal could be marked Sent, Approved, In Progress or
-- Completed exactly like any other, and a contractor who was fine emailing
-- a client a PDF stamped PREVIEW had received the estimate for free. Ian's
-- decision: block it.
--
-- Same trigger, second question. A proposal on a project that holds
-- committed trial work stays buildable and previewable, and cannot cross
-- into a sent-or-beyond status until the owner resolves to pro_ai. The
-- check is the same predicate project_needs_ai_trial_watermark() uses,
-- inlined rather than called: that function is scoped to auth.uid() for
-- the browser's sake, and a trigger has to answer for the row's owner
-- whoever fired it.
--
-- A distinct error code, so the client can say the right sentence. The
-- generic one ("Subscribe to send proposals") is wrong for someone who
-- already subscribes to Pro; what they need is Jamie.

create or replace function public.enforce_send_gate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
begin
  -- Only a transition INTO a sent-or-beyond status is interesting. A row
  -- already at that status being edited for any other reason passes.
  if new.status = old.status then
    return new;
  end if;
  if new.status not in ('sent', 'approved', 'in_progress', 'completed') then
    return new;
  end if;

  select p.user_id into v_user_id from public.projects p where p.id = new.project_id;
  if v_user_id is null then
    return new;
  end if;

  -- Gate 2a (0030): no entitlement, no sending.
  if not public.has_active_subscription(v_user_id) then
    raise exception 'subscription_required_to_send'
      using errcode = 'P0001',
            hint = 'Subscribe to send proposals. Your free proposal can be built and previewed, but prints watermarked.';
  end if;

  -- Gate 2b (0042): entitled, but this project carries Jamie's free
  -- estimate and the owner has not bought her. The proposal prints
  -- PREVIEW and stays that way until they do.
  if exists (
    select 1
    from public.jamie_loop_runs r
    where r.project_id = new.project_id
      and r.was_ai_trial
      and r.status = 'committed'
  )
  and public.resolve_plan(v_user_id) is distinct from 'pro_ai' then
    raise exception 'ai_trial_proposal_cannot_be_sent'
      using errcode = 'P0001',
            hint = 'This estimate was built with your free Jamie trial. Upgrade to Pro + AI to send it — the PREVIEW watermark comes off the moment you do.';
  end if;

  return new;
end;
$$;

-- The trigger itself is unchanged (before update on proposals); replacing
-- the function body is enough. Restated here so this file stands alone.
drop trigger if exists enforce_send_gate_trg on public.proposals;
create trigger enforce_send_gate_trg
  before update on public.proposals
  for each row execute function public.enforce_send_gate();
