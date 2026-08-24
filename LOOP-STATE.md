# LOOP-STATE — BidClaw

## ⚑ KYN METHODOLOGY — THE RULE JAMIE KEEPS DRIFTING FROM (2026-08-24)
Ian's correction, verbatim: "Jamie is supposed to come up with quantities
and for materials/subs the costs plus markup (universal from My Numbers)
and hours x retail labor rates (from My Numbers)....so nothing should be
zero."

THE CONTRACT, in one place, because this has now broken twice:
  QUANTITIES   Jamie's job. Kit factors x measured quantity.
  MATERIALS    unit_cost = BASE cost (what Ian PAYS). BidClaw applies the
               materials markup from My Numbers. Never pre-marked-up.
  SUBS         unit_cost = BASE sub cost. Subs markup applied by BidClaw.
  LABOR        qty = man-hours (Jamie's projection). unit_cost = the
               RETAIL labor rate from My Numbers, VERBATIM. No markup —
               the retail rate is already fully burdened.
  EQUIPMENT    qty = hours. unit_cost = the equipment rate from My
               Numbers, verbatim. No markup.
  NOTHING IS ZERO. Not in the catalog is NOT a reason to return 0 — she
  prices it from real supplier pricing and flags needs_pricing, which
  means "Jamie's figure, confirm it", never "$0".
  markup_override stays NULL on a FORWARD estimate (follows My Numbers).
  Only REVERSE INGESTION pins a markup, because there the signed price is
  sacrosanct.

HOW IT BROKE (both times a prompt line, not a code bug):
- J3's Pass 2 prompt said "Anything you cannot price from the catalog:
  unit_cost 0 and needs_pricing true. Never invent a price you don't have
  a basis for." With Ian's near-empty catalog that produced a 27-line
  takeoff with 16 lines at $0 — a valid-looking estimate that under-bid
  the job. Fixed 287ec8b.
- RI wrote the BILLED amount into unit_cost at 0% markup, so every
  material line claimed zero margin. Fixed + backfilled earlier the same
  day.

CANNOT BE ENFORCED IN THE SCHEMA. Structured output supports NEITHER
`exclusiveMinimum` NOR `minimum` on numbers — both 400 with "not
supported for 'number' type" (verified 2026-08-24). Do not retry it. The
rule is enforced by the ⚑ block in the Pass 2 prompt and by Gate 2, which
disables the commit button while an approved line has no cost.

VERIFIED by npm run verify:jamie-loop, assertions 5b/5c/6b:
  5b every staged line has a real qty and unit_cost
  5c labor/equipment match a CONFIGURED My Numbers rate, not an invented one
  6b markup_override NULL on forward estimates
Last run 10/10: 47 lines, cheapest $1.15/unit, 8 rates matched,
cost $40,297 -> billed $48,872.30, margin $8,575.30 (50% mat / 34.9% subs).

## J4 — JAMIE READS THE PROJECT'S FILES + FULL-PAGE WORKSPACE (2026-08-24) — SHIPPED
Ian tried to start a real proposal (Levinson / McPhee Builders), uploaded
3 plan sheets + the bid form, and Jamie said "I don't see anything attached
on my end." She was telling the truth. His verdict: "There should not be
two places to upload...only one file repository per project", "I don't
like Jamie Chat on the side", "I don't even know intuitively what to click
next."

THE BUG. Two file systems existed and Jamie was wired to the wrong one:
  project_files / `project-files` bucket  PDF/images/Word/Excel, 50MB —
                                          what the Files tab writes;
                                          Jamie could NOT see it.
  `jamie-images` bucket                   images only, chat-panel upload —
                                          the only thing she could see.

THE FIX (one repository, and it is the Files tab):
- 0025: anthropic_file_id / anthropic_synced_at / anthropic_sync_error on
  project_files.
- jamie-chat syncProjectFiles(): each file is pushed to the Anthropic
  FILES API once and referenced by id thereafter. Lazy + self-healing;
  a failure is written to the row, never thrown, so one bad file cannot
  block an estimate. Word/Excel get a plain-English "export to PDF".
- Documents ride on the FIRST user turn so they sit in the cached prefix —
  plan sheets are the most expensive thing in the request.
- beta.messages + betas ['files-api-2025-04-14'] (required on BOTH the
  upload and the message that references the file).
- src/pages/JamieWorkspace.tsx at /app/projects/:projectId/jamie: files
  rail (read-only, names every file, flags unreadable ones with the
  reason) + conversation + gates inline. Composer takes TEXT ONLY.
- The J2 side panel is DELETED. Two surfaces for one job was the problem.
- "Build with Jamie" on the project header AND leading the empty Work
  Areas tab (secondary "Add work area myself") — that tab is where a
  contractor gets stuck.
- "Start over" abandons the run and opens a fresh one: history is replayed
  verbatim, so a session begun before the fix still carries her "I don't
  see anything attached" reply and she believes it.

LIVE-VERIFIED on Ian's real Levinson project: she read all 4 sheets and
returned quantities off the drawings (921 SF gravel drive, 160 LF cobble
edging, 195 face-feet fieldstone veneer wall, TOC 22.34 / BOC 14.84, full
plant list), then cross-referenced McPhee's spec and flagged that sheets
L1 and L2.0 are MISSING and that she needs L2.0 to size lawn/loam/
irrigation. 39.6s, $0.146.

END-TO-END 8/8 against PRODUCTION on a throwaway project (script kept in
the session scratchpad, not committed): empty WA tab -> workspace ->
chat -> Propose -> Gate 1 (2 work areas, KYN scope with kit factors:
0.014 ton/SF dense grade, 0.008 ton/SF mason sand, 0.21 hr/SF mason,
1.10 stone waste, 0.13 EA/LF restraint) -> Gate 2 (27 lines) -> committed
$18,450, zero console errors, fixtures deleted.

GOTCHA the walk caught: the rail counted SYNCED files, so a freshly
opened workspace said "0 of 1 project file" — the same scare all over
again. It now counts files WITHOUT a sync error (a2f1200).

NOT A BUG, worth knowing: 16 of those 27 lines came back at $0
needs_pricing because Ian's Item Catalog holds ONE material item. Labor
and equipment priced correctly from My Numbers. Populate the catalog (or
price at Gate 2, which the UI supports) and that number drops.

## RI COST RECOVERY (2026-08-24) — SHIPPED + BACKFILLED
Ian: "Although the reverse ingestion worked, it didn't reverse out price
and show markup back to original cost." He was right — RI put the BILLED
amount in unit_cost at markup_override 0, so every material line claimed
ZERO margin (2000 x $0.60 cost + 0.00% = $1,200.00). Correct total,
useless numbers; knowing your numbers is the whole point.
commitIngestedProposal now UNWINDS the contractor's own markup back out:
unit_cost = billed / (1 + m/100), markup_override = m, using the same
category rule the app renders with (material -> materials markup;
subcontractor + other -> subs markup; labor + equipment never bear markup
because KYN rates already include margin). Billed is unchanged to the
penny. Done deterministically on COMMIT, not in the prompt — the model is
not trusted with this arithmetic, same as the GC balancer.
- Pool-sub lines (markup_pct 10) pass through untouched: already a cost basis.
- markup_override is PINNED, not left to live settings, so retuning
  markups later cannot drift a proposal away from the signed price.
- GC balancer still runs LAST and stays at 0% — it is a rounding plug, and
  it absorbs the sub-cent drift from dividing a cost basis.
- verify-ingest-commit now FAILS if any markup-bearing line sits at 0%,
  and reports the cost/billed/margin split. 2/2 live.
- scripts/backfill-ingest-markup.mjs (npm run backfill:ingest-markup,
  dry-run by default) retrofitted the old imports. APPLIED: 18 work areas,
  48 lines, every customer-facing total unchanged. Ian's Landscaping Work
  now reads 2000 x $0.40 + 50% = $1,200.
  Signature for "this was reverse-ingested": markup_override is NULL on a
  hand-built line (NULL = live markup) and RI is the only thing that
  writes an explicit 0 to EVERY line of a work area.

## ⚠️ THE JAMIE LOOP — J0-J2 SHIPPED IN JULY, NEVER RECORDED HERE
Between Phase 1 and master's tip there is a whole second Jamie arc that
LOOP-STATE never captured. Reconstructed from commits 2026-08-24:
  J0  6648194  data foundations — jamie_loop_runs (status machine:
      in_progress / awaiting_wa_approval / awaiting_line_approval /
      committed / rejected / abandoned / error), jamie_messages,
      jamie_proposed_work_areas (Gate 1 staging), jamie_proposed_lines
      (Gate 2 staging), jamie_invocations metering, subscription_tier_limits.
      Migrations 0020-0023.
  J1a 386cf38  jamie-chat Edge Function skeleton — auth, gate, metering,
      streaming, prompt-cache structure.
  J1b 354f2b6  scripts/verify-jamie.mjs autonomous harness.
  J1c f2b7bfe  legacy jamie-estimate metering (recording only).
  J2  d2b29e7  JamieChatPanel — streaming UI, image attach, session resume,
      run-status chip. Project-anchored: ONE active run per project.
The arc's plan (J3 brain, J5/J8 prompt growth, J6 retire jamie-estimate,
J7 cleanup) exists ONLY in code comments — there is no spec file. Grep
"J3"/"J6"/"J8" in supabase/functions/jamie-chat and JamieChatPanel.

