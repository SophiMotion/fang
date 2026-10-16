import type ExcelJS from 'exceljs'
import type { Project } from '../types'
import { calculateQuote } from '../domain/quote'
import { evaluateRisks } from '../domain/risk'
import { spreadsheetText } from './safety'

const moneyFormat = '"¥"#,##0.00;[Red]-"¥"#,##0.00'
type CellValue = string | number | null
const clean = (value: CellValue): CellValue => typeof value === 'string' ? spreadsheetText(value) : (typeof value === 'number' && !Number.isFinite(value) ? null : value)

function sheet(workbook: ExcelJS.Workbook, name: string, headers: string[], widths: number[]): ExcelJS.Worksheet {
  const ws = workbook.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }], pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } })
  ws.columns = headers.map((header, index) => ({ header, width: widths[index] ?? 18 }))
  ws.getRow(1).height = 30
  ws.getRow(1).eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF174EA6' } }
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Microsoft YaHei', size: 10 }
    cell.alignment = { vertical: 'middle', wrapText: true }
  })
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } }
  ws.pageSetup.printTitlesRow = '1:1'
  return ws
}

function append(ws: ExcelJS.Worksheet, values: CellValue[], options: { moneyColumns?: number[]; bold?: boolean } = {}): void {
  const row = ws.addRow(values.map(clean))
  row.font = { name: 'Microsoft YaHei', size: 10, bold: options.bold }
  row.alignment = { vertical: 'top', wrapText: true }
  const maxLines = values.reduce<number>((lines, value, index) => {
    const width = ws.columns[index]?.width ?? 18
    return typeof value === 'string' ? Math.max(lines, ...value.split('\n').map(s => Math.ceil([...s].reduce((n, c) => n + (c.charCodeAt(0) > 255 ? 2 : 1), 0) / (width - 2)))) : lines
  }, 1)
  row.height = Math.min(409, Math.max(24, maxLines * 16 + 8))
  if (row.number % 2 === 0) row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F6FB' } }
  options.moneyColumns?.forEach(column => { row.getCell(column).numFmt = moneyFormat })
}

