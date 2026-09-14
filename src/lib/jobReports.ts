import {lineBase,roundMoney,sumMoney,type MoneyLine} from './money'
export const categories=['labor','material','equipment','subcontractor','other'] as const
export type Category=typeof categories[number]
export type ProjectRow={id:string;name:string;status:string}
export type BudgetProposal={id:string;project_id:string;name:string;status:string;updated_at:string}
export type BudgetArea={id:string;proposal_id:string;enabled:boolean;name_override:string|null;work_areas:{name:string}|null}
export type BudgetLine=MoneyLine&{id:string;proposal_id:string;proposal_work_area_id:string|null;category:Category;unit:string}
export type ActualCost={id:string;project_id:string|null;category:Category;amount:number;txn_date:string;description:string;account_name:string|null;vendor_name:string|null}
export type FieldReview={id:string;project_id:string;work_date:string;status:string;total_seconds:number;extras:unknown[];materials:unknown[]}
export type ReportData={projects:ProjectRow[];proposals:BudgetProposal[];areas:BudgetArea[];lines:BudgetLine[];costs:ActualCost[];reviews:FieldReview[]}
const zero=()=>({labor:0,material:0,equipment:0,subcontractor:0,other:0})
export function reportProject(d:ReportData,p:ProjectRow,asOf:string,selected?:string){
 const all=d.proposals.filter(x=>x.project_id===p.id&&x.status!=='lost').sort((a,b)=>b.updated_at.localeCompare(a.updated_at)||a.id.localeCompare(b.id)),approved=all.filter(x=>['approved','in_progress','completed'].includes(x.status))
 const proposal=(selected?all.find(x=>x.id===selected):approved[0]??all[0])??null
 const areas=d.areas.filter(a=>a.proposal_id===proposal?.id&&a.enabled),areaIds=new Set(areas.map(a=>a.id)),lines=d.lines.filter(l=>l.proposal_id===proposal?.id&&l.proposal_work_area_id!==null&&areaIds.has(l.proposal_work_area_id))
 const budget=zero(),actual=zero();for(const l of lines)budget[l.category]=roundMoney(budget[l.category]+lineBase(l))
 const costs=d.costs.filter(c=>c.project_id===p.id&&c.txn_date<=asOf);for(const c of costs)actual[c.category]=roundMoney(actual[c.category]+Number(c.amount))
 const reviews=d.reviews.filter(r=>r.project_id===p.id&&r.work_date<=asOf),posted=reviews.filter(r=>r.status==='posted')
 const hourUnits=new Set(['hr','hrs','hour','hours','mh','man hour','man hours'])
 const labor=lines.filter(l=>l.category==='labor'),hourLines=labor.filter(l=>hourUnits.has(l.unit.trim().toLowerCase())),budgetHours=sumMoney(hourLines.map(l=>Number(l.quantity))),actualHours=roundMoney(posted.reduce((s,r)=>s+Number(r.total_seconds),0)/3600)
 return {project:p,proposal,provisional:!proposal||!['approved','in_progress','completed'].includes(proposal.status),multipleApproved:approved.length>1,budget,actual,budgetTotal:sumMoney(Object.values(budget)),actualTotal:sumMoney(Object.values(actual)),costCount:costs.length,budgetHours,actualHours,hourRecordCount:posted.length,nonHourLabor:labor.length-hourLines.length,pending:reviews.filter(r=>r.status==='needs_review').length,extras:posted.reduce((s,r)=>s+(r.extras?.length??0),0),materials:posted.reduce((s,r)=>s+(r.materials?.length??0),0),unscopedLines:d.lines.filter(l=>l.proposal_id===proposal?.id&&!l.proposal_work_area_id).length,areas:areas.map(a=>({id:a.id,name:a.name_override||a.work_areas?.name||'Work area',budget:sumMoney(lines.filter(l=>l.proposal_work_area_id===a.id).map(lineBase))}))}
}
export function reportCsv(rows:(string|number|null)[][]){return '\uFEFF'+rows.map(row=>row.map(value=>{let s=value===null?'':String(value);if(typeof value==='string'&&/^[\s]*[=+\-@]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"'}).join(',')).join('\r\n')}