## J3 — WHOLE-PROJECT BRAIN + TWO GATES (2026-08-24) — SHIPPED + LIVE-VERIFIED 7/7
Replaces the ECHO stub with the real KYN brain and adds whole-project mode.
DEPLOYED to cdjpzvyqvohwmlmquldt and verified end to end: npm run
verify:jamie-loop walks chat -> Pass 1 -> Gate 1 -> Pass 2 -> Gate 2 against
the live function and DB, 7/7, 81s, $0.2158 for the whole loop, fixtures
cleaned up. On a two-scope Osterville job Jamie proposed "Rear Bluestone
Terrace" + "Front Walk & Granite Entry Steps" and built a 12-line takeoff
(material/labor/equipment/other incl. a General Conditions line).

What was built:
- supabase/functions/jamie-chat/index.ts — three actions over the one
  pipeline: "chat" (conversational scope-gathering), "propose_work_areas"
  (PASS 1 -> stages jamie_proposed_work_areas, run -> awaiting_wa_approval),
  "propose_lines" (PASS 2 -> stages jamie_proposed_lines for every APPROVED
  staged WA, run -> awaiting_line_approval). Structured output via
  output_config json_schema (same shape jamie-ingest proved). Pass deltas
  are SWALLOWED server-side — raw JSON would paint the chat bubble — and a
  jamie_progress heartbeat goes out instead; the readable summary is sent
  as one synthetic text delta after staging succeeds.
