# BIDCLAW — PHASE 2 (PROMPT 6) CLOSEOUT HANDOFF
**Project:** BidClaw — Jamie estimating agent
**Repo:** github.com/blueclaw508/bidclaw (master)
**Live:** bluebidclaw.app
**Closeout date:** June 6 2026
**Author:** Claude Code (with Ian McCarthy)

---

## 0 — Executive summary

Phase 2 of Prompt 6 is **complete and live**. The multi-work-area
proposal system is end-to-end functional: the contractor can create
a proposal from any project, attach/remove work areas, add lines
from a kit, from the catalog, or as a custom entry, inline-edit
every field, drag to reorder, see frozen pricing snapshot enforced
at the data layer, and watch totals roll up live across enabled
work areas. Frozen-rate semantics were empirically verified — settings
changes never retroactively shift past proposals.

What ships at the end of Phase 2:

- Schema: `proposals`, `proposal_work_areas`, `proposal_lines`
  (frozen snapshot cols on every line)
- Data layer: `src/lib/proposals.ts` — single source of truth for
  CRUD + denormalized subtotal sync + totals rollup
- UI: ProposalsTab on ProjectDetail, GenerateProposalModal,
  ProposalEditor with multi-WA architecture, 3 lazy-loaded add-line
  modals, inline-edit + Save+Reset bar, dnd-kit reorder, items-need-
  pricing banner, tabular totals breakdown
- QC visual language applied throughout (gradient headers + pastel
  section cards)
- Bundle: ProposalEditor 40.34 kB gzipped (under 50 kB target)

What Phase 2 deliberately did **not** ship:

- Per-line markup edit (Phase 3 of Prompt 6)
- Delete-proposal flow (Phase 3 of Prompt 6)
- Status lifecycle UI — sent/accepted/declined (Phase 3 of Prompt 6)
- Proposal duplication (Phase 3 of Prompt 6)
- Jamie auto-generation into the editor (Prompt 7)
- PDF/PPTX export, send-to-client (Prompts 8+)

---

## 1 — Commit log (chronological)

| # | SHA | Sub-phase | Title |
|---|---|---|---|
| 1 | `4e5367a` | Phase 1 | proposals schema + data layer (single-WA scaffold) |
| 2 | `8103e11` | Phase 2a | GenerateProposalModal + work-area Generate button |
| 3 | `ffcaf8a` | Pre-Phase 2 | remove Generate-proposal button from WorkAreasTab |
| 4 | `bf5cdfa` | Phase 2c | **multi-WA schema + data layer refactor** (migration 0008) |
| 5 | `3daff0f` | Phase 2b | ProposalsTab on ProjectDetail |
| 6 | `fab8a19` | Phase 2d | ProposalEditor scaffold + work-area-add modals |
| 7 | `e261f6c` | Phase 2e | ProposalWorkAreaSection + dnd-kit reorder |
| 8 | `63258e0` | Phase 2f | ProposalLineRow inline-editable + unified Save+Reset bar |
| 9 | `744e6e3` | Hotfix | lift NumericCell → shared `@/components/decimal-input` |
| 10 | `ff99dbf` | Phase 2g | 3 add-line modals + lazy-load |
| 11 | `bc9f4e9` | Phase 2h | items-need-pricing banner + Calculate sync + tabular totals + remove settings-markup linkage |

(Phase 2b shipped after Phase 2c chronologically because the
multi-WA schema refactor blocked Phase 2b's final shape — the tab
list rendering was rebuilt against the new shape.)

**Net effect on master branch:** 11 commits, +~6,500 / -~2,100 lines
across 14 source files and 1 migration.

---

## 2 — Architectural decisions locked through Phase 2

These are the decisions that future sub-phases (and Prompt 7+)
must respect. The 9 from the original spec §9 plus 4 added during
execution.

### 2.1 — Decisions from the original spec (§9)

