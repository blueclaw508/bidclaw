# LOOP-STATE — BidClaw
Phase: 1 — Dogfooding Sprint Support
Sprint start: 2026-06-11        Gate-1 date check: 2026-06-25 (max 07-02)
Session count: 1

## GATE PROGRESS (current phase)
- [ ] 14 days elapsed (day 0 of sprint)
- [~] Leads & Bids pipeline live — BUILT + deployed this session; needs
      Ian's real leads flowing through stages to check off
- [ ] Eval set: 0/50 catalog items · 0/3 proposals · 0 WoZ logs
- [ ] Cleanup 1 (save-path) — not started
- [ ] Cleanup 2 (money consolidation) — not started
- [ ] jamie-spec-notes.md — not started
- [ ] Hand-simulated Jamie passing last 2 evals — n/a yet

## TASK QUEUE (priority order)
1. P1-D cleanup 1: save-path batching + totals-card filter
2. P1-D cleanup 2: money/domain consolidation (must land before Phase 2)
3. P1-B polish (only if Ian asks): board drag-and-drop, lead-detail
   proposal list, visual walkthrough once .env.local is restored

## DONE (newest first — task · commit · verification)
- 2026-06-11 · P1-B Leads & Bids pipeline (stages, CRM-lite, board+list,
  filters, lifecycle wiring) · ff94932 + this commit · TS-green build;
  live-DB smoke test (8-stage walk, CHECK rejection, note cascade,
  cleanup verified 0 rows); migration applied + verified on
  cdjpzvyqvohwmlmquldt; duplicateProposal presented_at leak checked.
  Visual walkthrough PENDING (see watch list).
- (pre-Loop) Phase 1 Prompt 3 phases 1–3: plan measure tool (PDF render,
  overlay canvas, scale calibration) · 47c66f8 · committed pre-Loop
- (pre-Loop) Phase 1 rebuild through Prompt 2: unified foundation, CRUD,
  Files tab · 8e47818..95647b8 · committed pre-Loop

## RECONCILIATION NOTES (2026-06-11, session 1)
- CORRECTION: the first drift gate this session ran against a STALE local
  clone (HEAD 47c66f8, ~3.5 weeks behind). After fetch + rebase onto
  origin/master (89831c9 = LOOP.md's hotfix #1), the codebase matches
  LOOP.md: proposals use draft/presented/accepted/declined/completed
  (0007), ProposalEditor.tsx exists (54 KB), proposals.ts is the data
  layer. The 4 "conflicts" recorded in the first commit of this file were
  stale-clone artifacts — disregard.
- Drift gate re-run vs real code: <3 conflicts. Spec's proposal-status
  list matches 0007 exactly. Open design points resolved by spec text:
  (a) board shows Ian's stage labels (Signed/Completed/In-Progress) over
  existing project statuses (approved/complete/in_progress) — no enum
  rename; (b) leads table owns pre-project stages, stage auto-advances on
  lifecycle events, manual moves allowed where no proposal exists.
- eval/ directory does not exist yet — create when first WoZ log lands.
- LESSON for future sessions: run `git fetch` BEFORE the startup
  `git log`/`git status` reconcile — a stale clone fails silently.

## WATCH LIST
- Rotate Supabase service_role key (Ian, dashboard) — Ian's to-do, do not execute
- Call 2–3 QC users for trust/pricing input — Ian's to-do, do not execute
- Optimistic concurrency still open — dogfooding data at risk on multi-tab edits
- .env.local is MISSING on this machine (only .env with VITE_ vars exists) —
  the Path B visual harness (verify-print-view.mjs and any leads variant)
  can't run until Ian restores SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
  there. P1-B visual walkthrough deferred to Ian's first dogfood; any
  friction is P1-A same-session priority.
- Leads P1-B conventions to know: lead stage auto-advance is FORWARD-ONLY
  (reopened/reverted proposals never demote a lead — manual board move);
  proposal declined prompts (never forces) lead → Lost in ProposalEditor.
