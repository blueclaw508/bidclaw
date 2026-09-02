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

Ian, 2026-08-24: *"I want the system to be shipped ready to learn and
evolve to the user's company. It should ship blank. My login can learn my
stuff fine. But each other version starts blank with the engine to become
the wizards of that company."*

There is **no built-in kit library**, and no company's production factors
are ever shown to another company. `jamie-chat` reads THIS user's `kits`
rows; with none, Jamie estimates from general trade practice and shows her
production factors in the reasoning so the contractor can correct them —
and their corrections become their kits. The founder account learns the
same way everyone else does.

The prompt is trade-neutral too: work-area naming, gap questions and scope
examples must not push a contractor toward masonry just because that is
what the first user sold.

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
| **Gate 1: add / edit / delete work areas** | BUILT — Skip/Keep, rename, editable scope text, and **Add a work area Jamie missed** (staged like hers, so Pass 2 prices it). **Propose again** re-runs Pass 1 over the corrected conversation. |
| **Deleting a Jamie work area after Gate 1** | BUILT — retires the staged row; Pass 2 and Gate 2 only price/show work areas that still exist |
| **Scope written FROM the line items** | BUILT — Pass 2 writes it from the takeoff and overwrites Gate 1's |
| **Bullet scope format (summary + steps)** | BUILT — summary line, step bullets, qualifiers, exclusions |
| **Questions on the fly** | NOT BUILT — `gap_questions` arrive as text at the end |
| **Gate 2: edit verbiage** | BUILT — editable scope per work area |
| **Gate 2: add lines, change markup/price** | NOT BUILT — qty + cost only |
| **User's own kits instead of BCA's** | BUILT — hardcoded library DELETED; jamie-chat reads the user's `kits`. jamie-ingest still holds an inline copy (founder-gated, and unverifiable while API credits are out) |
| **Learning from the user's edits** | NOT BUILT — the deltas ARE recorded (`jamie_proposed_lines` vs `inserted_work_area_line_id`); nothing reads them |
| **Web search for unfamiliar trades** | NOT BUILT |

---

## The scope engine's resolution order (Ian, 2026-08-24)

When Jamie needs to know how a work area is actually built, she resolves
in this order:

1. **The user's kits** — their own assemblies and production factors.
2. **Learned knowledge** — how they estimated the same or a similar work
   area before, including what they EDITED on those estimates.
3. **The internet** — how-to, step by step, best practices for that kind
   of work. This is the day-one fallback and the thing that makes her
   useful outside the trades the user has already priced.

Only step 3 is genuinely absent today; steps 1 and 2 exist as data
(`kits`, `jamie_proposed_lines` vs `inserted_work_area_line_id`) that
nothing reads. What ships today instead of all three is a hardcoded copy
of BCA's kits — see §0.

## The fail-safe

After the estimate resolves, re-read the finished scope against the
finished line items: **anything the verbiage mentions must appear as a
line item.** Built 2026-08-24 (Sonnet validation pass). It exists because
a Veneer Foundation estimate once described mortaring the veneer and
billed no mortar.
