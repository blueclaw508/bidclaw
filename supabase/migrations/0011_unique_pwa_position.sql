-- ============================================================
-- 0011_unique_pwa_position.sql
-- ============================================================
-- P1-D cleanup 3 (LOOP.md) — integrity guarantee for the position
-- pairing in duplicateProposal.
--
-- duplicateProposal pairs source → copied work areas by `position`
-- (PostgREST bulk insert+select doesn't guarantee row order, so
-- position is the join key). That pairing is only sound if position
-- is unique per proposal — this index makes the DB enforce it.
--
-- Companion code change (same commit): reorderProposalWorkAreas is
-- now two-phase (stage at negative positions, then write finals) so
-- a drag-drop swap can't transiently collide. Pre-flight verified
-- zero existing duplicates; the renumber below is a defensive no-op
-- kept for replay-safety on any DB where duplicates slipped in.

WITH renumbered AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY proposal_id
           ORDER BY position, created_at, id
         ) - 1 AS new_position
  FROM public.proposal_work_areas
)
UPDATE public.proposal_work_areas pwa
SET position = r.new_position
FROM renumbered r
WHERE pwa.id = r.id
  AND pwa.position <> r.new_position
  -- Only rewrite proposals that actually contain a duplicate position;
  -- everything else keeps its (possibly sparse) ordering untouched.
  AND pwa.proposal_id IN (
    SELECT proposal_id FROM public.proposal_work_areas
    GROUP BY proposal_id, position HAVING count(*) > 1
  );

CREATE UNIQUE INDEX idx_proposal_work_areas_unique_position
  ON public.proposal_work_areas (proposal_id, position);