- CONVERSATION REPLAY: J1/J2 sent only the latest message, so Jamie could
  not gather scope across turns. J3 replays jamie_messages (text only —
  re-downloading every historical photo per turn would multiply latency and
  spend) and trims trailing user turns so the API never sees two same-role
  turns in a row.
- MODEL: estimation slot moved claude-opus-4-8 -> claude-opus-5. Same price
  ($5/$25), 1M context. This WAS the "RE-VERIFY at J8" note in the router —
  pulled forward because J3 is the first phase that actually spends. Opus
  4.8 stays in MODEL_PRICING for historical rows and for jamie-ingest,
  which is still pinned to it and was deliberately left untouched.
- src/lib/jamieLoop.ts — commitWorkAreaGate (Gate 1: approved staged WAs ->
  real work_areas appended after the contractor's existing ones, stamps
  inserted_work_area_id; rejected marked and RETAINED per J0) and
  commitLineGate (Gate 2: approved staged lines -> work_area_lines on the
  WA their parent created, stamps inserted_work_area_line_id, run ->
  committed), plus listProposedWorkAreas / listProposedLines. Both gates
  commit CLIENT-SIDE under the user's own RLS — the edge function only ever
  writes staging rows.
- ADDITIVE-ONLY (Ian confirmed 2026-08-24): Jamie proposes NEW work areas
  and may set source_work_area_id to flag "this looks like your existing X",
  but commitWorkAreaGate deliberately never acts on that flag. She never
  edits, renames, or deletes a work area the contractor made.
