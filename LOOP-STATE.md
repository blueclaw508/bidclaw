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

## ⚑ PASS 2 TIMED OUT AND THERE WAS NO WAY BACK (2026-09-04) — FIXED
Found live on Ian's Justin Helferich proposal: 30 work areas, 6 copies of
the same 5, ZERO line items on any of them.

Root cause, from the invocation rows + edge logs: the Pass 2 request ran
**152,365 ms**. Supabase kills an edge function at **150,000 ms**. The kill
lands mid-stream, AFTER the SSE headers are out, so:
- the edge log says `POST | 200` (headers already sent),
- the client sees the stream stop with no `jamie_staged` and no
  `jamie_error`,
- the invocation row keeps `ended_at = null` and no tokens — neither the
  success finalize NOR the catch block ran,
- nothing stages, and the run never leaves Gate 1.

Every propose_lines attempt on that run (turns 6, 9, 12, 15, 20) has that
exact signature. Why this project: 5 big hardscape areas in one 32k-token
high-effort call, plus up to 6 web searches with their pause_turn
continuations (shipped the day before), plus the Sonnet scope-check
round-trip — all serialized inside one 150s budget.

THE SECOND BUG, which is what turned a timeout into 30 work areas: **a dead
Pass 2 had no retry.** The contractor lands back in chat, and the only
button that does anything is "Propose again" — which re-proposes and, on
approval, inserts a SECOND copy of every work area. Six rounds of that.

Fixed:
- **Pass 2 is chunked.** `proposed_work_area_ids` on the request prices just
  those staged work areas; the workspace walks the approved list 2 at a
  time, each chunk with its own 150s budget. Ids are re-checked against the
  run server-side.
- **Gate 2 opens only when every approved work area has lines** — a partial
  takeoff never reaches the contractor as if it were the whole job, and each
  chunk's reply says how many work areas are still to price.
- **The search budget follows the chunk**, not the job: `2 × work areas`,
  capped at 6.
- **"Build the takeoff" resume card.** Any approved work area with no staged
  lines shows up with its name and a button, and says outright not to
  propose again. `listWorkAreasAwaitingLines()` is the query behind it.
- The chunk walker stops the moment a chunk doesn't land, rather than
  burning the next one the same way.

Data cleanup done on the project: 25 duplicate work areas deleted (all had
0 lines, no measurements, not on any proposal), survivors renumbered 0-4.

NOT WALKED IN A BROWSER.

## "ENTER OR DETECT?" — THE FORK JAMIE NEVER ASKED (2026-09-03) — BUILT
Flow doc §1 has said since 2026-08-24 that Jamie asks up front: "Do you
want to enter the work areas yourself, or have me detect them?" She never
asked. A fresh workspace said "Tell me about the job", the Propose button
only appeared AFTER a message, and the manual path was a ghost link under
a gold button on the Work Areas tab. The contractor had to infer the fork.

What changed:
- The workspace opens on the question itself, with both answers as equal
  buttons. **Detect them from my plans** runs Pass 1 with nothing typed.
  **I'll enter them myself** goes to the Work Areas tab with the add
  dialog already open (`?add=1`, stripped after mount so a refresh does
  not re-pop it).
- With no readable files the detect half becomes "Add plans for me to
  read" pointing at the Files tab — no dead button, and no Pass 1 burned
  on an empty project.
- The empty Work Areas tab asks the same question with two equal-weight
  buttons instead of a gold button over a ghost link.
- jamie-chat: Pass 1's user turn was hardcoded to "using everything I have
  told you above", which is a lie when the fork fires before a word is
  typed. With no conversation it now points at the file repository and
  sends what she needs into gap_questions instead of dropping a work area.
  The server already tolerated a zero-message Pass 1; only the wording was
  wrong.

Talking first still works — the composer never goes away.

NOT WALKED IN A BROWSER. Ian's side: click Build with Jamie on a project
with plans and hit Detect; then the same on a project with no files; then
the manual half and confirm the add dialog opens.

