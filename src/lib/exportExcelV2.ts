// ============================================================
// V2 Excel Export — Professional spreadsheet from relational data
// 2 sheets: Cover + Estimate Detail
// Cost column present but BLANK — "Cost (enter in QuickCalc)"
// No pricing from BidClaw. Ever.
// ============================================================

import type { V2Estimate, V2WorkArea, V2LineItem } from '@/lib/types'

const NAVY = '1E3A5F'
const LIGHT_GRAY = 'F5F5F5'
const BORDER_GRAY = 'D1D5DB'
const WHITE = 'FFFFFF'

function thinBorder(): Record<string, unknown> {
  const side = { style: 'thin', color: { argb: BORDER_GRAY } }
  return { top: side, bottom: side, left: side, right: side }
}

export async function exportEstimateToExcelV2(
  estimate: V2Estimate,
  workAreas: V2WorkArea[],
  lineItemsMap: Map<string, V2LineItem[]>
): Promise<void> {
  const ExcelJS = (await import('exceljs')).default
  const workbook = new ExcelJS.Workbook()

  // ── Sheet 1: Cover ──
  const cover = workbook.addWorksheet('Cover', {
    pageSetup: { orientation: 'portrait', fitToPage: true, fitToWidth: 1 },
  })

  cover.columns = [
    { width: 5 },
    { width: 20 },
    { width: 50 },
  ]

  // Company header
  const titleRow = cover.addRow([null, 'Blue Claw Associates Inc.'])
  titleRow.getCell(2).font = { name: 'Calibri', size: 16, bold: true, color: { argb: NAVY } }
  cover.addRow([])

  // Estimate title
  const nameRow = cover.addRow([null, estimate.estimate_name || 'Estimate'])
  nameRow.getCell(2).font = { name: 'Calibri', size: 14, bold: true }
  cover.addRow([])

  // Client info
  const fullName = [estimate.first_name, estimate.last_name].filter(Boolean).join(' ')
  const fields = [
    ['Client', fullName + (estimate.company_name ? ` — ${estimate.company_name}` : '')],
    ['Address', [estimate.address_line, estimate.city, [estimate.state, estimate.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')],
    ['Date', new Date().toLocaleDateString()],
    ['Project Type', estimate.project_type ?? ''],
    ['Description', estimate.project_description ?? ''],
  ]

  for (const [label, value] of fields) {
    const row = cover.addRow([null, label, value])
    row.getCell(2).font = { name: 'Calibri', size: 10, bold: true }
    row.getCell(3).font = { name: 'Calibri', size: 10 }
    row.getCell(3).alignment = { wrapText: true }
  }

  // ── Sheet 2: Estimate Detail ──
  const detail = workbook.addWorksheet('Estimate Detail', {
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1 },
  })

  detail.columns = [
    { header: '', width: 3 },        // spacer
    { header: 'Name', width: 40 },
    { header: 'Qty', width: 10 },
    { header: 'Unit', width: 8 },
    { header: 'Category', width: 14 },
    { header: 'Cost (enter in QuickCalc)', width: 22 },
  ]

  // Column headers
  const headerRow = detail.addRow([null, 'Name', 'Qty', 'Unit', 'Category', 'Cost (enter in QuickCalc)'])
  headerRow.height = 22
  for (let col = 2; col <= 6; col++) {
    const cell = headerRow.getCell(col)
    cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: WHITE } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '6B7280' } }
    cell.alignment = { vertical: 'middle' }
    cell.border = thinBorder() as typeof cell.border
  }

  let totalItems = 0
  let totalLaborHours = 0

  for (const wa of workAreas) {
    const items = lineItemsMap.get(wa.id) ?? []

    // Work area header
    detail.addRow([])
    const waRow = detail.addRow([null, wa.name])
    waRow.height = 24
    const waCell = waRow.getCell(2)
    waCell.font = { name: 'Calibri', size: 12, bold: true, color: { argb: WHITE } }
    waCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } }
    waCell.alignment = { vertical: 'middle' }
    detail.mergeCells(waRow.number, 2, waRow.number, 6)
    for (let col = 2; col <= 6; col++) {
      waRow.getCell(col).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } }
    }

    // Scope description
    if (wa.scope_description) {
      const scopeRow = detail.addRow([null, wa.scope_description])
      const scopeCell = scopeRow.getCell(2)
      scopeCell.font = { name: 'Calibri', size: 9, italic: true }
      scopeCell.alignment = { wrapText: true, vertical: 'top' }
      detail.mergeCells(scopeRow.number, 2, scopeRow.number, 6)
      // Estimate row height from line count
      const lineCount = wa.scope_description.split('\n').length
      scopeRow.height = Math.max(15, lineCount * 13)
    }

    // Line items
    let waLaborHours = 0

    for (let i = 0; i < items.length; i++) {
      const li = items[i]
      const row = detail.addRow([null, li.name, li.qty, li.unit, li.category, ''])
      totalItems++

      if (li.category === 'Labor') {
        waLaborHours += li.qty
      }

      // Alternating row color
      if (i % 2 === 1) {
        for (let col = 2; col <= 6; col++) {
          row.getCell(col).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT_GRAY } }
        }
      }

      // Borders and formatting
      for (let col = 2; col <= 6; col++) {
        const cell = row.getCell(col)
        cell.font = { name: 'Calibri', size: 10 }
        cell.border = thinBorder() as typeof cell.border
      }
      row.getCell(3).alignment = { horizontal: 'right' }
      row.getCell(6).font = { name: 'Calibri', size: 10, italic: true, color: { argb: '9CA3AF' } }
    }

    // Labor subtotal for this work area
    if (waLaborHours > 0) {
      const subRow = detail.addRow([null, `Labor Hours: ${waLaborHours.toFixed(1)} hrs`, '', '', '', ''])
      subRow.getCell(2).font = { name: 'Calibri', size: 10, bold: true }
      subRow.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F8FAFC' } }
      detail.mergeCells(subRow.number, 2, subRow.number, 6)
      totalLaborHours += waLaborHours
    }
  }

  // Grand summary
  detail.addRow([])
  detail.addRow([])
  const summaryTitle = detail.addRow([null, 'ESTIMATE SUMMARY'])
  summaryTitle.getCell(2).font = { name: 'Calibri', size: 12, bold: true, color: { argb: NAVY } }

  const crewDays = totalLaborHours > 0 ? Math.ceil(totalLaborHours / 27) : 0
  const summaryData = [
    ['Total Labor Hours', `${totalLaborHours.toFixed(1)} hrs`],
    ['Crew Days (27 hr/day)', `${crewDays}`],
    ['Work Areas', `${workAreas.length}`],
    ['Line Items', `${totalItems}`],
  ]

  for (const [label, value] of summaryData) {
    const row = detail.addRow([null, label, value])
    row.getCell(2).font = { name: 'Calibri', size: 10, bold: true }
    row.getCell(3).font = { name: 'Calibri', size: 10 }
  }

  // Download
  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${estimate.estimate_name || 'Estimate'}.xlsx`
  a.click()
  URL.revokeObjectURL(url)
}
