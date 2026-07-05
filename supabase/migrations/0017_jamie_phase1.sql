-- 0017 — Jamie (AI estimating agent) Phase 1.
--
-- Jamie is a PAID UPGRADE. The manual estimate system (R1-R8) works
-- fully without her; turning her on is the upgrade. Two pieces:
--
--   1. company_settings.jamie_enabled — the entitlement flag. Default
--      FALSE. Enforced BOTH client-side (button locked when off) and
--      server-side (the jamie-estimate edge function 403s if off) so
--      nobody can hit the paid AI by calling the function directly.
--
--   2. jamie_runs — an audit log of every Jamie call (input scope, the
--      structured JSON she returned, model, token usage). This is the
--      active-learning spine: it's how we later see what she built, what
--      Ian corrected, and which catalog gaps recur.

-- ── Entitlement flag ──────────────────────────────────────────────────
ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS jamie_enabled boolean NOT NULL DEFAULT false;

-- ── Run audit log ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.jamie_runs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  work_area_id uuid REFERENCES public.work_areas(id) ON DELETE SET NULL,
  scope_input  text,
  had_image    boolean NOT NULL DEFAULT false,
  model        text,
  status       text NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'error')),
  result       jsonb,
  error        text,
  input_tokens  integer,
  output_tokens integer,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS jamie_runs_user_created_idx
  ON public.jamie_runs (user_id, created_at DESC);

ALTER TABLE public.jamie_runs ENABLE ROW LEVEL SECURITY;

-- A contractor sees and writes only their own runs. The edge function
-- runs under the caller's JWT, so these policies scope its INSERT too.
DROP POLICY IF EXISTS jamie_runs_select_own ON public.jamie_runs;
CREATE POLICY jamie_runs_select_own ON public.jamie_runs
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS jamie_runs_insert_own ON public.jamie_runs;
CREATE POLICY jamie_runs_insert_own ON public.jamie_runs
  FOR INSERT WITH CHECK (user_id = auth.uid());
