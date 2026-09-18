import {QUESTION_RULES, CLARIFICATION_SCHEMA} from './jamieQuestions.ts'

export {CLARIFICATION_SCHEMA}
export const SINGLE_AREA_MEASUREMENT_RULES = `Measurement status describes quantities only, not overall readiness. If dimensions are supplied but gate supply, disposal, material choice or another nonmeasurement decision remains open, measurement_status must stay confirmed and those decisions belong in gap_questions. Read the entire contractor scope and previous answers before asking. Never ask the contractor to repeat supplied dimensions. If quantities conflict, ask about the specific conflicting segment, not all dimensions again.`
export const SINGLE_AREA_CLARIFY_PROMPT = `You are Jamie (he/him), a contractor's estimator. This request ONLY checks the supplied work-area scope for missing essentials before pricing. Do not calculate prices, labor, material takeoffs or write client/crew scopes. Return only a short confirmed-facts summary, measurement_status and up to three specific questions.\n${QUESTION_RULES}\n${SINGLE_AREA_MEASUREMENT_RULES}`

export function parseSingleAreaResponse(message: {stop_reason?:string|null;content:Array<{type:string;text?:string}>}) {
  if(message.stop_reason==='max_tokens') throw new Error('Jamie’s response was cut short. Your scope and answers are kept; retry this step.')
  if(message.stop_reason==='refusal') throw new Error('Jamie could not process this scope. Review the scope and attached files.')
  const text=message.content.filter(b=>b.type==='text').map(b=>b.text??'').join('')
  if(!text) throw new Error('Jamie returned no answer. Your scope and answers are kept; retry this step.')
  try {return JSON.parse(text)} catch {throw new Error('Jamie returned an incomplete answer. Your scope and answers are kept; retry this step.')}
}