**D1 — Frozen pricing snapshot.** Every `proposal_lines` row carries
its own `frozen_unit_cost`, `frozen_markup_percent`,
`frozen_labor_rate`, `frozen_equipment_rate`. These are populated
at INSERT and never UPDATEd by any code path. Settings changes in
`company_settings` never retroactively touch existing proposal
lines. Empirically verified Phase 2h via diagnostic SQL:
`line_predates_settings_change=true` across all material lines
after a settings markup edit.

**D2 — Denormalized work-area subtotals.** Each `proposal_work_areas`
row carries denormalized `labor_subtotal`, `material_subtotal`,
`equipment_subtotal`, `subcontractor_subtotal`, `other_subtotal`.
These are kept in sync by `syncProposalWorkAreaSubtotals(waId)`
which runs after every line mutation. Grand totals are computed
client-side from these denorm cols, NOT from re-aggregating
proposal_lines on every render.

**D3 — One proposal-to-N work-area join.** `proposal_work_areas`
is a junction table, not a copy. The link to the source
`work_areas` table is one-way (proposal_work_areas.work_area_id);
the source work_area is the catalog reference, the proposal_work_area
is the priced instance.

**D4 — Enabled flag on the join, not the proposal.**
`proposal_work_areas.enabled` toggles whether the WA contributes
to grand total. Disabled WAs still render their subtotal on their
card (so the contractor can see what they're excluding) but are
filtered out of grand-total computation.

**D5 — Lines belong to proposal_work_areas, not proposals.**
`proposal_lines.proposal_work_area_id` is the FK. This means a line
moves with its WA; there is no "orphan line" state.

**D6 — Category as enum on the line, not on the subsection.**
`proposal_lines.category` is `'labor' | 'material' | 'equipment' |
'subcontractor' | 'other'`. The category drives which subsection
renders the line + which markup bucket the line draws from.
Subsections are derived in JS by grouping lines by category — they
are not a stored entity.

**D7 — sort_order on the line for stable drag-drop.**
`proposal_lines.sort_order` is an integer that determines line
order within a subsection. dnd-kit emits a reorder event which
calls `reorderProposalLines(orderedIds[])` — this rewrites the
sort_order for all affected rows in a single PostgREST call.

**D8 — Notes draft + lines draft share one Save+Reset bar.**
The ProposalEditor maintains a `notesDraft` string + a
`localLines` map keyed by line id. A single sticky bar at the
bottom shows the union of dirty flags and commits everything in
one batch when Save is pressed. Reset reverts both.

**D9 — Per-WA dnd-kit context, not per-proposal.** Drag-drop is
scoped to one subsection (one category in one WA). Cross-category
and cross-WA drags are impossible by construction. This avoids
the entire class of bugs around "drop a labor line into a material
subsection."

### 2.2 — Decisions added during execution

**D10 — Settings decoupled from existing proposals at all times.**
The ProposalEditor must NEVER fetch `company_settings.markup_*`
to display anywhere on a line, subsection header, or totals card.
The line's frozen value is the single source of truth. (Added
Phase 2h after FIX 1.) Rationale: any UI affordance that shows
"current settings markup" next to the line implies the line could
shift, which contradicts D1. The contract is "what you set when
you added the line is what bills."

**D11 — Inline totals card, not sticky.** The totals breakdown
renders inline at the bottom of the editor, not as a sticky panel.
Sticky panels eat mobile screen real estate and would require
collapse/expand state which adds complexity. The contractor scrolls
down to see totals; the Save+Reset bar is the only sticky element.

**D12 — All 5 subsections always visible per BidClaw deviation
from QC.** QC hides empty subsections; BidClaw keeps all 5
(`labor`, `material`, `equipment`, `subcontractor`, `other`)
visible inside every WA card so the per-section "+ Add line item"
buttons are always reachable. Migrating to QC's category picker
modal was scoped out — would require significant UX work and
would make the empty state worse (no clear path to add).

**D13 — DecimalInput pattern as canonical numeric input.**
Phase 2f introduced + Phase 5+2 hotfix promoted
`@/components/decimal-input/DecimalInput` as the shared component
for every numeric input across BidClaw. It maintains local string
state so partial inputs like `0.` and `-` don't blow up
parseFloat, and only commits a number to the parent via
`onCommit(n)` when the input is committed (blur or Enter). Future
phases must use this — do NOT use raw `<input type="number">`.

