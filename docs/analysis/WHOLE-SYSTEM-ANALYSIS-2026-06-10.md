# BIDCLAW — WHOLE-SYSTEM ANALYSIS
**Date:** June 10, 2026
**Scope:** The software program AND the business process as one connected system
**State analyzed:** master @ `2ffbd9e` (21 commits across Phase 2 + Phase 3 + Phase 9-lite + hardening)
**Prepared as briefing context for an LLM Council session on build sequencing**

---

## 1 — What BidClaw actually is today (honest inventory)

BidClaw is a **ground-up rebuild**, not an iteration of the earlier BidClaw that
integrated with BlueQuickCalc's $39/mo Pro tier. The rebuild started at migration
`0001_phase1_foundation` and is currently **hard-locked to one user**: the
`enforce_email_allowlist` trigger on `auth.users` raises an exception for any
signup that isn't ianm@blueclawassociates.com. Nobody else can create an account
even if they wanted to. This is deliberate Phase 1 lockdown — but it means every
"go to market" conversation has a literal DB trigger standing in front of it.

**What works end-to-end today (verified, not aspirational):**
- Projects → customers → work areas → measure tool (PDF takeoff with scale,
  count, area, polyline tools)
- Company settings (KYN numbers: labor types, equipment rates, materials/subs
  markup, PDF branding) behind a 3-step setup wizard with soft-gating
- Catalog (priced items) + Kit library (assembly templates with factors —
  25 kits in the jamie-kit-library skill ready to seed)
- Multi-work-area proposal editor: add WAs (project-linked or ad-hoc), add lines
  (from kit / from catalog / custom), inline-edit everything, drag-reorder,
  frozen pricing snapshot, per-line markup override, items-need-pricing banner,
  tabular totals
- Full proposal lifecycle: draft → presented → accepted/declined → completed,
  with read-only lock outside draft; delete; duplicate-with-frozen-rates
- Customer-facing print view → browser Save-as-PDF (verified at scale against a
  66-line stress fixture; 9-page PDF breaks cleanly)
- Autonomous visual-verification harness (Playwright + service-role session
  injection) — every future print/UI change can be screenshot-verified without
  a human in the loop

**What does NOT exist yet:**
- Jamie (the AI estimating agent — the actual product thesis)
- Any second user (allowlist), any payment (no Stripe), any email-from-app
- Logo upload UI, e-sign, accept/decline tracking links
- QC → BidClaw data migration path for the 7 active QuickCalc users

## 2 — Codebase assessment

**Strengths.** The architecture is unusually coherent for the speed it was
built: 13 locked decisions (D1–D13) are documented and consistently enforced.
The two load-bearing ones —

- **D1 frozen pricing snapshot** (rates frozen at line insert, no code path
  mutates them, verified empirically twice via diagnostic SQL), and
- **D10 settings decoupled from proposals** (the editor never even fetches
  current settings markup)

— are exactly the invariants an AI agent writing lines (Jamie) must inherit.
The data layer (`src/lib/proposals.ts`) is the single chokepoint for all
proposal mutations, which makes Prompt 7's contract ("Jamie calls the same
data layer") cheap to honor. Bundle discipline held (every route chunk under
50 kB; print view 17.3 kB).

**Debt (Phase 1.5 backlog, ranked by what bites when):**

| Item | Bites when |
|---|---|
| No optimistic concurrency on proposal_lines (last-write-wins) | The moment Jamie writes alongside a human editor (Prompt 7) |
| duplicateProposal / reorder are JS-side multi-call, not transactional RPC | First concurrent-use or flaky-network duplication produces a partial copy (mitigated by CASCADE cleanup, not eliminated) |
| Catalog has no `subcontractor` category; sub/other lines filter a hardcoded bucket | First real dogfood proposal with sub quotes |
| `proposal_lines.source_catalog_item_id` missing (traceability hint lives in a text field) | Jamie needs to flag "new catalog items" robustly |
| Items-need-pricing banner counts but doesn't link to the offending lines | First 60-line dogfood proposal with 6 unpriced items |
| Line validation runs per-keystroke unmemoized | Proposals >200 lines |

None of this blocks dogfooding. Items 1, 2, 4 block (or degrade) Jamie.

## 3 — Security / ops posture