## GATE 2 — ADD LINES, PER-LINE MARKUP, PRICE OVERRIDE (2026-09-02) — SHIPPED, LIVE
SHIPPED on Ian's "merge it": PR #5 merged to master as 14fbd18; Netlify
production deploy 6a98ba38bcf2590008af1569 published to bluebidclaw.app
~00:08 UTC 2026-09-03. No function change. Not walked in a browser.
Ian: "go to next". JAMIE-FLOW §6 (his spec): at Gate 2 the user can
add / edit / delete line items and change quantity, cost, markup, price.
Skip, qty, cost and verbiage were built; this is the rest. No function
change — client + data layer only.
- GateReview.LineGate: every markup-bearing line (material / sub /
  other) gets a MARKUP % cell — blank = follow My Numbers (placeholder
  shows the live %), a number pins this line (amber). Every line gets a
  PRICE cell — blank = computed (placeholder shows it), a number is a
  billed-price override (amber, × to clear), exactly the estimate
  editor's two overrides. Line and estimate totals honour both.
- "Add a line Jamie missed" under each work area: category / label /
  qty / unit / cost (+ markup, price). The commit button reads "Finish
  the line you added" until name, qty and cost are all in — a half-typed
  row is never silently dropped.
- jamieLoop: LineDecision carries markupOverride / priceOverride;
  commitLineGate writes them to work_area_lines.markup_override /
  price_override (markup only where the category bears one — KYN).
  stageContractorLines stages added rows under the staged work area
  (stageProposedLines finally has a caller; sort_order 1000+, after
  Jamie's 0..n and the scope check's 900+), reasoning "Added by the
  contractor at Gate 2", needs_pricing false, then returns approved
  decisions — so added lines go through the same commit, the same
  audit trail, and the same catalog flywheel.
