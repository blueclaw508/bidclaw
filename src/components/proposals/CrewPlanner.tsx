import { PrintStyles, type DocumentSettings } from './ProposalDocument'
import { PROPOSAL_LINE_CATEGORY_ORDER } from '@/lib/statusConfig'
import type { ProposalWithWorkAreas, ProposalWorkAreaResolved, Project, Customer } from '@/lib/types'
import type { CrewTranslations } from '@/lib/crewPlanner'

export function CrewPlanner({proposal, areas, project, customer, settings, logoUrl, language, translations}: {
  proposal: ProposalWithWorkAreas; areas: ProposalWorkAreaResolved[]; project: Project; customer: Customer | null
  settings: DocumentSettings; logoUrl: string | null; language: 'en' | 'es'; translations?: CrewTranslations
}) {
  const es = language === 'es'
  const text = (key: string, source: string | null | undefined) => es ? translations?.[key] ?? '' : source ?? ''
  const categories = es
    ? {labor:'Mano de obra',material:'Materiales',equipment:'Equipo',subcontractor:'Subcontratistas',other:'Otros'}
    : {labor:'Labor',material:'Materials',equipment:'Equipment',subcontractor:'Subcontractors',other:'Other'}
  return <article lang={language} className="crew-planner">
    <PrintStyles />
    <header className="border-b-2 pb-4" style={{borderColor:settings.pdf_primary_color || '#1e3a8a'}}>
      {logoUrl && <img src={logoUrl} alt="" className="mb-3 max-h-24 max-w-52 object-contain" />}
      {(settings.pdf_show_company_name !== false || !logoUrl) && <p className="text-sm font-semibold">{settings.company_legal_name}</p>}
      <h1 className="mt-3 text-2xl font-bold">{es ? 'Plan de trabajo para la cuadrilla' : 'Crew planner'}</h1>
      <p className="mt-1 font-semibold">{project.name}</p>
      <p className="mt-1 text-sm">{text('title',proposal.name)}</p>
      <p className="mt-1 text-sm">{[project.site_address_line1,project.site_address_city,project.site_address_state,project.site_address_zip].filter(Boolean).join(', ') || project.site_address}</p>
      {customer && <p className="mt-1 text-sm">{es ? 'Cliente' : 'Customer'}: {customer.name}</p>}
      <p className="mt-2 text-sm">{es ? 'Uso interno · Cantidades y horas · Sin precios' : 'Internal use · Quantities and hours · No pricing'}</p>
    </header>
    {proposal.notes?.trim() && <section className="mt-4"><h2 className="font-bold">{es ? 'Notas' : 'Notes'}</h2><p className="whitespace-pre-wrap">{text('notes',proposal.notes)}</p></section>}
    {areas.map(area => <section key={area.id} className="pv-work-area mt-6">
      <h2 className="rounded bg-gray-100 p-3 text-lg font-bold">{text(`area:${area.id}`,area.resolved_name)}</h2>
      <ul className="my-3 list-disc space-y-1 pl-6">
        {text(`scope:${area.id}`,area.resolved_description).split('\n').map(line=>line.trim().replace(/^(?:[-*•]|\d+[.)])\s*/, '')).filter(Boolean).map((line,i)=><li key={i}>{line}</li>)}
      </ul>
      {PROPOSAL_LINE_CATEGORY_ORDER.map(category => {
        const lines = area.lines.filter(line=>line.category===category).slice().sort((a,b)=>a.sort_order-b.sort_order)
        if (!lines.length) return null
        const hourly = category === 'labor' || category === 'equipment'
        const sameUnit = new Set(lines.map(line=>(line.unit??'').trim().toLowerCase())).size === 1
        return <div key={category} className="pv-category-table mt-3 overflow-hidden rounded border border-gray-200">
          <h3 className="bg-gray-50 px-3 py-2 font-bold">{categories[category]}</h3>
          <table className="w-full text-sm"><thead><tr><th className="px-3 py-2 text-left">{es ? 'Concepto' : 'Item'}</th><th className="px-3 py-2 text-right">{es ? 'Cantidad / horas' : 'Quantity / hours'}</th></tr></thead>
            <tbody>{lines.map(line=><tr key={line.id} className="border-t"><td className="px-3 py-2">{text(`line:${line.id}`,line.label)}</td><td className="whitespace-nowrap px-3 py-2 text-right">{Number(line.quantity).toLocaleString('en-US',{maximumFractionDigits:4})} {line.unit}</td></tr>)}</tbody>
            {hourly && sameUnit && <tfoot><tr className="border-t font-bold"><td className="px-3 py-2">{category==='labor' ? (es ? 'Total de horas-persona' : 'Total person-hours') : (es ? 'Total de horas de equipo' : 'Total equipment hours')}</td><td className="px-3 py-2 text-right">{lines.reduce((sum,line)=>sum+Number(line.quantity),0).toLocaleString('en-US',{maximumFractionDigits:4})} {lines[0].unit}</td></tr></tfoot>}
          </table>
        </div>
      })}
    </section>)}
  </article>
}
