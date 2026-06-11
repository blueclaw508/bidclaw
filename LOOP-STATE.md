# LOOP-STATE — BidClaw
Phase: 1 — Dogfooding Sprint Support
Sprint start: 2026-06-11        Gate-1 date check: 2026-06-25 (max 07-02)
Session count: 1

## GATE PROGRESS (current phase)
- [ ] 14 days elapsed (day 0 of sprint)
- [ ] Leads & Bids pipeline live with real leads
- [ ] Eval set: 0/50 catalog items · 0/3 proposals · 0 WoZ logs
- [ ] Cleanup 1 (save-path) — not started
- [ ] Cleanup 2 (money consolidation) — not started
- [ ] jamie-spec-notes.md — not started
- [ ] Hand-simulated Jamie passing last 2 evals — n/a yet

## TASK QUEUE (priority order)
1. P1-B: Leads & Bids pipeline — drift-gate the schema, then build
   (stages, CRM fields, filters, proposal-status wiring)
2. P1-D cleanup 1: save-path batching + totals-card filter
3. P1-D cleanup 2: money/domain consolidation (must land before Phase 2)

## DONE (newest first — task · commit · verification)
- (pre-Loop) Phase 1 Prompt 3 phases 1–3: plan measure tool (PDF render,
  overlay canvas, scale calibration) · 47c66f8 · committed pre-Loop
- (pre-Loop) Phase 1 rebuild through Prompt 2: unified foundation, CRUD,
  Files tab · 8e47818..95647b8 · committed pre-Loop

## RECONCILIATION NOTES (2026-06-11, session 1)
- Repo was rebuilt 2026-05-14 (commit 8e47818); old history (incl. hotfix
  89831c9 referenced in the LOOP.md §5 template) lives on
  origin/pre-rebuild-archive, not master.
- eval/ directory does not exist yet — create when first WoZ log lands.
- Working tree clean at session start (HEAD 47c66f8).

## P1-B DRIFT GATE — STOPPED, AWAITING IAN (2026-06-11, session 1)
Pattern C scan of the LOOP.md P1-B spec vs the rebuilt codebase found 4
conflicts (threshold 3) → stop-and-ask per Loop §4. No migration written.

1. Stage names vs projects.status CHECK: spec stages Signed/Completed/
   Pending/Leads don't exist in the DB enum (draft, estimating, proposed,
   approved, in_progress, complete, lost, archived — 0001 migration +
   types.ts + statusConfig.ts). Recommended: new leads table owns
   pre-project stages (Leads, Pending); after conversion the stage is the
   project status displayed under Ian's labels (approved→"Signed",
   complete→"Completed", in_progress→"In-Progress"). No enum rename.
2. Proposal statuses: spec says map from draft/presented/accepted/
   declined/completed, but the rebuilt proposals.status CHECK is
   draft/sent/approved/rejected/expired (pre-rebuild status list no
   longer exists). Recommended mapping: sent→Proposed, approved→Signed,
   rejected→Lost (with confirm), expired→surface as follow-up due.
3. Lead contact vs customers table: spec gives leads their own contact
   fields; customers table already holds the same fields. Recommended:
   leads carry their own contact (a lead isn't a customer yet); converting
   creates/links a customer + project, customer_id nullable on leads.
4. P1-D Cleanup 1 (save-path batching, totals-card filter, ProposalEditor
   1,443 lines, duplicateProposal) targets pre-rebuild code that does not
   exist on master — there is no proposal UI in the rebuild at all.
   Affects Gate 1 criterion "Cleanup items 1–2 verified shipped."
   Recommended: mark Cleanup 1 N/A-for-rebuild in Gate 1; keep Cleanup 2
   (money.ts helpers) as a hard Phase 2 prerequisite (greenfield).

NEXT SESSION: if Ian has answered, build P1-B per the locked answers
(additive migration → data layer → board/list UI → lifecycle wiring).

## WATCH LIST
- Rotate Supabase service_role key (Ian, dashboard) — Ian's to-do, do not execute
- Call 2–3 QC users for trust/pricing input — Ian's to-do, do not execute
- Optimistic concurrency still open — dogfooding data at risk on multi-tab edits
- Plan measure tool (Prompt 3): phases 1–3 committed; confirm with Ian whether
  later phases remain or tool is feature-complete