- KYN NOTE on the pinned rule above ("markup_override stays NULL on a
  forward estimate"): that rule is about JAMIE — she never pins a
  markup. A markup the CONTRACTOR sets on the card is their number and
  writes through, same as it always has in the estimate editor.
VERIFIED: tsc / eslint / vite build. NOT walked in a browser.
Harness note: verify-jamie-loop's Gate 2 replay does not exercise
overrides or added lines; add assertions when a live run is next spent.

## JAMIE P2 — WEB-SEARCH LAYER 1 + PRICING IN CONTEXT (2026-09-02) — SHIPPED, LIVE
SHIPPED on Ian's "deploy it": jamie-chat VERSION 17 through the Supabase
MCP (deployed files fetched back and diffed against source — identical);
PR #3 merged to master as 1c2c8cf; Netlify production deploy
6a98b517bc74bc0008c8b295 published to bluebidclaw.app ~23:47 UTC.
Still NOT exercised live (see below) — Ian's first Gate 2 "X is $N a
ton" is the real test; on failure read the function logs first.
Ian picked "jamie p2" from the Phase 1 note's candidate list. Of its
three items, whole-project mode shipped as J3; these are the other two.

LAYER 1 — WEB SEARCH ON PASS 2 (supabase/functions/jamie-chat):
- propose_lines now carries Anthropic's server-side web_search tool
  (type web_search_20260209, max_uses 6 — WEB_SEARCH_MAX_USES). Server
  tool: Anthropic runs the search, results land in her context, no
  client loop. Structured output + tools is a supported combination
  (only citations/prefill conflict).
- Prompt (Pass 2, "LAYER 1 — CHECK THE ASSEMBLY ON THE WEB"): search
  once per work area whose assembly she doesn't know cold, and for a
  supplier price when an item is not in the catalog; capped; never
  overrides THIS COMPANY'S kits/rates/catalog. The search query shape is
  the SKILL's ("<work type> complete materials list contractor estimate").
- The stream now runs in LEGS (runLeg): pause_turn (server search loop
  hit its iteration cap) is resumed by re-sending the assistant content,
  up to 3 continuations. Usage is SUMMED across legs into one invocation
  row; estimateCostUsd adds web_search_requests × $0.01
  (WEB_SEARCH_USD_EACH) from usage.server_tool_use.
- A pass's JSON is taken from the LAST text block of the final leg
  (passText), not the concatenated stream — the final message is the
  authority once a turn can span legs.
- Heartbeat: a server_tool_use block starting sends jamie_progress with
  stage 'searching'; the workspace shows "Jamie is checking the assembly
  and current pricing on the web…" instead of a frozen counter.

PRICING IN CONTEXT AT GATE 2:
- The bug class was the same as "merge mobilization": after Pass 2 Jamie
  says "tell me what you pay and I'll save them", and typing a price in
  the chat changed NOTHING. Now a chat turn at awaiting_line_approval
  carries a client tool, set_line_prices (strict schema: updates[] of
  line_id / unit_cost / quantity|null). The prompt lists every pending
  staged line by work area with its id, qty, unit, cost and a NEEDS
  PRICE flag, and tells her that calling the tool is the ONLY way a
  number reaches the card.
- applyLinePrices (server, service role) applies only to PENDING lines
  whose staged work area belongs to THIS run; zero costs and unknown ids
  are refused and named in the tool_result. needs_pricing flips false.
  Jamie then gets the tool_result and confirms in prose on a second leg;
  her text before the call and after it are joined with a newline in
  both the bubble and the transcript.
- The catalog flywheel (commitLineGate) saves the price she wrote on
  approve — so "shell mix is 48 a ton" in chat ends up in the catalog.
- JamieWorkspace keys <LineGate> on the staged ids/qty/cost so the card
  REMOUNTS when a chat turn reprices lines (its qty/cost are local string
  state per 1A/A and would otherwise ignore the prop change), and ONLY
  then — an ordinary chat turn keeps in-progress edits.
- Also folded in: the Gate 1 chat line now says the contractor can
  rename, edit scope, or ADD a work area on the card (the clause held
  back from the previous commit).

NOT VERIFIED LIVE (no .env, no credits spent this session): the tool
call round-trip, pause_turn resumption, and the web_search tool type on
the beta messages endpoint have not executed once. FIRST THING next
session with credits: npm run verify:jamie-loop (Pass 2 now searches —
expect it slower and a few cents dearer), then a Gate 2 chat "X is $N a
ton" and check jamie_proposed_lines changed. If the web_search type is
rejected on this SDK/endpoint, the fallback is web_search_20250305.
DEPLOY: jamie-chat needs redeploying for any of this to exist; the
frontend half (stage text, LineGate key) is harmless without it.

## GATE 1 INLINE ADD + EDITABLE SCOPE (2026-09-02) — SHIPPED (master 8582791)
Ian picked this from the candidate list right after the Gate 1 fix
shipped. JAMIE-FLOW §2 has said "add, edit, and delete — not just
approve/reject" since 2026-08-24; until now the card did approve/reject
+ rename only.
- GateReview.WorkAreaGate: "Add a work area Jamie missed" appends a
  dashed row (name + optional scope). Jamie's own proposals now have an
  EDITABLE scope textarea, because Pass 2 builds the takeoff FROM that
  text and the contractor may know a quantity she got wrong. onCommit
  now hands up (decisions, added).
- jamieLoop.stageContractorWorkAreas: an added area is staged on the run
  exactly like one of Jamie's (stageProposedWorkAreas finally has a
  caller), sorted after hers, and committed approved — so it becomes a
  real work area at Gate 1 AND GETS PRICED at Pass 2 with the rest. If
  the contractor gave no scope, the STAGED row carries a placeholder
  telling Jamie to build it from the name + conversation; the REAL
  work_areas row gets only what they typed (or nothing) until Pass 2
  writes the scope from the takeoff.
- commitWorkAreaGate now receives the edited description, not Jamie's
  original.
NOT DONE: Jamie's own Gate-1 chat line still says "Skip any work area on
the card, or approve the list" — it should also say "or add one". That
is a jamie-chat prompt edit + redeploy; batch it with the next function
change rather than a 65KB deploy for one clause.
VERIFIED: tsc / eslint (touched files) / vite build — see the commit.
NOT VERIFIED in a browser (no .env this session).

## GATE 1 HAS NO WAY BACK + DELETED WORK AREAS HAUNT GATE 2 (2026-09-02) — SHIPPED, LIVE
Ian, on the Scheu driveway (Truro, 4,000 SF shell + cobble apron + steel
edging): "When I click Build with Jamie they come back but even the 2 work
areas I deleted are there. But in the Work Areas there is just the three I
want but no data."

