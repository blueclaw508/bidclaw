-- ============================================================
-- 0012_proposal_lock_version.sql
-- ============================================================
-- Phase 1.5 — optimistic concurrency for the proposal editor.
--
-- PROBLEM: two tabs editing the same proposal are last-write-wins.
-- Tab B's stale save silently overwrites tab A's edits — dogfooding
-- data at risk (LOOP.md Phase 1.5 backlog item 1).
--
-- DESIGN: proposals.lock_version is a document-level version counter.
--   • BEFORE UPDATE trigger on proposals bumps it on EVERY update.
--   • AFTER INSERT/UPDATE/DELETE triggers on proposal_lines and
--     proposal_work_areas "touch" the parent proposal row, so ANY
--     mutation anywhere in the document bumps the version (add-line
--     modals, work-area ops, line saves — all of it).
--   • The editor's save path performs a CONDITIONAL touch:
--       UPDATE proposals SET updated_at = now()
--       WHERE id = :id AND lock_version = :expected
--     0 rows = someone else changed the document since this tab
--     loaded it → data layer throws ProposalConflictError → editor
--     surfaces "changed in another tab" instead of overwriting.
--
-- Side effect (desirable): proposals.updated_at now moves on line
-- edits too, so the Proposals tab's updated_at DESC ordering reflects
-- real activity.
--
-- Cascade-delete note: when a proposal is deleted, child AFTER DELETE
-- triggers fire an UPDATE against the already-deleted parent row —
-- 0 rows affected, harmless no-op.
--
-- Additive only (RED LINE 4): new column + new trigger functions.
-- search_path pinned to '' per 0009 convention; bodies are fully
-- schema-qualified.

ALTER TABLE public.proposals
  ADD COLUMN lock_version INTEGER NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.tg_bump_proposal_lock_version()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.lock_version = OLD.lock_version + 1;
  RETURN NEW;
END;
$$;

CREATE TRIGGER proposals_bump_lock_version
  BEFORE UPDATE ON public.proposals
  FOR EACH ROW EXECUTE FUNCTION public.tg_bump_proposal_lock_version();

CREATE OR REPLACE FUNCTION public.tg_touch_parent_proposal()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  UPDATE public.proposals
  SET updated_at = now()
  WHERE id = COALESCE(NEW.proposal_id, OLD.proposal_id);
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER proposal_lines_touch_parent
  AFTER INSERT OR UPDATE OR DELETE ON public.proposal_lines
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_parent_proposal();

CREATE TRIGGER proposal_work_areas_touch_parent
  AFTER INSERT OR UPDATE OR DELETE ON public.proposal_work_areas
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_parent_proposal();