- src/components/jamie/GateReview.tsx — WorkAreaGate + LineGate. Everything
  defaults to APPROVED (the contractor is hunting the one wrong line, not
  ticking twenty boxes). Gate 2 holds qty/cost as LOCAL STRING state and
  parses on commit, per session-discipline 1A Pattern A.
- supabase/functions/_shared/kitReference.ts — KIT_REFERENCE extracted so
  the ingest brain and the loop brain share one copy. jamie-ingest still
  carries its inline duplicate; dedupe on its next change.

BUG CAUGHT BY THE HARNESS: the first cut read projects.job_address, which
does not exist — R5 split it into site_address_line1/city/state/zip with the
legacy freeform site_address left dormant. Because the query used
.maybeSingle() without checking .error, it degraded SILENTLY to a blank
address rather than failing. Fixed + redeployed. Lesson: a Supabase select
of a non-existent column is not an exception, it is an empty result.

VERIFIED: npx tsc -b --noEmit exit 0; npm run build OK; eslint on the
touched files adds ZERO new errors (the one hit is the pre-existing
`service: any` in loadUsage); npm run verify:jamie-loop 7/7 live.
NOT COVERED YET: the UI legs. GateReview.tsx has never been rendered in a
browser — the harness drives the API and replays the gate commits in node.
Walk both gates in the panel before trusting the UI.

STILL OPEN:
1. scripts/verify-jamie.mjs (J1/J2) is STALE — asserts the ECHO stub in 7
   places and pins claude-opus-4-8, so it now FAILS against a correct J3.
   Its header lists the assertions to write. verify-jamie-loop.mjs is the
   J3 replacement for the API legs; the J2 UI legs still need porting.
2. Prompt caching is NOT hitting (cached_input_tokens 0 across all three
   invocations) — each action builds a different system prompt, so the
   cached prefix never repeats within a run. Worth restructuring at J8:
   put the stable identity + KYN + KIT_REFERENCE block first with the
   cache breakpoint after it, and the action-specific task text after.
3. The gate commits exist TWICE — jamieLoop.ts (browser, real path) and
   verify-jamie-loop.mjs (node, replayed). Change one, change both.

## PRODUCTION IS NOW GIT-BUILT FROM MASTER (2026-08-24) — TRAP CLOSED
Master WAS stuck at e9520f6 (2026-07-12) while production ran a commitless
dist upload, so any push to master would have rebuilt prod from July code
and wiped reverse ingestion off the live site. Closed on 2026-08-24:
feature/reverse-ingestion fast-forwarded into master (9 commits, 0 behind)
and pushed. Netlify auto-built and published deploy
6a8c9059b2bd1d0008083a33; the site's branch URL moved from a bare deploy
hash to master--bidclaw.netlify.app, i.e. it is a real git build now.
Verified live: /assets/ImportProposalModal-*.js, JamieChatPanel-*.js and
jamieLoop-*.js all 200 on bluebidclaw.app.
master == feature/reverse-ingestion == cf28b94. Pushing master is SAFE
again. Work can go back onto master, or keep using the branch and merge —
just don't let master drift six weeks behind a second time.

