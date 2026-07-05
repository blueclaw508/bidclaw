-- 0018 — BidClaw paywall: plan tiers + free-tier estimate gate.
--
-- Tiers (see blueclaw-app-pricing):
--   free   — $0, capped at 5 estimates (proposals) per calendar month, no AI
--   pro    — $39/mo | $399/yr, unlimited estimates, no AI
--   pro_ai — $499/mo | $5,588/yr, unlimited + Jamie (AI)
--
-- The "estimate" meter = proposals created this calendar month (the
-- sendable deliverable). Enforced SERVER-SIDE by a BEFORE INSERT trigger
-- so it can't be bypassed from the client. jamie_enabled (0017) stays the
-- AI gate; pro_ai implies it.

-- ── Plan column ───────────────────────────────────────────────────────
ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS plan text NOT NULL DEFAULT 'free'
    CHECK (plan IN ('free', 'pro', 'pro_ai'));

-- ── Server-side estimate-limit gate ───────────────────────────────────
-- SECURITY DEFINER so it can read the owner's plan + count across their
-- proposals regardless of the caller's RLS view. search_path pinned
-- (matches the 0009/0030 hardening pattern).
CREATE OR REPLACE FUNCTION public.enforce_estimate_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_plan    text;
  v_count   integer;
BEGIN
  SELECT p.user_id INTO v_user_id FROM public.projects p WHERE p.id = NEW.project_id;
  IF v_user_id IS NULL THEN
    RETURN NEW; -- orphan/unknown owner — don't block
  END IF;

  SELECT cs.plan INTO v_plan
  FROM public.company_settings cs
  WHERE cs.user_id = v_user_id;

  -- Paid plans (pro / pro_ai) are unlimited. Only 'free' is metered.
  IF v_plan IS DISTINCT FROM 'free' THEN
    RETURN NEW;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.proposals pr
  JOIN public.projects pj ON pj.id = pr.project_id
  WHERE pj.user_id = v_user_id
    AND pr.created_at >= date_trunc('month', now());

  IF v_count >= 5 THEN
    RAISE EXCEPTION 'estimate_limit_reached'
      USING ERRCODE = 'P0001',
            HINT = 'The BidClaw free plan allows 5 estimates per month. Upgrade to create more.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_estimate_limit_trg ON public.proposals;
CREATE TRIGGER enforce_estimate_limit_trg
  BEFORE INSERT ON public.proposals
  FOR EACH ROW EXECUTE FUNCTION public.enforce_estimate_limit();

-- Owner (Ian) is on the AI tier.
UPDATE public.company_settings cs
SET plan = 'pro_ai'
FROM auth.users u
WHERE cs.user_id = u.id AND u.email = 'ianm@blueclawassociates.com';