**Solid (post-migration 0009):** RLS on all live tables; orphan zero-policy
table dropped; SECURITY DEFINER trigger functions revoked from API roles and
search_path-pinned (bodies read and verified safe first); CASCADE chains
verified on all 3 FK paths; signup allowlist enforced at the DB, not the UI.

**Open:**
1. **Service-role key rotation** — a key fragment appeared in a session
   screenshot; rotation is a 2-minute dashboard action, still pending.
2. Leaked-password protection toggle — moot under magic-link-only auth,
   revisit at launch.
3. The verification harness's `.env.local` holds a service-role key on a dev
   machine — acceptable for solo dev, must not survive onto any shared machine.
4. When the allowlist lifts: no rate limiting, no abuse surface review has
   been done on PostgREST endpoints beyond RLS. Fine for 8 invited users;
   needs a pass before open signup.

## 4 — Business-process fit (does the software match KYN?)

The KYN methodology BidClaw encodes: labor billed at fully-burdened retail
rate (markup pre-baked, therefore 0% line markup), materials/subs marked up
automatically, equipment billed as internal rental, every scope item priced,
27-hour crew-day rounding, scope text = line items (Jamie's Prime Directive).

**Where the build matches:** labor/equipment carry 0% markup by construction;
materials/subs/other snapshot the settings markup at insert; the frozen-rate
contract means a sent proposal never shifts under the contractor; kits encode
assemblies with factors exactly the way Section 5 of the spec describes them.

**Where reality will rub:**
- **The catalog is thin.** Dogfooding will lean on "+ Custom" heavily. That's
  fine for proposals but starves Jamie — her Layer 2 (cross-reference the
  contractor's catalog) is only as good as the catalog. Every dogfood
  proposal should deposit its custom lines INTO the catalog, or Jamie launches
  with an empty brain.
- **The QC overlap question is unresolved.** QuickCalc already produces
  proposals for 7 paying-ish users. BidClaw's manual editor now does what QC
  does (arguably better). The business hasn't decided whether BidClaw
  *replaces* QC (migration) or *feeds* it (the original "BidClaw estimates it →
  QuickCalc proposes it" system line). The print view just shipped makes
  BidClaw self-sufficient — which quietly contradicts the two-product system
  diagram in the brand kit. This is a strategy fork nobody has named.
- **The prior pricing model is stale.** $599/mo BidClaw on top of $39/mo QC
  was the old model for the old build. No current pricing hypothesis exists
  for the rebuilt product.

## 5 — The three sequencing options on the table

**Option A — Jamie next (Prompt 7).** The product thesis. Per-work-area
approval flow, read-only review, additive-only writes, text+image input —
all already spec'd and locked. Risks: builds AI on top of a catalog that's
nearly empty and a concurrency model that assumes one writer; burns 3-4 weeks
before any revenue signal; dogfood friction findings will arrive mid-build
and compete for attention.

**Option B — Stripe/monetization (Week 3 plan).** Risks: there is nothing to
monetize that QC doesn't already sell — manual proposals are QC's job; the
allowlist means zero external users exist to pay; pricing hypothesis is
stale. Stripe before Jamie monetizes the part of BidClaw that isn't the
product thesis.

**Option C — Extended dogfooding first.** Ian builds 5-10 real proposals,
catalog fills with real items, friction list drives a fix sprint, THEN Jamie
lands on a real catalog with real workflow data. Risks: delay; momentum is a
real asset and the builder is faster than the user right now; 7 QC users keep
waiting; dogfooding is one person's anecdotes, not a market signal.

**The actual stakes:** roughly a month of build time, the credibility of the
"Jamie" launch (she's only as smart as the catalog + kits she reads), and
whether the 7 QC users migrate into something half-finished or arrive when
the system story (estimate → propose → close) is real.

## 6 — What this analysis recommends the council pressure-test

1. Is the Week-3 Stripe plan serving the old business model rather than the
   rebuilt product?
2. Is "Jamie next" building the headline feature on an empty catalog — or is
   shipping Jamie exactly what forces the catalog to fill?
3. Is the unnamed strategy fork (BidClaw replaces QC vs feeds QC) actually
   the first decision, ahead of any build sequencing?
4. What is the minimum dogfooding that de-risks Jamie without stalling her?

*Prepared by Claude Code (Fable 5) from full session context: 21 commits,
D1–D13 decision log, Phase 1.5 backlog, security advisor state, KYN
methodology spec, jamie-kit-library, and project memory.*
