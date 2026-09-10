export interface HourlyRate { name: string; rate: number }
const normalize=(s:string)=>s.trim().toLowerCase().replace(/\s+/g,' ')
/** Resolve a role explicitly; never trust the model's numeric hourly rate. */
export function configuredHourlyRate(name:string, reference:string|null|undefined, rates:readonly HourlyRate[]) {
  const key=normalize(reference || name)
  const matches=rates.filter(r=>{
    const role=normalize(r.name)
    return role && Number.isFinite(r.rate) && r.rate>0 && (key===role || (!reference && [' - ',': ',' — '].some(separator=>key.startsWith(role+separator))))
  })
  if(matches.length!==1) return {cost:0,source:'Hourly rate is not uniquely matched to My Numbers. Enter and confirm your selling hourly rate.'}
  return {cost:matches[0].rate,source:`Configured selling rate: ${matches[0].name}, $${matches[0].rate}/hr. No extra markup.`}
}
