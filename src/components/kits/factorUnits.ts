/**
 * Factor unit suggestions for the kit-line factor_unit datalist.
 *
 * Sourced from the jamie-kit-library skill file conventions — covers
 * the input-unit families Jamie uses for BCA hardscape, masonry,
 * planting, drainage, and pool work. Grouped by the kit's input unit
 * (per-SF / per-LF / per-EA / per-CuYd / per-1FT / special) so
 * contractors can scan the right family quickly.
 *
 * Rendered as <optgroup> blocks inside a <datalist>. Chrome renders
 * the optgroup labels as section dividers; Safari/Firefox treat them
 * as a no-op and still surface every option — so the grouping is a
 * UX nicety, not a hard dependency.
 *
 * Editable: contractors can still type any free-form unit. The
 * datalist only suggests; it doesn't constrain. The DB column is
 * TEXT for this exact reason.
 */

export interface FactorUnitGroup {
  /** Section label, e.g. "Per SF (patio / wall / sod kits)". */
  label: string
  /** Unit strings in the order they should appear in the dropdown. */
  units: string[]
}

export const FACTOR_UNIT_GROUPS: FactorUnitGroup[] = [
  {
    label: 'Per SF — patio / walkway / wall / driveway / sod',
    units: [
      'Hr/SF',
      'SqFt/SF',
      'Ton/SF',
      'EA/SF',
      'CuYd/SF',
      'Load/SF',
      'BG/SF',
      'GAL/SF',
      'SY/SF',
      '$/SF',
      'Dollars/SF',
    ],
  },
  {
    label: 'Per LF — edging / coping',
    units: ['Hr/LF', 'SqFt/LF', 'EA/LF', 'Ton/LF'],
  },
  {
    label: 'Per EA — drywell / steps / plants',
    units: [
      'Hr/EA',
      'EA/EA',
      'Ton/EA',
      'SqFt/EA',
      'CuYd/EA',
      'BG/EA',
      '$/EA',
      'Dollars/EA',
    ],
  },
  {
    label: 'Per CuYd — soil / fill / mulch',
    units: ['Hr/CuYd', 'CuYd/CuYd', 'Load/CuYd', 'YD/YD'],
  },
  {
    label: 'Per 1FT — pool excavation',
    units: ['Hr/1FT', 'EA/1FT'],
  },
]

/**
 * Flat list of every suggestion, de-duped and stable-ordered. Useful
 * when callers want to merge in kit-specific units (e.g. unit strings
 * the contractor already entered on other lines) before rendering.
 */
export const ALL_FACTOR_UNITS: string[] = (() => {
  const seen = new Set<string>()
  const out: string[] = []
  for (const g of FACTOR_UNIT_GROUPS) {
    for (const u of g.units) {
      if (!seen.has(u)) {
        seen.add(u)
        out.push(u)
      }
    }
  }
  return out
})()
