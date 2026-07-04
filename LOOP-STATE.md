# LOOP-STATE — BidClaw
Phase: 1 — Dogfooding Sprint Support
Sprint start: 2026-06-11        Gate-1 date check: 2026-06-25 (max 07-02)
Session count: 5

## ⚠️ COURSE CORRECTION (2026-06-11, from Ian's first dogfood session)
Ian's verdict: the manual flow must match QuickCalc — work areas CONTAIN
the estimate lines → per-WA approve → proposal is GENERATED (frozen at
generation), not hand-built. Full audit + 5-session plan:
docs/analysis/QC-FIDELITY-AUDIT-2026-06-11.md
Decisions locked: per-WA estimate approval (proposal keeps own lifecycle
after); INSTANT-SAVE editing (no Save/Reset bar on estimate lines);
client share/approve loop deferred.
**R1 (schema) SHIPPED in the interactive session — migration 0013:
work_area_lines table + work_areas.estimate_status + customers/projects
address split. Types updated.** R2-R5 queued below.
IMPACT ON THIS LOOP: dogfooding + eval-set targets now happen on the
Work Areas tab once R2 lands, not the proposal editor. Phase 1.5
remainder items (RPC duplicate/reorder, memoized editor validation)
are LOWER priority than R2-R5 — don't polish the surface being replaced.

## TASK QUEUE — REVISED (priority order)
1. R2: estimate entry UI on Work Areas tab (QC-style: one Add Line Item
   full-catalog modal, only-populated categories, live markup pill,
   price-override column with amber state, instant save)
2. R3: per-WA calculate/totals + estimate lifecycle (replaces generic
   WA status picker — Ian's friction #2)
3. R4: Create Proposal = generate from approved WAs (freeze at
   generation into existing proposals tables); slim proposal editor
4. R5: client fidelity (customer form split-address UI, prefill
   project job address from customer, Maps link)
5. (was queue 1-3: Phase 1.5 RPC remainder / P1-B polish / P1-C
   eval scaffolding — deprioritized behind R2-R5)

## GATE PROGRESS (current phase)
- [ ] 14 days elapsed (day 0 of sprint)
- [~] Leads & Bids pipeline live — BUILT + deployed this session; needs
      Ian's real leads flowing through stages to check off
- [ ] Eval set: 0/50 catalog items · 0/3 proposals · 0 WoZ logs
- [x] Cleanup 1 (save-path) — SHIPPED session 2 (batched save +
      falsy-zero fix; UI round-trip pending harness, see watch list)
- [x] Cleanup 2 (money consolidation) — SHIPPED session 3
      (src/lib/money.ts; Phase 2 prerequisite met)
- [ ] jamie-spec-notes.md — not started
- [ ] Hand-simulated Jamie passing last 2 evals — n/a yet

## TASK QUEUE (priority order)
1. Phase 1.5 remainder (optional): transactional duplicate/reorder via
   Postgres RPC; memoized validation in the editor
2. P1-B polish (only if Ian asks): board drag-and-drop, lead-detail
   proposal list, visual walkthrough once .env.local is restored
3. P1-C support: eval/ scaffolding when Ian's first WoZ eval is ready

## DONE (newest first — task · commit · verification)
- 2026-06-11 · Phase 1.5: optimistic concurrency — 0012 (applied +
  DB-smoke-tested: bumps on proposal update + every child line/WA
  insert/update/delete; stale conditional touch matches 0 rows,
  current matches 1 and bumps; fixture cleaned). proposals.lock_version
  + ProposalConflictError + assertProposalVersion; handleSaveAll guards
  the batch, status transitions guarded via updateProposal
  expectedLockVersion · this commit · TS-green. Multi-tab stale saves
  now error with a reload prompt instead of silently overwriting.
  Watch-list item "optimistic concurrency still open" → CLOSED.
- 2026-06-11 · P1-D cleanup 3: 0011 unique (proposal_id, position)
  index (applied + verified live) + two-phase reorder (stage negatives
  then finals — single-phase swap would violate the index, DB-proven
  via fixture test incl. cleanup); tone ternary fixed (declined →
  danger red, was always-primary no-op); ProposalEditor 1,493 → 1,052
  lines (StatusBanner/StatusMenu/transitionDescription →
  ProposalStatusControls.tsx, TotalsBreakdown → TotalsBreakdown.tsx;
  STATUS_LABEL map replaced by PROPOSAL_STATUS_CONFIG labels) · this
  commit · TS-green; encoding scan clean. NOTE: print-view not-found
  state was already shipped pre-Loop (commit 150c0b5) — verified
  present, nothing to do.
- 2026-06-11 · P1-D cleanup 2: money consolidation — src/lib/money.ts
  (lineBase/lineMarkup/lineTotal/formatUSD/categoryBearsMarkup as type
  predicate) + PROPOSAL_LINE_CATEGORY_ORDER/LABELS in statusConfig;
  6 formatUSD copies → 1, ~8 math copies → helpers, 5 bears-markup
  checks → 1, 3 label/order maps → 1 · this commit · TS-green;
  formula byte-identical (code trace); grep sweep: zero stray copies;
  mojibake check clean. Catalog.tsx formatCurrency intentionally left
  (catalog unit costs, different signature/locale — not proposal money).
- 2026-06-11 · P1-D cleanup 1: batched save path (saveProposalLines —
  one editability check, grouped writes, one subtotal sync per work
  area; kills sync race + 5N queries) + totals-card falsy-zero fix
  (count-based visibility, editor + print view) · this commit ·
  TS-green; DB consistency assert: 0 drift rows across all
  proposal_work_areas (clean baseline); code trace — patches identical
  to old path, markup guard rules mirrored. Live UI round-trip pending
  .env.local harness.
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
- .env.local is MISSING on this machine (only .env with VITE_ vars exists) —
  the Path B visual harness (verify-print-view.mjs and any leads variant)
  can't run until Ian restores SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
  there. P1-B visual walkthrough deferred to Ian's first dogfood; any
  friction is P1-A same-session priority.
- Leads P1-B conventions to know: lead stage auto-advance is FORWARD-ONLY
  (reopened/reverted proposals never demote a lead — manual board move);
  proposal declined prompts (never forces) lead → Lost in ProposalEditor.
