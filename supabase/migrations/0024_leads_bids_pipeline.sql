-- 0024 — Leads & Bids pipeline integration (Ian's dashboard parity)
--
-- Replicates the Leads_and_Bids_DASHBOARD.xlsx model: a lead is a
-- PROJECT-first pipeline row (Project Name · Address · Description ·
-- Date · Location/region · Source · Value), and EVERY estimate lives on
-- the board — created directly or converted from a lead.
--
-- 1) Field parity: project_name / description / region / est_value.
--    Contact name becomes OPTIONAL (the sheet has rows like
--    "? - Nantucket" — a lead can exist before anyone knows the contact).
-- 2) Backfill: every non-archived project without a linked lead gets
--    one, staged from the better of (project status, best proposal
--    status) — proposals existing means at least Proposed.
--    est_value intentionally NOT backfilled here: the app syncs it from
--    getProposalTotals (the same math the PDF shows) — a SQL
--    approximation could disagree with the displayed grand total.

ALTER TABLE leads
  ADD COLUMN project_name TEXT,
  ADD COLUMN description TEXT,
  ADD COLUMN region TEXT,
  ADD COLUMN est_value NUMERIC;

ALTER TABLE leads ALTER COLUMN name DROP NOT NULL;

COMMENT ON COLUMN leads.region IS
  'Territory per the BCA dashboard: CAPE COD / NANTUCKET / METRO BOSTON (free text — new regions welcome).';
COMMENT ON COLUMN leads.est_value IS
  'Pipeline dollar value: guess at Lead/Pending, estimate value at Estimating, proposal grand total from Proposed on (synced by the app).';

-- Backfill — one linked lead per project that has none.
INSERT INTO leads
  (user_id, name, project_name, stage, project_id, town, created_at)
SELECT
  p.user_id,
  c.name,                                   -- contact from the customer, when linked
  p.name,
  best.stage,
  p.id,
  p.site_address_city,
  p.created_at
FROM projects p
LEFT JOIN customers c ON c.id = p.customer_id
CROSS JOIN LATERAL (
  SELECT CASE GREATEST(
    -- project status → pipeline rank
    CASE p.status
      WHEN 'proposed'    THEN 3
      WHEN 'approved'    THEN 4
      WHEN 'in_progress' THEN 5
      WHEN 'complete'    THEN 6
      WHEN 'lost'        THEN 7
      ELSE 2                               -- draft/estimating → Estimating
    END,
    -- best proposal status → rank (any proposal existing = at least
    -- Proposed; a lost PROPOSAL is not a lost LEAD — rank 3)
    COALESCE((
      SELECT MAX(CASE pr.status
        WHEN 'approved'    THEN 4
        WHEN 'in_progress' THEN 5
        WHEN 'completed'   THEN 6
        ELSE 3
      END)
      FROM proposals pr WHERE pr.project_id = p.id
    ), 0)
  )
    WHEN 3 THEN 'proposed'
    WHEN 4 THEN 'signed'
    WHEN 5 THEN 'in_progress'
    WHEN 6 THEN 'completed'
    WHEN 7 THEN 'lost'
    ELSE 'estimating'
  END AS stage
) best
WHERE p.status <> 'archived'
  AND NOT EXISTS (SELECT 1 FROM leads l WHERE l.project_id = p.id);
