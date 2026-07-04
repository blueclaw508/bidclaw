# QUICKCALC FIDELITY AUDIT — BidClaw Manual Flow Rework
**Date:** June 11, 2026
**Source audited:** `C:\Users\Ian\Downloads\quickcalc` (types, CreateEstimate, WorkAreaSection, QuickCalcContext, ApprovalDashboard)
**Trigger:** Ian's dogfood feedback — "The flow is Work Areas to create estimate within each work area → approve → create proposal. I don't see much fidelity to QuickCalc and there should be for this manual version."

---

## 1 — How QuickCalc actually works (verified against source)

**One entity, one screen.** QC has no separate project or proposal entity.
The **Estimate** is everything: client info + job address (split
line1/city/state/zip) + project description + **work areas that contain the
line items directly** + payment terms + images + T&C + output format.

**The flow on one page (CreateEstimate.tsx):**
1. Client information — First/Last/Company, Job Address (Line1, City, State,
   Zip as separate fields), email/phone, with an **address-book picker** that
   imports a saved client into the estimate
2. **Work Areas** — each is a card with its line items inside. One
   **"+ Add Line Item"** button per work area opens the FULL catalog (all 5
   types in one modal). Only categories that have items render.
3. **Calculate Estimate** button — aggregates enabled work areas into
   subtotals + grand total, sets `isCalculated`
4. Payment Terms (% splits) → Images → T&C → **Output Format picker:
   Detailed / Summary (= the Proposal) / Crew**
5. Save / Export PDF / **Send to Client**

**"Proposal" is an output format, not an entity.** The Summary format renders
"We are pleased to submit the following proposal…" with a signature block.
Same estimate, three renderings (Detailed / Proposal / Crew).

**Approve = the client approving the sent estimate.** Send-to-client writes a
snapshot (`shared_estimates.estimate_data` JSON + token) → client opens the
share link (SharedEstimate page) → approves → ApprovalDashboard tracks
pending/approved with approvedBy/approvedAt/approvedIp. Estimate status:
Draft → Sent → Viewed → Approved/Declined. **One status, on the estimate.**

**Rates are live, freeze happens at SEND.** `getRateForCatalogItem` resolves
labor rates from current settings and applies current markup to
material/sub costs. Line rows show the CURRENT settings markup as a
display-only pill. The number freezes when the estimate is shared (the JSON
snapshot), not per-line at insert.

**Line row anatomy (WorkAreaSection.tsx):** editable name · Qty · **Cost**
(base cost, editable — back-computes the billed rate through markup) ·
Markup % (display pill) · **Price (editable with `isAmountOverridden` flag —
amber highlight when overridden)** · delete. Native drag-drop reorder.
Instant persistence through context + autosave — **no Save/Reset bar.**

## 2 — Fidelity gap list (BidClaw current vs QC)

### Flow-breaking (the inversion)
| # | QC | BidClaw today |
|---|---|---|
| G1 | Line items live **in work areas** | Line items live in a separate Proposal entity; work areas are empty shells |
| G2 | Proposal = an **output format** of the estimate | Proposal = separate DB document you must create and re-attach work areas to |
| G3 | One status on the estimate (Draft→Sent→Viewed→Approved/Declined) | Status on proposals AND a second generic status picker on each work area |
| G4 | Estimate entry is one continuous screen | Entry requires Project → Proposals tab → New proposal → Add from project → subsections |
| G5 | Rates live until send; freeze at share-snapshot | Rates frozen per-line at insert (right instinct, wrong trigger point) |

### Editing-surface fidelity
| # | QC | BidClaw today |
|---|---|---|
| G6 | ONE "+ Add Line Item" → full catalog modal (all types) | Per-category buttons, three different modals |
| G7 | Only categories WITH items render | All 5 subsections always visible (deliberate D12 deviation — reverse it) |
| G8 | **Price column editable** with override flag (amber) | Price is computed-only; no override |
| G9 | Current markup % shown as pill on section + line | Removed in Phase 2h (correct for frozen lines; moot once rates are live) |
| G10 | Instant persistence + autosave | Sticky Save/Reset bar with dirty tracking |
| G11 | Cost field edits back-compute rate through markup | Cost edits are raw; no markup-aware breakdown line under the row |