---

## 3 — Phase 1.5 backlog (accumulated, deferred items)

Items spotted during Phase 2 work that are real but didn't fit
the sub-phase boundaries. Tagged with origin sub-phase.

| Origin | Item | Severity |
|---|---|---|
| 2c | `proposal_work_areas.sequence_order` reflows are not transactional — two near-simultaneous reorders could leave gaps. Low risk (single-user editor) but worth a `REORDER` RPC eventually. | Low |
| 2d | Modal lazy-loading uses `addModal?.type` discriminant — fine, but Suspense fallback is a bare spinner; should match the QC "loading skeleton" pattern. | Cosmetic |
| 2e | `AddFromProjectModal` only filters out WAs already attached to THIS proposal. It does not warn if the source WA has been edited since the proposal was created — could lead to "I added the dining-room WA but the measurements have changed." | Medium |
| 2f | Line validation runs per-keystroke; for very large proposals (>200 lines) this could lag. Memoize per line. | Low |
| 2g | Catalog filter for `subcontractor` + `other` lines uses a hardcoded bucket (`['disposal','design','other']`). Should be data-driven once the catalog has a dedicated subcontractor category. | Medium |
| 2h | Calculate button doesn't disable while syncing — double-click could fire two sync waves. Add a guard. | Low |
| 2h | Items-need-pricing banner counts $0.00 lines but doesn't surface WHICH lines. Click-through to filter the editor would close the loop. | Medium |
| All | No optimistic concurrency control on proposal_lines — last write wins. Acceptable for now (one editor per browser), risky once Jamie writes alongside the user (Prompt 7). | Medium |

---

## 4 — Carry-forward to Phase 3 of Prompt 6

The four items the user named as next-up for Prompt 6:

### 4.1 — Per-line markup edit

**Goal:** Let the contractor override frozen_markup_percent on a
per-line basis from inside the editor.

**Design constraints:**
- D1 (frozen snapshot) means the override is a real UPDATE on the
  row, not a "current settings" reference.
- D10 (settings decoupled) means the override input must NOT show
  "current settings: X%" as a hint — show the line's own value
  only, with empty placeholder for "use category default."
- Input is the same `DecimalInput` pattern (D13).
- Validation: 0 ≤ markup ≤ 999.99.

**Where it goes:**
- ProposalLineRow markup chip becomes inline-editable for material/
  subcontractor/other (the categories that show markup today).
- Update `updateProposalLine` allowed-patch list to include
  `frozen_markup_percent`.
- Inline edit reuses the Save+Reset bar (D8); no per-cell save.

**Testing focus:**
- Edit markup on a material line, save, refresh — confirm new value
  persists.
- Edit markup, hit Reset — confirm reverts to last-saved value.
- Diagnostic SQL: confirm only the targeted line's
  frozen_markup_percent changed; siblings untouched.

### 4.2 — Delete-proposal flow

**Goal:** Soft-delete (or hard-delete with confirmation) a proposal
from the ProposalsTab list.

**Design constraints:**
- Existing `proposal_lines.proposal_work_area_id` FK should cascade
  on proposal_work_area delete; proposal_work_areas FK should
  cascade on proposal delete. Verify migration 0008 set this up.
- Confirmation modal uses the existing `ConfirmDialog` component
  (already shipped from Phase 2e). Tone: `danger`.
- Decision needed: soft-delete (status='archived') or hard-delete?
  Recommend hard-delete because there's no current "restore" UX
  and soft-delete pollutes the list. Capture in commit message.

**Where it goes:**
- Add trash icon to each row in ProposalsTab.
- Add `deleteProposal(proposalId)` to `src/lib/proposals.ts`.
- Wire confirmation → call → toast → refetch list.

### 4.3 — Status lifecycle UI

**Goal:** Surface and let the contractor advance proposal status
through `draft → sent → accepted | declined`.

