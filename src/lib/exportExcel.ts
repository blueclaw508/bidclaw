// Export estimate to Excel — quantities and descriptions only, no pricing
// Uses exceljs for professional formatting (borders, fills, fonts, merged cells)
// Dynamic import to keep initial bundle small — exceljs is ~650KB
import type { EstimateRecord, WorkAreaData, LineItemData } from '@/lib/types'

const NAVY = '1E3A5F'
const LIGHT_GRAY = 'F5F5F5'
const BORDER_GRAY = 'D1D5DB'

export async function exportEstimateToExcel(
  estimate: EstimateRecord,
  workAreas: WorkAreaData[],
  lineItems: Record<string, LineItemData[]>,
) {
  const ExcelJS = await import('exceljs')

  type Border = { style: 'thin'; color: { argb: string } }
  type Borders = { top: Border; bottom: Border; left: Border; right: Border }
  const thinBorder: Border = { style: 'thin', color: { argb: BORDER_GRAY } }
  const allBorders: Borders = { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder }

  const wb = new ExcelJS.Workbook()
  wb.creator = 'BidClaw'

  const clientName = estimate.client_name || ''
  const estimateName = estimate.project_name || (clientName ? `BidClaw — ${clientName}` : 'BidClaw Estimate')

  // ══════════════════════════════════════════════
  // Sheet 1 — Cover
  // ══════════════════════════════════════════════
  const cover = wb.addWorksheet('Cover')
  cover.columns = [{ width: 20 }, { width: 50 }]

  // Company header
  const titleRow = cover.addRow(['Blue Claw Associates Inc.'])
  titleRow.font = { name: 'Calibri', size: 16, bold: true, color: { argb: NAVY } }
  cover.mergeCells(`A${titleRow.number}:B${titleRow.number}`)
  cover.addRow([])

  // Estimate title
  const nameRow = cover.addRow([estimateName])
  nameRow.font = { name: 'Calibri', size: 14, bold: true }
  cover.mergeCells(`A${nameRow.number}:B${nameRow.number}`)
  cover.addRow([])

  // Info fields
  const addField = (label: string, value: string) => {
    if (!value) return
    const r = cover.addRow([label, value])
    r.getCell(1).font = { name: 'Calibri', size: 10, bold: true, color: { argb: '6B7280' } }
    r.getCell(2).font = { name: 'Calibri', size: 10 }
  }
  addField('Client', clientName)
  addField('Address', estimate.project_address || '')
  addField('Date', new Date().toLocaleDateString())
  if (estimate.project_description) {
    cover.addRow([])
    addField('Description', estimate.project_description)
    cover.getCell(`B${cover.rowCount}`).alignment = { wrapText: true }
  }

  // Print setup
  cover.pageSetup = { orientation: 'portrait', fitToPage: true, fitToWidth: 1 }

  // ══════════════════════════════════════════════
  // Sheet 2 — Estimate Detail
  // ══════════════════════════════════════════════
  const detail = wb.addWorksheet('Estimate Detail')
  detail.columns = [
    { width: 45 },  // Item Name
    { width: 12 },  // Quantity
    { width: 10 },  // Unit
    { width: 16 },  // Category
  ]

  let grandTotalHours = 0
  let grandTotalItems = 0

  for (const wa of workAreas) {
    const items = lineItems[wa.id] ?? []
    grandTotalItems += items.length

    // Work area header row (navy background, white text, merged)
    const headerRow = detail.addRow([wa.name, '', '', ''])
    detail.mergeCells(`A${headerRow.number}:D${headerRow.number}`)
    headerRow.getCell(1).font = { name: 'Calibri', size: 12, bold: true, color: { argb: 'FFFFFF' } }
    headerRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } }
    headerRow.getCell(1).alignment = { vertical: 'middle' }
    headerRow.height = 24

    // Scope description (merged, wrapped)
    const scopeDesc = wa.scope_description
    if (scopeDesc) {
      const scopeRow = detail.addRow([scopeDesc, '', '', ''])
      detail.mergeCells(`A${scopeRow.number}:D${scopeRow.number}`)
      scopeRow.getCell(1).font = { name: 'Calibri', size: 9, color: { argb: '4B5563' } }
      scopeRow.getCell(1).alignment = { wrapText: true, vertical: 'top' }
      // Estimate row height based on lines
      const lineCount = scopeDesc.split('\n').length
      scopeRow.height = Math.max(15, lineCount * 13)
    }

    // Column headers for line items
    const colRow = detail.addRow(['Item Name', 'Quantity', 'Unit', 'Category'])
    for (let c = 1; c <= 4; c++) {
      const cell = colRow.getCell(c)
      cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFF' } }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '475569' } }
      cell.border = allBorders
      cell.alignment = c >= 2 ? { horizontal: 'center' } : {}
    }

    // Line items with alternating row colors
    let waHours = 0
    items.forEach((li, idx) => {
      const row = detail.addRow([li.name, li.quantity, li.unit, li.category])
      if (li.category === 'Labor') waHours += li.quantity || 0

      for (let c = 1; c <= 4; c++) {
        const cell = row.getCell(c)
        cell.font = { name: 'Calibri', size: 10 }
        cell.border = allBorders
        if (c >= 2) cell.alignment = { horizontal: 'center' }
        if (idx % 2 === 1) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT_GRAY } }
        }
      }
    })

    grandTotalHours += waHours

    // Labor hours subtotal
    if (waHours > 0) {
      const subRow = detail.addRow(['Labor Hours', waHours, 'MH', ''])
      subRow.getCell(1).font = { name: 'Calibri', size: 10, bold: true }
      subRow.getCell(1).alignment = { horizontal: 'right' }
      subRow.getCell(2).font = { name: 'Calibri', size: 10, bold: true }
      subRow.getCell(2).alignment = { horizontal: 'center' }
      subRow.getCell(3).alignment = { horizontal: 'center' }
      for (let c = 1; c <= 4; c++) subRow.getCell(c).border = allBorders
    }

    // Spacer
    detail.addRow([])
  }

  // ── Summary section ──
  detail.addRow([])
  const summaryHeader = detail.addRow(['ESTIMATE SUMMARY', '', '', ''])
  detail.mergeCells(`A${summaryHeader.number}:D${summaryHeader.number}`)
  summaryHeader.getCell(1).font = { name: 'Calibri', size: 12, bold: true, color: { argb: NAVY } }

  const crewDays = grandTotalHours > 0 ? Math.ceil(grandTotalHours / 27) : 0
  const summaryData = [
    ['Total Labor Hours', grandTotalHours, 'MH'],
    ['Crew Days (27 MH/day)', crewDays, 'days'],
    ['Work Areas', workAreas.length, ''],
    ['Total Line Items', grandTotalItems, ''],
  ]
  for (const [label, value, unit] of summaryData) {
    const row = detail.addRow([label, value, unit, ''])
    row.getCell(1).font = { name: 'Calibri', size: 10, bold: true }
    row.getCell(2).font = { name: 'Calibri', size: 10 }
    row.getCell(2).alignment = { horizontal: 'center' }
    row.getCell(3).alignment = { horizontal: 'center' }
    for (let c = 1; c <= 4; c++) row.getCell(c).border = allBorders
  }

  // Print setup
  detail.pageSetup = { orientation: 'portrait', fitToPage: true, fitToWidth: 1 }

  // ══════════════════════════════════════════════
  // Generate and download
  // ══════════════════════════════════════════════
  const buffer = await wb.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  const safeName = (clientName || 'Estimate').replace(/[^a-zA-Z0-9 ]/g, '').trim()
  a.href = url
  a.download = `${safeName} - Estimate.xlsx`
  a.click()
  URL.revokeObjectURL(url)
}