### Client/data fidelity
| # | QC | BidClaw today |
|---|---|---|
| G12 | Job address split: Line1/City/State/Zip (+ Google Maps link) | Freeform single text field (friction #4) |
| G13 | Address book picker imports client INTO the estimate | Separate customers FK + double site-address entry (friction #3) |
| G14 | Payment terms → invoices from approved estimate | Absent (later phase — note, don't build yet) |
| G15 | Templates (save work-area sets for reuse) | Kits partially cover this (richer, keep kits) |

### Where BidClaw is legitimately ahead (do NOT regress)
- Measure/takeoff tool over PDF plans (QC has nothing)
- Kits with quantity factors (stronger than QC templates)
- Real multi-tenant Postgres + RLS (QC stores JSON blobs)
- DecimalInput (QC uses raw number inputs with `parseFloat || 0` — the exact
  decimal-loss bug class we already fixed)
- Print view (stress-verified) — becomes the Detailed/Proposal renderer
- Frozen-snapshot machinery — reused as-is, just triggered at generation

## 3 — Target architecture: estimate-first, QC-faithful

```
Project (keeps files/measure tool — BidClaw addition, stays)
  └── Work Areas  ←— THE ESTIMATE LIVES HERE
        ├── work_area_lines (live rates, price-override capable)
        ├── estimate lifecycle per WA (drafting → approved)   [replaces generic WA status]
        └── enabled toggle (include in totals)
  └── "Create Proposal" (from approved WAs)
        └── proposals + proposal_work_areas + proposal_lines  [EXISTING tables,
            frozen AT GENERATION — D1 preserved, better placed]
        └── proposal editor slims to review/adjust + print (Detailed/Proposal formats)
```

The entire Phase 2 line-item UI (subsection tables, line rows, DecimalInput,
kit/catalog modals, totals) remounts on the Work Areas tab. The proposals
system survives intact as the freeze/send layer. This is a rewiring with one
new table, not a rebuild.

## 4 — Rework plan (locked pending Ian's approval)

**Session R1 — Schema (~60 min):** `work_area_lines` table (category, label,
unit, qty, base cost, price_override, sort, catalog/kit refs) + customers
address split (line1/city/state/zip ×2) + WA estimate-status columns.
Migration 0010.

**Session R2 — Estimate entry on Work Areas (~90 min):** remount line UI on
the Work Areas tab, QC-style: one "+ Add Line Item" full-catalog modal,
only-populated categories, live markup pill, Price override column with
amber state, instant persistence.

**Session R3 — Calculate + estimate lifecycle (~60 min):** per-WA totals +
project-level Calculate/grand total on the Work Areas tab; estimate status
replaces the generic WA status picker (friction #2 resolved properly).

**Session R4 — Create Proposal = generate (~90 min):** one button on the Work
Areas tab: snapshot approved+enabled WAs into the existing proposals tables
(freeze at generation). Proposal editor slims to review/adjust; print view
gains the Proposal (summary) format alongside Detailed.

**Session R5 — Client fidelity (~60 min):** customer form address split,
address-book-style prefill into project/estimate, Maps link, remove the
double site-address entry.

**Open decisions for Ian (embedded in R1/R2 kickoffs):**
1. **Approve granularity** — per-work-area approved flag (matches your
   sentence + Jamie's locked per-WA spec) or whole-estimate approve (QC's
   model)? Recommend per-WA.
2. **Instant-save vs Save/Reset bar** — QC fidelity says instant. Recommend
   instant (kills the save-batch race class entirely).
3. **Send-to-client/approval dashboard** — QC's client-facing share+approve
   loop is a later phase (needs email). Confirm it stays out of this rework.

*Everything in sections 1–2 verified against QC source, not memory.*
