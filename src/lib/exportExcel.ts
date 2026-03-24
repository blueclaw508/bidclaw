// Export estimate to Excel — quantities and descriptions only, no pricing
import * as XLSX from 'xlsx'
import type { EstimateRecord, WorkAreaData, LineItemData } from '@/lib/types'

export function exportEstimateToExcel(
  estimate: EstimateRecord,
  workAreas: WorkAreaData[],
  lineItems: Record<string, LineItemData[]>,
) {
  const wb = XLSX.utils.book_new()
  const rows: (string | number | null)[][] = []

  // ── Header section ──
  const clientName = estimate.client_name || ''
  const estimateName = estimate.project_name || (clientName ? `BidClaw — ${clientName}` : 'BidClaw Estimate')

  rows.push([estimateName])
  rows.push([])
  if (clientName) rows.push(['Client', clientName])
  if (estimate.project_address) rows.push(['Address', estimate.project_address])
  rows.push(['Date', new Date().toLocaleDateString()])
  rows.push([])

  // Totals accumulators
  let grandTotalHours = 0
  let grandTotalItems = 0

  // ── Per work area ──
  for (const wa of workAreas) {
    const items = lineItems[wa.id] ?? []
    grandTotalItems += items.length

    // Work area header
    rows.push([wa.name])
    rows.push([])

    // Jamie scope description (full bulleted version)
    const scopeDesc = wa.scope_description
    if (scopeDesc) {
      // Split bullets into separate rows for readability
      const bullets = scopeDesc.split('\n').filter((line: string) => line.trim())
      for (const bullet of bullets) {
        rows.push([bullet.trim()])
      }
      rows.push([])
    }

    // Line items table header
    rows.push(['Item Name', 'Quantity', 'Unit', 'Category'])

    // Line items
    let waHours = 0
    for (const li of items) {
      rows.push([li.name, li.quantity, li.unit, li.category])
      if (li.category === 'Labor') waHours += li.quantity || 0
    }

    grandTotalHours += waHours

    // Work area labor subtotal
    if (waHours > 0) {
      rows.push([])
      rows.push(['Labor Hours', waHours, 'MH', ''])
    }

    // Spacer between work areas
    rows.push([])
    rows.push([])
  }

  // ── Summary section ──
  const crewDays = grandTotalHours > 0 ? Math.ceil(grandTotalHours / 27) : 0

  rows.push(['ESTIMATE SUMMARY'])
  rows.push([])
  rows.push(['Total Labor Hours', grandTotalHours, 'MH'])
  rows.push(['Crew Days', crewDays, 'days'])
  rows.push(['Work Areas', workAreas.length])
  rows.push(['Total Line Items', grandTotalItems])

  // Build worksheet
  const ws = XLSX.utils.aoa_to_sheet(rows)

  // Set column widths
  ws['!cols'] = [
    { wch: 45 },  // Item Name / labels
    { wch: 12 },  // Quantity
    { wch: 10 },  // Unit
    { wch: 16 },  // Category
  ]

  XLSX.utils.book_append_sheet(wb, ws, 'Estimate')

  // Generate filename
  const safeName = (clientName || 'Estimate').replace(/[^a-zA-Z0-9 ]/g, '').trim()
  const filename = `${safeName} - Estimate.xlsx`

  // Trigger download
  XLSX.writeFile(wb, filename)
}