## RI2 — IN-APP PROPOSAL IMPORT (2026-08-21, f99c1be)
"Import proposal" on the Estimates page (founder-gated via
canInvokeJamie) opens a 4-step modal: upload a PDF (bundled pdfjs, lazy —
only ships when the modal opens) or paste text (Word/CoWork) -> Jamie
rebuilds it (streamed jamie-ingest, rotating status line + live "N work
areas so far" to carry the 1-3 min Opus call) -> review (customer, site,
base total, work areas with confidence dots, editable estimate name, pool
jobs flagged "coded to Blue Water Pools"; totals LOCKED to the proposal)
-> Create estimate -> commitIngestedProposal -> navigates to the new
estimate; card lands on Leads & Bids at the base total.
Files: src/lib/pdfText.ts (pdfjs getTextContent, hasEOL preserves the
"Total ... $" lines), src/lib/jamieIngest.ts (SSE transport + live
work-area counter), src/components/ingest/ImportProposalModal.tsx,
Projects.tsx (gated entry button + lazy modal).
Verified 5/5 end-to-end (Playwright: local UI -> live fn -> real commit)
on Scott Davidson $32,261 / 3 work areas; test estimate cleaned up.

## BCA POOL-SUBCONTRACTOR RULE + GUARANTEED RECONCILIATION (2026-08-21, 32cc292)
Ian's rule: on a BCA reconstruction ALL pool-builder scope is subbed to
Blue Water Pools, so it is coded Subcontractor at COST (stated / 1.10)
with markup_pct 10, and BidClaw re-applies the 10% so the client total is
unchanged. jamie-ingest emits pool scope (gunite pool/spa/baja bench +
pool equipment: salt gen, automation, heater, covers) as ONE
subcontractor line at stated/1.10; BCA-self hardscape/softscape stay
decomposed at markup_pct 0. commitIngestedProposal RECOMPUTES the
"General Conditions & Rounding" balancer per work area so billed ==
stated to the penny regardless of any slip in the model's arithmetic.
THE STATED TOTAL IS IAN'S REAL PRICE AND IS NEVER TRUSTED TO THE LLM'S
MATH. verify-ingest treats Jamie's raw GC arithmetic as a quality signal,
not a gate (commit guarantees exactness).
Live-verified: Pinkham gunite pool commits as subcontractor "Blue Water
Pools" cost $93,181.82 + 10% = $102,500 billed; every WA reconciles;
board card correct + baby-blue.

## RI1 + RI-COMMIT — JAMIE-INGEST BRAIN (2026-08-20, da1cd68)
Upload an outside proposal (CoWork/Word/PDF) -> Jamie rebuilds it as a
BidClaw estimate that lands on Leads & Bids. TWO LAYERS IN ONE PASS:
  Layer 1  work areas + scope + STATED totals, base vs. option, skip T&C
  Layer 2  line-item takeoff per WA, DECOMPOSED from the scope quantities
           + kit reference + the contractor's rates, reconciled to each
           stated total via a General Conditions balancer line.
supabase/functions/jamie-ingest: one-shot structured-output edge fn —
streamed, founder-gated (gate copied verbatim from src/lib/jamieGate.ts),
metered, Opus at 32k max_tokens (a 24-work-area proposal overran 16k).
Decomposition model: proposal prices are FINAL (margin inside), so
unit_cost = billed amount, never marked up; lines sum to the stated
total. Gunite pool / spa / equipment = low-confidence subcontractor
lumps; allowances + "by others"/NIC handled.
src/lib/ingest.ts commitIngestedProposal is client-agnostic (browser or
node): customer + estimate + base work areas + lines (markup_override 0
so billed == stated) + a Leads & Bids card with est_value = base_total
and inferred region/town; options + payment terms + exclusions go to
project notes.
Harnesses: scripts/verify-ingest.mjs 5/5 on Ian's real proposals
(Valente/Goff/Davidson/Pinkham/Weedweeder incl. the .docx) — Layer 1
exact to the dollar, Layer 2 every WA reconciles; scripts/
verify-ingest-commit.ts (npm run verify:ingest-commit) 2/2 committed
end-to-end. Live-verified on bluebidclaw.app: Pinkham baby-blue
$335,484, Davidson white $32,261.
DO NOT REBUILD JAMIE-INGEST. The brain and the commit path are proven.
Candidates after RI2 (NOT confirmed — ask Ian): RI3 in the reverse-
ingestion arc, or Jamie P2 from the Phase 1 note (web-search Layer 1,
whole-project mode with all WAs + two-gate, pricing new_catalog_items
in-context).