**Existing state:** `proposals.status` column exists from Phase 1
(`'draft' | 'sent' | 'accepted' | 'declined'`). `updateProposal`
already accepts a status patch. No UI surfaces it yet.

**Where it goes:**
- Status pill on the ProposalsTab row (existing StatusBadge
  component pattern).
- Status pill on the ProposalEditor header.
- Advance-status dropdown or button cluster on the editor —
  contractor explicitly marks the proposal sent/accepted/declined.
- Status transition rules (lock editing when accepted? — decide
  with Ian) — leaning: editing locked once `accepted` or
  `declined`, soft-warn at `sent`.

**Carry over to Prompt 7+:**
- "Sent" status should eventually trigger the send-to-client flow
  (PDF generation + email). For Prompt 6 Phase 3, just record the
  status; the send action is Prompt 8.

### 4.4 — Proposal duplication

**Goal:** "Duplicate" button on the ProposalsTab row creates a
fresh proposal with the same WAs + lines + frozen rates carried
forward.

**Design constraints:**
- Frozen rates copy as-is (this is the whole point — duplicating
  preserves the priced snapshot).
- New proposal gets `status='draft'` regardless of source status.
- Name suffix convention: " (copy)" appended to source name.
- New `proposal_work_areas.sequence_order` mirrors source order.
- New `proposal_lines.sort_order` mirrors source order.

**Where it goes:**
- Copy icon next to delete on each ProposalsTab row.
- New `duplicateProposal(proposalId)` in `src/lib/proposals.ts` —
  does the whole insert sequence in one go (proposal → WAs →
  lines).
- Should be a single Postgres function eventually (atomicity),
  but JS-side for v1 is acceptable.

---

## 5 — Carry-forward to Prompt 7 (Jamie integration)

**Prompt 7 scope:** Jamie generates work areas + lines via the
estimating agent flow (Sections 1–11 of bidclaw SKILL.md) and
deposits them into a proposal that the contractor then reviews
+ edits using the Phase 2 editor.