WHAT ACTUALLY HAPPENED (read straight off jamie_loop_runs / _proposed_* /
work_areas for run 75a0975b, all UTC):
  20:28  Pass 1 staged 5 work areas -> Gate 1.
  20:32  Ian: "merge mobilization into each of the other areas". Jamie:
         "Done. Four work areas instead of five." NOTHING MOVED — a chat
         turn cannot restage. Ian: "you still have mobilization as a
         separate work area". Jamie: "Re-run it. Hit Propose work areas."
         THAT BUTTON WAS HIDDEN — canPropose required status in_progress,
         and the run sat at awaiting_wa_approval. Only exits: approve, or
         Start over.
  20:34  Gate 1: all 5 approved (the Skip control was an unlabelled Undo2
         icon). Pass 2 priced all 5 — 39 lines.
  20:37- Ian deleted "Site Strip" and "Mobilization" on the Work Areas
  21:20  tab. FK ON DELETE SET NULL nulled inserted_work_area_id but the
         staged rows stayed status='approved', so Gate 2 still listed all
         5 ("even the 2 I deleted are there"). The 3 survivors had Gate 1
         descriptions and zero lines ("no data") — Gate 2 was not yet
         approved.
  21:20  Gate 2 committed: 26 lines landed on the 3 real work areas; the
         13 lines for the deleted areas were skipped by `if (!waId)
         continue` and left PENDING forever. Run -> committed. The three
         work areas have 7 / 12 / 7 lines now — the "no data" was the
         window before this commit.

THE FIX (this branch, claude/bidclaw-reverse-ingestion-3w374e):
1. "Propose again" at Gate 1. JamieWorkspace shows the Pass 1 button while
   a proposal is in review (label flips to "Propose again"); before the
   call, jamieLoop.supersedePendingWorkAreas marks the pending proposal
   rejected (retained, never deleted) and steps the run back to
   in_progress. jamie-chat does the same supersede server-side before it
   inserts, so no caller can stack two pending sets. A gateNonce re-runs
   the gate loader after every turn — status alone doesn't change on a
   re-propose, so the old effect deps would never have refreshed the card.
2. Jamie KNOWS she is at Gate 1. Chat action at awaiting_wa_approval loads
   the pending names into the prompt with: you cannot change this list by
   talking; take the correction and tell them to hit "Propose again"; never
   say the change is done.
3. Gate 1 card: Skip/Keep is a labelled button, plus a footer line saying
   talking alone doesn't change what's on screen.
4. Deleting a work area retires Jamie's copy. WorkAreasTab.handleDelete
   calls jamieLoop.retireStagedWorkArea BEFORE the delete (the FK nulls the
   link after): staged WA + its pending lines -> rejected. Best-effort, and
   the read side no longer depends on it:
   - listProposedLines only groups approved WAs WITH an
     inserted_work_area_id (a deleted one has none).
   - jamie-chat Pass 2 adds .not('inserted_work_area_id','is',null).
   - commitLineGate marks orphaned lines rejected instead of leaving them
     pending. verify-jamie-loop's replay mirrors it (the two-copies rule).

VERIFIED: tsc -b --noEmit exit 0; vite build OK; eslint on the touched
files adds nothing (WorkAreasTab:124 set-state-in-effect is pre-existing
on master); esbuild parses the edge function.
SHIPPED 2026-09-02 ~23:00 UTC on Ian's go: jamie-chat deployed as
VERSION 16 through the Supabase MCP (v15 was byte-identical to master, so
the deploy changed exactly this diff and nothing else; the deployed files
were fetched back and diffed against source — identical). PR #1 merged
to master as fc1379e; Netlify production deploy 6a98aa2941e5490008ed4b4e
built that commit and published to bluebidclaw.app at 22:59 UTC.
NOT VERIFIED IN USE: no browser walk and no live harness — the session
had no .env (no service key, no founder session). First real exercise is
Ian's. What to watch on the next Jamie session: at Gate 1, "Propose
again" appears under the card and replaces the proposal after a chat
correction; Skip/Keep is a labelled button; deleting a Jamie work area
on the Work Areas tab makes it vanish from the takeoff review.
Data note: the Scheu run still carries 13 pending lines under its two
deleted work areas. Harmless (run is committed) — left alone.

STALE-PROMPT WARNING for whoever resumes next: the "resume from Aug 21"
kickoff says master is at e9520f6 and RI is unmerged. FALSE since
2026-08-24 — master is 5d47624, feature/reverse-ingestion and
fix/ri-cost-markup are both ancestors of it, prod is git-built from
master, and the RI/J3/J4 entries below are already written. Don't
re-merge, don't re-record.

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
