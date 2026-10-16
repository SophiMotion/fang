import type { Project } from '../types'
import { buildQuoteWorkbook } from './workbook'
import { buildQuotePdf } from './pdf'
import { downloadBlob, safeFileName } from './safety'

export { buildQuoteWorkbook, buildQuotePdf, safeFileName }

export async function exportExcel(project: Project): Promise<void> {
  const workbook = await buildQuoteWorkbook(project)
  const buffer = await workbook.xlsx.writeBuffer()
  downloadBlob(new Blob([new Uint8Array(buffer)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), safeFileName(project.customer.quoteNumber || project.name, 'xlsx'))
}

export async function exportPdf(project: Project): Promise<void> {
  const pdf = await buildQuotePdf(project)
  downloadBlob(pdf.output('blob'), safeFileName(project.customer.quoteNumber || project.name, 'pdf'))
}