## JAMIE PHASE 1 SHIPPED (2026-07-05, interactive session, 401293e)
The AI estimating agent is LIVE. "Ask Jamie" on a work area -> edge fn
`jamie-estimate` (Deno, claude-opus-4-8, structured JSON) prices the WA
from a scope using the contractor's own catalog + labor/equipment rates
+ markups -> review modal -> Add N lines (addWorkAreaLinesBulk). PAID
UPGRADE: company_settings.jamie_enabled (0017, default false), enforced
client + server (fn 403s if off). jamie_runs audit table (own-row RLS).
ANTHROPIC_API_KEY already set on the project; jamie_enabled=true for Ian.
Live-verified 200 w/ a real 4-line KYN estimate (27hr labor full crew day,
skid loader, disposal w/ live markup, GC line, Nantucket gap Q). Next
(P2): web-search Layer 1; whole-project mode (all WAs + two-gate); price
new_catalog_items in-context. DO NOT rebuild Jamie in the loop.
WARNING for harness authors: target modal fields by unique placeholder,
NOT getByRole('textbox').first() — it hit the WA name field + renamed a
real WA (restored via SQL).

## R6 + FLOW COHERENCE (2026-07-04, interactive session, eb11e82)
Ian dogfooded and hit a TWO-WORLDS bug: the estimate-first flow (R1-R5)
and the OLD Phase-2 manual proposal paths both existed. Old paths made
empty $0 proposals ("+ New proposal"; "Add from project" attached empty
WA shells). FIXED — removed both, deleted the two orphan modal files,
deleted the stale $0 proposal. Now ONE path: estimate -> approve ->
Create Proposal. ProposalEditor is review/adjust of the frozen snapshot
(no more work-area-add). Migration 0016 reconciles work_area_lines.
markup_override (loop's 3b3410f applied the column live but never wrote
the file). Loop's 3b3410f already fixed the greyed Create Proposal
(now "Approve all & create") + $0 sidebar.
REMAINING QC GAP (Ian flagged): PDF output formats. QC has Detailed /
Summary(=Proposal) / Crew; BidClaw print view does Detailed only. This
is the next build (call it R7). Print view = src/pages/ProposalPrintView.tsx.
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
**R1 (schema) SHIPPED — migration 0013. R2 (estimate entry UI) SHIPPED
in the interactive session: WorkAreaEstimate + WorkAreaLineRow +
AddLineItemModal on the Work Areas tab, instant-save, live-verified
end-to-end on Ian's real 50 Lovers Lane project (add -> qty -> reload
-> persisted; test line cleaned up after).R3 SHIPPED (interactive
session): estimate lifecycle (Drafting/Approved badge + Approve button
in estimate footer; generic WA status picker REMOVED — friction #2
closed), live Project Estimate totals card (no Calculate button —
instant-save can't go stale), kit bulk-add (KitToEstimateModal via
previewKitLines; markup snapshot ignored, live math), per-category
line drag-reorder. Live-verified on 50 Lovers Lane; Ian was dogfooding
LIVE during verification (his 3 lines preserved, test data surgically
removed).**
R3.1 SHIPPED: '+ Custom' items save to the Item Catalog (QC parity,
Ian's live feedback) + migration 0014 subcontractor catalog category.
R4 SHIPPED (interactive session): generateProposalFromEstimates —
Create Proposal button on the Work Areas tab freezes approved WAs'
live estimates into the existing proposals tables at generation time
(D1 relocated to its correct trigger). Migration 0015 adds
proposal_lines.price_override; money.ts lineTotal/lineMarkup are
override-aware (override -> markup displays as override-base so
base+markup=total holds everywhere); 3 lean selects widened.
Live-verified: override $250 line froze with base $20 + markup 50% +
override carried verbatim; denorm subtotal = 250 (override-aware
sync proven); drafting WAs excluded; unnamed/zero-qty lines skipped
with toast count. R5 queued below.
DEFERRED from R4: slimming the proposal editor to review-only (its
edit powers are harmless as the adjust surface); ProjectDetail
sidebar 'Estimated value' still proposal-fed. NUANCE: editing markup
on an overridden proposal line doesn't change its total (override
wins) — acceptable v1, revisit if dogfood friction.
NOTE: kits table is EMPTY — the 25-kit jamie-kit-library was never
seeded in-app. Kit modal ships with graceful empty state. Seeding the
library is a dogfood-sprint task (feeds the 50-catalog-item gate).
NOTE for R4/R5: ProjectDetail sidebar 'Estimated value' still reads
from proposals ($0) while the tab's PROJECT ESTIMATE card shows live
estimate totals — reconcile in R4.
IMPACT ON THIS LOOP: dogfooding + eval-set targets now happen on the
Work Areas tab once R2 lands, not the proposal editor. Phase 1.5
remainder items (RPC duplicate/reorder, memoized editor validation)
are LOWER priority than R2-R5 — don't polish the surface being replaced.

