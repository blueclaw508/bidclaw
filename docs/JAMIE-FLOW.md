# JAMIE — THE ESTIMATING FLOW (Ian's spec)

Stated by Ian 2026-08-24, written down here because it keeps being
reconstructed from code comments and commit messages. `leads.ts:294`
cites a `LOOP.md` that has never existed in this repo — this file is the
replacement. **If the code and this document disagree, this document
wins; fix the code.**

---

## 0. The product is BLANK out of the box

A new user gets an empty app. They fill in **My Numbers** (retail labor
rates, equipment rates, universal material and sub markups). Nothing is
pre-seeded, and nothing is assumed about their trade.

> **Jamie is NOT limited to Blue Claw's type of work.**
> She must estimate fencing, irrigation, decking, masonry — whatever the
> user actually sells. She learns the user's work FROM the user.

This is the hard constraint that most of the current implementation
violates: `supabase/functions/_shared/kitReference.ts` bakes BCA's 25
hardscape/masonry kits into the prompt for **every** user. That is a
seed for Ian's own account, not a universal truth, and it must become
the user's own kits + their bid history + general trade knowledge.

Sources of Jamie's knowledge, in priority order:

1. **The user's My Numbers** — rates and markups. Always verbatim.
2. **The user's catalog** — grows itself (see §5).
3. **The user's kits** — their own assemblies, from the Kits feature.
4. **The user's bid history** — what they edited on past estimates.
5. **General trade knowledge / web search** — the fallback for scope
   the user has never priced before. This is what makes her useful to
   a contractor on day one, before they have any history.

---

## 1. Entry — the user chooses

On a project, Jamie asks up front:

> **"Do you want to enter the work areas yourself, or have me detect them?"**

Both paths are first-class:

- **Manual** — the user adds work areas and pulls in kits themselves.
- **Jamie detects** — she reads the plans, spec and conversation and
  proposes the work-area breakdown.

## 2. Work-area review (Gate 1)

If Jamie detected them, the user can **add, edit, and delete** work
areas before anything is committed. Not just approve/reject — add and
delete too.

## 3. Jamie estimates each work area

For every approved work area, she works out:

- which **line items from the catalog** belong in it
- the **quantities**: labor, materials, disposal, equipment, subs
- labor as **man-hours × the user's retail rate**
- materials/subs as **base cost + the universal markup from My Numbers**
- **nothing is ever zero** (see §5)

## 4. Then she writes the scope description

**Written FROM the line items, after the takeoff — never before.** Scope
and line items must match 100%: if she writes it, she bills it; if she
doesn't bill it, she doesn't write it.

Required format:

```
<First line: a summary of what is being done.>
- <step-by-step process of how the work is done>
- <...>
- <qualifying statements about material or type of installation>
```

This text is doing two jobs at once: it is what the **client** is buying
and what the **crew** is instructed to do.

## 5. Questions on the fly

Anything unclear, Jamie **asks the user in the moment** rather than
guessing or zeroing:

> "Is this patio wet set or dry set?"
> "What type of material for the patio?"

A price she does not have is not a $0 line. She prices it from trade
knowledge, flags it for confirmation, and the confirmed number is saved
to the user's catalog for next time — that is how the catalog builds
itself.

## 6. First-pass review (Gate 2)

The user reviews everything and can:

- add / edit / delete **work areas**
- add / edit / delete **line items**
- change **quantity, cost, markup, price**
- edit the **verbiage** (the scope description)

## 7. Approve → proposal

Once the user approves, the estimate goes to a proposal.

---

## Leads & Bids linkage

- A newly created estimate appears in L&B at stage **Estimating**.
- Sent to proposal / to client → stage **Proposed**.
- An **organic lead** can enter L&B first, then convert into an estimate
  and join the process from there.

---

## Implementation status (2026-08-24)

| Spec | State |
|---|---|
| Blank out of the box; My Numbers gate | BUILT (`useSetupGate`, `WizardModal`) |
| Manual path — work areas + kits | BUILT |
| Jamie path | BUILT (Build with Jamie workspace) |
| Takeoff measuring tool | BUILT (`MeasureView`) |
| File repository, read by Jamie | BUILT |
| L&B: estimate → Estimating | BUILT (`ensureLeadForProject`) |
| L&B: proposal sent → Proposed | BUILT (`syncLinkedLead`) |
| L&B: organic lead → convert | BUILT (`convertLeadToProject`) |
| Quantities + costs, nothing zero | BUILT |
| Catalog builds itself from priced items | BUILT |
| **"Enter or detect?" explicit fork** | NOT BUILT — no prompt, user must infer |
| **Gate 1: add / delete work areas** | NOT BUILT — approve/reject + rename only |
| **Scope written FROM the line items** | NOT BUILT — written in Pass 1, before the takeoff |
| **Bullet scope format (summary + steps)** | NOT BUILT — free prose |
| **Questions on the fly** | NOT BUILT — `gap_questions` arrive as text at the end |
| **Gate 2: add lines, edit markup/price/verbiage** | PARTIAL — qty + cost only |
| **User's own kits instead of BCA's** | NOT BUILT — `KIT_REFERENCE` is hardcoded BCA |
| **Learning from the user's edits** | NOT BUILT — the deltas ARE recorded (`jamie_proposed_lines` vs `inserted_work_area_line_id`); nothing reads them |
| **Web search for unfamiliar trades** | NOT BUILT |