export async function buildQuoteWorkbook(project: Project): Promise<ExcelJS.Workbook> {
  const module = await import('exceljs')
  const workbook = new module.default.Workbook()
  workbook.creator = 'SophiMotion 3D 报价系统'
  workbook.created = new Date()
  workbook.subject = '浏览器本地生成的报价快照；示例价格需商务确认'
  const q = calculateQuote(project.parts, project.settings)
  const risks = evaluateRisks(project.parts, project.settings)
  const s = project.settings, c = project.customer
  const summary = sheet(workbook, '报价汇总', ['项目', '内容'], [34, 90])
  const fields: Array<[string, CellValue]> = [
    ['项目名称', project.name], ['报价编号', c.quoteNumber], ['客户姓名', c.name], ['客户公司', c.company], ['联系方式', c.contact], ['报价日期', c.date], ['有效期（天）', c.validDays], ['报价方', s.sellerName], ['报价方联系方式', s.sellerContact],
    ['已计价零件种类', q.includedCount], ['未计价零件种类', q.excludedCount], ['已计价总件数', q.totalQuantity], ['已计价总重量（g）', q.totalWeightG],
    ['材料费（元）', q.materialCost], ['加工费（元）', q.processingCost], ['后处理费（元）', q.postCost], ['基础成本（元）', q.baseCost], ['成本加价率（%）', s.markupPercent], ['成本加价额（元）', q.markupAmount], ['折扣前小计（元）', q.subtotal], ['折扣减免比例（%）', s.discountPercent], ['折扣减免额（元）', q.discountAmount], ['折后未税金额（元）', q.net], ['税率（%）', s.taxPercent], ['税额（元）', q.taxAmount], ['运费（元）', q.shipping], ['含税应付总额（元）', q.total],
    ['备注', c.notes], ['报价说明', '内置费率为可编辑示例，实际交易须确认材料、工艺与报价条件。无效/待转换/失败模型不计价。'],
    ['计算顺序', '单件材料费、加工费、后处理费分别四舍五入到分→单件基础成本→按成本加价并舍入单价→乘数量→逐行求和→减免折扣→计算税额→最后加运费。加工起步价按每件应用。运费不计税。'],
    ['分析边界', '体积由三角网格估算；壁厚与悬垂为几何采样筛查，不能替代切片验证、工艺评审或打印验收。风险未知不等于通过。'],
    ['文档类型', project.isDemo ? '演示模型报价（示例）' : '本地项目报价快照'],
  ]
  for (const [label, value] of fields) append(summary, [label, value], { moneyColumns: label.includes('（元）') ? [2] : [], bold: label === '含税应付总额（元）' })

  const detail = sheet(workbook, '零件明细', ['序号', '零件名称', '原始文件', '格式', '材料', '工艺', '后处理', '数量', '体积（cm³/件）', '重量（g/件）', '材料费（元/件）', '加工费（元/件）', '后处理费（元/件）', '基础成本（元/件）', '含加价单价（元）', '行合计（元）', '报价状态', '未计价原因', 'X（mm）', 'Y（mm）', 'Z（mm）', '密度（g/cm³）', '材料单价（元/g）'], [8, 30, 32, 10, 20, 22, 18, 10, 18, 18, 18, 18, 18, 20, 20, 20, 14, 50, 15, 15, 15, 18, 20])
  project.parts.forEach((p, index) => {
    const line = q.lines[index], material = s.materials.find(m => m.id === p.config.materialId), process = s.processes.find(x => x.id === p.config.processId), post = s.postProcesses.find(x => x.id === p.config.postProcessId)
    append(detail, [index + 1, p.name, p.fileName, p.format, material?.name ?? p.config.materialId, process?.name ?? p.config.processId, post?.name ?? p.config.postProcessId, p.quantity, line.volumeCm3, line.weightG, ...([line.materialCost, line.processingCost, line.postCost, line.unitCost, line.unitPrice, line.lineTotal].map(value => line.eligible ? value : null)), line.eligible ? '已计价' : '未计价', line.reason ?? '', ...(p.analysis?.dimensionsMm ?? [null, null, null]), p.config.densityOverride ?? material?.density ?? null, p.config.materialRateOverride ?? material?.pricePerGram ?? null], { moneyColumns: [11, 12, 13, 14, 15, 16, 23] })
  })
  for (const col of [9, 10, 19, 20, 21, 22]) detail.getColumn(col).numFmt = '0.000'

  const riskSheet = sheet(workbook, '风险筛查', ['零件', '规则', '状态', '严重度', '指标值', '规则阈值', '依据与单位', '建议'], [28, 26, 14, 12, 18, 18, 78, 72])
  for (const r of risks) append(riskSheet, [r.partName, r.ruleName, r.status === 'unknown' ? '未知 / 待复核' : '触发风险', { high: '高', medium: '中', low: '低' }[r.severity], r.value, r.threshold, r.message, r.suggestion])
  if (!risks.length) append(riskSheet, ['全部零件', '当前启用规则', '未发现触发项', '', null, null, '仅表示已启用规则未触发，不等于制造合格。', '结合切片、设备与实物验证。'])

  const params = sheet(workbook, '价格与规则', ['类别', '名称', '参数一', '参数二', '参数三', '适用范围 / 说明'], [18, 28, 32, 32, 38, 90])
  append(params, ['价格来源', '可编辑示例', null, null, null, '全部内置价格仅演示计算，未引用市场报价。导出为当前配置的静态快照。'])
  append(params, ['计算顺序', '分币舍入', null, null, null, '单件费用分别舍入→合计单件成本→加价并舍入单价→数量→项目折扣→税→运费。'])
  for (const m of s.materials) append(params, ['材料', m.name, m.density, m.pricePerGram, null, `参数一：密度 g/cm³；参数二：元/g；适用：${m.processIds.join(', ')}`])
  for (const p of s.processes) append(params, ['工艺', p.name, p.pricePerCm3, p.setupFee, p.minWallMm, `参数一：元/cm³；参数二：每件加工起步价（元）；参数三：建议壁厚 mm；成型范围：${p.maxSizeMm.join(' × ')} mm`])
  for (const p of s.postProcesses) append(params, ['后处理', p.name, p.pricePerPart, null, null, `参数一：元/件；适用：${p.processIds.join(', ')}`])
  for (const r of s.rules) append(params, ['风险规则', r.name, r.threshold, r.enabled ? '启用' : '停用', `${r.metric} ${r.operator === 'lt' ? '<' : '>'}`, `工艺：${r.processId || 'all'}；材料：${r.materialId || 'all'}；严重度：${r.severity}；${r.suggestion}`])
  return workbook
}
