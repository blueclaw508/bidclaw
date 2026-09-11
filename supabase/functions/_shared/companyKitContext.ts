/** Only the authenticated company's queried rows belong here. No shared default rates. */
export function companyKitContext(rows: Array<Record<string, unknown>>): string {
  const kits = rows.filter(row => (row.status ?? 'active') !== 'archived').map(row => ({
    name: row.name, category: row.category, input_unit: row.input_unit, notes: row.jamie_notes,
    lines: ((row.kit_lines ?? []) as Array<Record<string,unknown>>).slice()
      .sort((a,b)=>Number(a.position??0)-Number(b.position??0))
      .filter(line=>Number.isFinite(Number(line.factor)) && Number(line.factor)>0)
      .map(line=>({type:line.type,name:line.display_name,factor:Number(line.factor),unit:line.factor_unit})),
  }))
  return kits.length ? `THIS COMPANY'S OWN KITS (reference data):\n${JSON.stringify(kits)}\nUse a kit only when the task, method, input units and size range match. This job's explicit instructions override kits. Kit factors override generic assumptions. Missing/zero labor factors are not zero labor: request a benchmark or explicitly identify an unverified task allowance. Do not add a helper on top of a total-person-hour kit factor unless separate helper work is actually specified.`
    : 'No company kits are available. State which labor factors are unverified assumptions; do not claim a company production benchmark.'
}
