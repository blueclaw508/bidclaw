export interface JamieQuestion { id:string; prompt:string; choices:string[]; kind:'measurement'|'choice'|'text' }
export interface JamieClarification { questions:JamieQuestion[]; summary:string; measurement_status:'confirmed'|'missing'|'not_applicable'; ready:boolean; work_area_ids?:string[] }
export const QUESTION_SCHEMA = {
  type:'object',additionalProperties:false,required:['prompt','choices','kind'],
  properties:{prompt:{type:'string'},choices:{type:'array',items:{type:'string'}},kind:{type:'string',enum:['measurement','choice','text']}}
} as const
export const CLARIFICATION_SCHEMA = {
  type:'object',additionalProperties:false,required:['summary','gap_questions','measurement_status'],
  properties:{summary:{type:'string'},gap_questions:{type:'array',items:QUESTION_SCHEMA},measurement_status:{type:'string',enum:['confirmed','missing','not_applicable']}}
} as const
export const QUESTION_RULES = `CLARIFY BEFORE PRICING:
Ask at most three questions per turn. Each gap_questions object asks ONE fact, not a paragraph of subquestions. Supply 2-4 short choices for genuine alternatives; otherwise choices: []. kind: measurement for missing size/count/dimensions; choice for alternatives; text for other details. Do not preselect answers. An "I don't know" answer is unresolved and needs a follow-up, never permission to guess.
Use the conversation's previous answers, and only ask follow-ups that affect this batch. Never invent dimensions, areas, counts or separate repair quantities. measurement_status is confirmed only when quantities are explicitly supplied by the contractor or a readable plan (cite the dimensions/quantity and source in the summary). Use missing when any essential quantity is unknown. not_applicable is only for work explicitly priced without a measured quantity, such as a stated fixed fee. Do not use not_applicable to bypass an unknown patio size.
Summarize the confirmed quantities, method, access and exclusions briefly for the contractor to review. No prices or takeoff lines during clarification. Price only after this review, with gap_questions empty and measurement_status resolved. If pricing reveals a new essential question, return questions and NO work-area takeoffs or line items. Never bury an unanswered question in narrative scope or assumptions.`

export function normalizeClarification(value: {gap_questions?:unknown[]; summary?:string; measurement_summary?:string; measurement_status?:string}):JamieClarification {
  const questions:JamieQuestion[]=(value.gap_questions ?? []).map((raw,index)=>{
    const q=typeof raw==='string' ? {prompt:raw} : (raw ?? {}) as Record<string,unknown>
    const prompt=typeof q.prompt==='string' ? q.prompt.trim() : ''
    return {id:`${index}:${prompt}`,prompt,choices:Array.isArray(q.choices) ? q.choices.filter((x):x is string=>typeof x==='string' && !!x.trim()) : [],kind:q.kind==='measurement' ? 'measurement' as const : q.kind==='choice' ? 'choice' as const : 'text' as const}
  }).filter(q=>q.prompt)
  const status=value.measurement_status==='confirmed' || value.measurement_status==='not_applicable' ? value.measurement_status : 'missing'
  if(status==='missing' && !questions.some(q=>q.kind==='measurement')) questions.unshift({id:'required-measurement',prompt:'What measured area, dimensions or quantity should Jamie use for this work?',choices:[],kind:'measurement'})
  questions.splice(3)
  const summary=(value.measurement_summary ?? value.summary ?? '').trim()
  return {questions,summary,measurement_status:status,ready:questions.length===0 && status!=='missing' && !!summary}
}
export function clarificationMatches(value:JamieClarification|undefined, ids:string[]):boolean {
  return !!value?.ready && value.questions.length===0 && value.measurement_status!=='missing' &&
    JSON.stringify([...(value.work_area_ids ?? [])].sort())===JSON.stringify([...ids].sort())
}
export function serializeAnswers(questions:JamieQuestion[],answers:Record<string,string>,notes=''):string {
  return 'Contractor answers:\n'+questions.map(q=>`Question: ${q.prompt}\nAnswer: ${(answers[q.id] ?? '').trim()}`).join('\n\n')+(notes.trim()?`\n\nAdditional notes: ${notes.trim()}`:'')
}
