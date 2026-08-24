// KYN kit reference — production factors Jamie multiplies by a work area's
// measured quantity. Extracted from jamie-ingest at J3 so the ingest brain
// and the loop brain read from ONE copy; the contractor's own rates always
// override these defaults (jamie-kit-library rule 1).
//
// NOTE: jamie-ingest still carries its own inline copy — it is shipped and
// live-verified (5/5) and was left untouched at J3. Dedupe it here on the
// next jamie-ingest change.

export const KIT_REFERENCE = `KIT REFERENCE (production factors — multiply by the work area's measured quantity; the contractor's own rates override these):
HARDSCAPE (unit = SF of face/surface unless noted):
- Dry-laid bluestone patio/walk: labor 0.20-0.22 hr/SF (mason); bluestone 1.10 SF/SF; mason sand 0.008 ton/SF; polymeric sand 0.01 EA/SF; processed dense grade 0.013-0.015 ton/SF; cut-off saw + mini skid loader ~0.017 hr/SF each; plate compactor 0.008 hr/SF. Add plastic edge restraint 0.13 EA/LF + spikes 0.78 EA/LF on open edges.
- Wet-lain (mortared on slab) bluestone/porcelain: labor 0.26-0.28 hr/SF (mason); stone 1.10 SF/SF; mason sand 0.016 ton/SF; portland 0.065 EA/SF; wire mesh 0.025 EA/SF; rebar 0.09 EA/SF; luan form 0.02 EA/SF; ready-mix pour SUB ~0.013 CuYd/SF (~4" slab); muriatic acid 0.008 EA/SF.
- Bluestone/granite coping (unit = LF): labor 0.45 hr/LF (mason); stone tread 1.0 SF/LF; portland 0.03 EA/LF; mason sand 0.022 ton/LF; cement mixer runs full-time.
- Cobblestone apron (unit = SF): labor 0.30-0.32 hr/SF (mason); jumbo cobbles 1.65-1.86 EA/SF; stone dust 0.02-0.04 ton/SF; polymeric sand; recycled concrete base; cut-off saw + compactor + skid.
- Cobblestone/Belgian block edging/banding (unit = LF): labor 0.15-0.22 hr/LF (mason); cobbles 1.30-1.70 EA/LF; portland 0.05 EA/LF; stone dust.
- Fieldstone/veneer wall (unit = SF of vertical face): fieldstone labor 0.65 hr/SF (mason, highest); veneer wall = CMU core + stone veneer face, add mason labor separately; crushed stone, mason sand, portland, rebar, cement mixer, ready-mix footing SUB.
- Steel edging (unit = LF): labor 0.12 hr/LF; steel edging 0.08 EA/LF.
- Monolithic granite/bluestone steps (unit = EA or SF riser): NO kit labor — add mason labor from the step count/complexity; step stock + dense grade + plate compactor + skid.
- Crushed-stone / shell driveway (unit = SF): labor 0.012-0.016 hr/SF (landscaper); base tons; native stone/clam shells; landscape fabric; PVC drain; plate compactor + skid.
SOFTSCAPE:
- Sod (unit = SF): labor 0.006-0.0063 hr/SF (landscaper); sod 1.10 SF/SF; pallet charge ~1 per 500 SF; disposal; skid.
- Loam/grading (unit = SF or CuYd): spread loam ~0.012 hr/SF or 0.55 hr/CuYd (landscaper); screened loam ~0.0124 CuYd/SF at ~1.7"; disposal; skid.
- Planting install: labor = (shrubs x 0.2 hr) + (trees x 2.2 hr); plant stock + delivery + amendments (cow manure/peat/starter per plant); plant warranty ~18-20%; equipment as needed.
- Mulch (unit = CuYd): labor 1.5 hr/CuYd (landscaper) + dingo 0.4 hr/CuYd; mulch 1.0 CuYd/CuYd. Conversion: SF x depth(in) / 324 = CuYd.
- Drywell/drainage: SDR-35/PVC pipe LF; crushed stone; fabric; pop-up emitters EA; landscaper labor.
SUBCONTRACTOR / ALLOWANCE-DRIVEN (reconstruct as a SUBCONTRACTOR line at the stated allowance/lump — do NOT try a bottom-up takeoff, confidence low):
- Gunite/shotcrete in-ground pool, spa, baja bench: pool-builder subcontractor lump.
- Pool equipment (salt generator, automation panel, heater, winter cover, automatic cover w/ vault): equipment selections — one subcontractor/material line each at the stated price.
- Automatic in-ground irrigation: 12-zone Hunter etc. — largely subcontractor/material + a labor allotment; confidence medium.
- Any "$X allowance carried" (e.g. owner-selected grill head): a single 'other' or 'subcontractor' allowance line at that amount, needs_pricing false.`