## TASK QUEUE — REVISED (priority order)
1. (R5 SHIPPED in interactive session — REWORK COMPLETE R1-R5:
   split billing/site/job addresses across NewCustomerModal,
   CustomerDetail, NewProjectModal (prefills from customer, legacy
   freeform falls back into Street), ProjectDetail Details tab
   (blur-save + Google Maps link), print view resolves split-with-
   legacy-fallback chain. Live-verified: blur-save persistence, print
   render, prefill. Legacy freeform columns stay dormant with amber
   re-enter hints.)
3. (was queue 1-3: Phase 1.5 RPC remainder / P1-B polish / P1-C
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
- 2026-08-24 · Leads 11x17 print fixes: 95-char word-boundary
  description clip + .lpv-column break-inside avoid -> auto (a 24-lead
  stage was forcing one sheet per stage) · e46ffa3 · TS-green build.
- 2026-08-21 · RI2 in-app proposal import (upload/paste -> Jamie ->
  review -> estimate) · f99c1be · 5/5 Playwright end-to-end (local UI ->
  live jamie-ingest -> real commit): founder gate, streaming progress,
  review screen, navigation, and Leads & Bids card all confirmed;
  review screen inspected clean + on-brand; test estimate cleaned up.
- 2026-08-21 · BCA pool-subcontractor rule + penny-exact reconciliation
  (per-line markup_pct; GC balancer recomputed on commit) · 32cc292 ·
  live-verified on Pinkham ($93,181.82 sub cost + 10% = $102,500
  billed); every committed WA billed == stated.
- 2026-08-20 · RI1 + RI-commit: jamie-ingest edge fn (streamed,
  founder-gated, metered, Opus 32k) + commitIngestedProposal · da1cd68 ·
  verify-ingest 5/5 on Ian's real proposals; verify-ingest-commit 2/2;
  live-verified on bluebidclaw.app (Pinkham baby-blue $335,484,
  Davidson white $32,261).
- 2026-07-29 · Leads & Bids: baby blue pool shading + Download PDF ·
  bcd2652 · TS-green build.
- 2026-07-29 · Leads & Bids: printable 11x17 pipeline report
  (src/pages/LeadsPrintView.tsx) · 515c0cf · TS-green build.
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
- ⚠️ 2026-08-24: the ANTHROPIC API CREDIT BALANCE ran out mid-verification.
  Jamie is DOWN for every user until credits are added (console.anthropic.com
  → Plans & Billing). Nothing in the app is broken; it cannot reach the API.
  Verification runs are real spend — a full verify:jamie-loop is ~$0.30 and
  a whole-project pass on big plan sets is more. Batch them, and do not
  re-run a harness to confirm something already proven.
- ⚠️ DEPLOYED BUT UNVERIFIED: the rule that an equipment/labor rate the
  contractor has NOT configured must be flagged needs_pricing. The harness
  caught Jamie pricing a Cement Mixer at $15/hr unflagged; the fix is live
  but the confirming run died on the empty credit balance. Re-run
  verify:jamie-loop assertion 5c once credits are back.
- ⚠️ Ian's ITEM CATALOG is nearly empty — 1 material, 1 equipment, 2 other,
  1 subcontractor. Jamie prices labor + equipment fine (My Numbers), but
  returns $0 needs_pricing for most materials because she has no basis.
  On a 27-line takeoff 16 came back unpriced. Not a bug; populate the
  catalog or price at Gate 2. Revisit before judging estimate quality.
- ⚠️ jamie-images bucket is now LEGACY. Nothing writes to it (the panel
  that did is deleted); jamie-chat still READS refs so old sessions render.
  Retire the bucket once no run references it.
- ⚠️ jamie-ingest still carries its own inline copy of KIT_REFERENCE.
  _shared/kitReference.ts is the shared one jamie-chat uses. Dedupe on the
  next jamie-ingest change.
- ⚠️ The J3/J4 harnesses are split: verify-jamie-loop.mjs (API legs, 7/7)
  and the throwaway e2e walk (UI legs, 8/8, kept in the session scratchpad
  only — NOT committed). verify-jamie.mjs (J1/J2) is still ECHO-stale.
  Fold the UI walk into a committed harness next session.
- Rotate Supabase service_role key (Ian, dashboard) — Ian's to-do, do not execute
- Call 2–3 QC users for trust/pricing input — Ian's to-do, do not execute
- RESOLVED 2026-08-24: .env.local now EXISTS with SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY and VERIFY_USER_EMAIL, so the Path B harnesses
  can run. (The old entry claiming it was missing was six weeks stale.)
- ⚠️ scripts/verify-jamie.mjs is STALE against J3 — it asserts the ECHO stub
  in 7 assertions and pins claude-opus-4-8. It will fail against a correct
  J3. Rewrite it in the session that deploys J3; the file header lists the
  assertions to write.
- Leads P1-B conventions to know: lead stage auto-advance is FORWARD-ONLY
  (reopened/reverted proposals never demote a lead — manual board move);
  proposal declined prompts (never forces) lead → Lost in ProposalEditor.
- RESOLVED 2026-08-24: the commitless-prod trap is closed. master was
  fast-forwarded to the branch tip and pushed; Netlify git-built and
  published 6a8c9059b2bd1d0008083a33. Pushing master is safe again.
- RESOLVED 2026-08-24: `npm run verify:ingest` now exists (it never did,
  despite da1cd68's message claiming it). `npm run verify:jamie-loop`
  added alongside it for J3.
- RESOLVED 2026-08-24: supabase/.temp/ is now gitignored.
- ⚠️ J3's GateReview.tsx has NEVER been rendered in a browser. The 7/7
  harness drives the API and replays the gate commits in node; the panel
  UI legs are unproven. Walk both gates in the app before trusting them.
- ⚠️ Prompt caching is not hitting on jamie-chat (cached_input_tokens 0
  across all three J3 invocations) — each action builds a different system
  prompt so the cached prefix never repeats. Fix at J8 by putting the
  stable identity + KYN + KIT_REFERENCE block first with the cache
  breakpoint after it, and the action-specific task text last.
- ⚠️ The gate commit logic exists TWICE — src/lib/jamieLoop.ts (the real
  browser path) and scripts/verify-jamie-loop.mjs (replayed in node,
  because a .mjs harness cannot import the browser data layer). Change
  one, change both.
