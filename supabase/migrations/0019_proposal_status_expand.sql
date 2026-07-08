-- 0019 — expand the proposal status lifecycle to 7 freely-settable values.
-- Ian: status should be manually settable (not just triggered on send), and
-- the set is Draft / Ready to Send / Sent / Approved / In Progress / Completed
-- / Lost. Remaps the old three renamed values; draft + completed unchanged.
--   presented -> sent · accepted -> approved · declined -> lost
ALTER TABLE public.proposals DROP CONSTRAINT proposals_status_check;

UPDATE public.proposals SET status = CASE status
  WHEN 'presented' THEN 'sent'
  WHEN 'accepted'  THEN 'approved'
  WHEN 'declined'  THEN 'lost'
  ELSE status
END;

ALTER TABLE public.proposals ADD CONSTRAINT proposals_status_check
  CHECK (status IN ('draft', 'ready_to_send', 'sent', 'approved', 'in_progress', 'completed', 'lost'));