**The contract Jamie must respect (from Phase 2's locked decisions):**

1. **Jamie calls the same data layer.** No bespoke "AI insert"
   path. Jamie's pipeline calls `addLinesFromKitPreview` or
   `addCustomLine` for each line, exactly like the user clicking
   "+ Add line item" does. Rationale: ensures D1 (frozen
   snapshot) applies to Jamie's lines too.

2. **Jamie writes frozen rates at insert.** When Jamie inserts a
   material line for "Type S Mortar @ $15/bag × 20 bags," she
   passes `unitCost=15` to `addCustomLine`, which snapshots it
   into `frozen_unit_cost=15`. The current settings markup at
   that moment is snapshotted into `frozen_markup_percent`.

3. **The editor displays Jamie's output identically to manual
   work.** No "AI-generated" badge on the line, no different
   color, no "review required" gate. The contractor sees a
   normal proposal with normal lines; the diff is that Jamie
   populated them and the contractor edits the gaps.

4. **Jamie writes gap-question metadata separately.** Per the
   spec JSON in Section 9.1: `gap_questions[]` and
   `new_catalog_items[]` are NOT lines. They surface in the
   Jamie Analysis interactive panel (Section 7). For Phase 2's
   editor to display them cleanly, we'll need:
   - A `proposals.jamie_metadata` JSONB column (Phase 7 prep
     migration), OR
   - A separate `proposal_jamie_runs` table keyed by proposal
     id, holding the full structured output from each Jamie
     call (better for audit + re-run).
   Recommend the second; capture in Prompt 7 schema work.

5. **Items-need-pricing banner doubles as the new-catalog-items
   prompt.** When Jamie flags `new_catalog_items=["Type S
   Mortar"]`, she'd insert the line at $0 with the item name as
   label. The existing banner (Phase 2h) catches every $0 line
   automatically. The contractor sees "3 items need pricing" →
   sets prices inline → done. No new UI needed for the banner;
   the workflow already routes through it.

6. **Jamie does NOT call `syncProposalWorkAreaSubtotals` herself.**
   The data layer functions she calls already do that. Don't
   bypass.

7. **Jamie respects D12.** All 5 subsections render even when
   empty. Jamie populates subsections; she doesn't decide which
   to show.

**Open Prompt 7 architecture question (flagged for Ian):**

The current editor assumes the contractor is the writer. When
Jamie writes, there are two patterns:

**Pattern A — Jamie writes first, contractor reviews.**
Jamie generates everything → ProposalEditor opens with her output
prepopulated → contractor edits + saves. Simple. Matches the
current editor.

**Pattern B — Streaming co-edit.**
Contractor opens an empty proposal → clicks "Have Jamie estimate
this" → Jamie's lines stream in as she generates them → contractor
can edit during generation. Slick but complex (race conditions
with the Save+Reset bar; D8 assumes one writer).

Recommend Pattern A for Prompt 7 v1. Pattern B can come later
once the simpler version is shipped.

---

## 6 — File reference (where things live after Phase 2)

```
src/
├── lib/
│   ├── proposals.ts            ← single source of truth for proposal CRUD
│   ├── types.ts                 ← Proposal, ProposalLine, ProposalLineCategory, etc.
│   └── supabase.ts              ← client (unchanged)
├── pages/
│   ├── ProposalEditor.tsx       ← the editor (40.34 kB chunk)
│   └── ProjectDetail.tsx        ← hosts ProposalsTab
├── components/
│   ├── proposals/
│   │   ├── ProposalsTab.tsx              ← list on ProjectDetail
│   │   ├── GenerateProposalModal.tsx     ← create-proposal modal
│   │   ├── ProposalWorkAreaSection.tsx   ← per-WA card with subsections
│   │   ├── ProposalLineRow.tsx           ← inline-editable line row
│   │   ├── AddFromKitModal.tsx           ← lazy-loaded
│   │   ├── AddFromCatalogModal.tsx       ← lazy-loaded
│   │   └── AddCustomLineModal.tsx        ← lazy-loaded
│   ├── decimal-input/
│   │   └── DecimalInput.tsx              ← canonical numeric input (D13)
│   └── ConfirmDialog.tsx                  ← reused for line delete + WA remove
└── supabase/migrations/
    ├── 0007_proposals.sql       ← Phase 1 (initial scaffold)
    └── 0008_multi_work_area.sql ← Phase 2c (the big refactor)
```

---

## 7 — Resume prompt for next Claude Code session

Paste this verbatim into the next session.

```
Load /mnt/skills/user/bidclaw/SKILL.md and connect to blueclaw508/bidclaw.
Also load /mnt/skills/user/session-discipline/SKILL.md.

Read docs/handoffs/PHASE-2-CLOSEOUT.md completely before touching code.

Phase 2 of Prompt 6 is shipped (commit bc9f4e9 on master, live on
bluebidclaw.app). Multi-work-area proposal editor end-to-end functional,
frozen-rate semantics empirically verified, bundle 40.34 kB.

Today's session goal: Phase 3 of Prompt 6 — pick ONE of:
  (a) Per-line markup edit
  (b) Delete-proposal flow
  (c) Status lifecycle UI (draft → sent → accepted → declined)
  (d) Proposal duplication

See PHASE-2-CLOSEOUT.md §4 for the design constraints on each.
Confirm which to take first and I'll plan it before coding (Rule 4).

If Ian instead wants to start Prompt 7 (Jamie integration), see
PHASE-2-CLOSEOUT.md §5 — Pattern A is the recommended v1 approach.
The locked architectural decisions D1, D10, D13 are non-negotiable
for Jamie's data path.

Phase 1.5 backlog (PHASE-2-CLOSEOUT.md §3) is available if Ian wants
to clear smaller items first.
```

---

*End of Phase 2 closeout. Total span: Phases 1 → 2h + Pre-Phase + hotfix = 11 commits.*
*Authored by Claude Code with Ian McCarthy | Blue Claw Group | Confidential*
