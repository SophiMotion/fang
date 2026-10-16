import type { jsPDF } from 'jspdf'
import type { Project } from '../types'
import { calculateQuote } from '../domain/quote'
import { evaluateRisks } from '../domain/risk'

const WIDTH = 1680, HEIGHT = 2376, MARGIN = 112, BOTTOM = 2200
const CONTENT = WIDTH - MARGIN * 2
const FONT = '"Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", "WenQuanYi Micro Hei", sans-serif'
const money = (value: number) => `¥${value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

class QuotePainter {
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  y = 270
  page = 1
  constructor(private pdf: jsPDF) {
    this.canvas = document.createElement('canvas')
    this.canvas.width = WIDTH; this.canvas.height = HEIGHT
    const ctx = this.canvas.getContext('2d')
    if (!ctx) throw new Error('浏览器无法创建 PDF 绘制画布，请尝试导出 Excel。')
    this.ctx = ctx
    this.startPage()
  }
  font(size = 27, bold = false) { this.ctx.font = `${bold ? '600' : '400'} ${size}px ${FONT}`; this.ctx.textBaseline = 'top' }
  text(value: string, x: number, y: number, size = 27, color = '#202124', bold = false) {
    this.font(size, bold); this.ctx.fillStyle = color; this.ctx.fillText(value, x, y)
  }
  wrap(value: string, maxWidth: number, size = 27, bold = false): string[] {
    this.font(size, bold)
    const result: string[] = []
    for (const paragraph of String(value).replace(/\r\n/g, '\n').split('\n')) {
      let line = ''
      for (const char of paragraph) {
        if (line && this.ctx.measureText(line + char).width > maxWidth) { result.push(line); line = char } else line += char
      }
      result.push(line)
    }
    return result
  }
  startPage() {
    const c = this.ctx
    c.fillStyle = '#ffffff'; c.fillRect(0, 0, WIDTH, HEIGHT)
    ;['#4285f4', '#ea4335', '#fbbc04', '#34a853'].forEach((color, i) => { c.fillStyle = color; c.fillRect(MARGIN + i * CONTENT / 4, 78, CONTENT / 4, 7) })
    this.text('SOPHIMOTION  /  3D PRINTING', MARGIN, 112, 23, '#5f6368', true)
    this.text('3D 打印报价单', MARGIN, 162, 52, '#202124', true)
    this.y = 262
  }
  finishPage() {
    this.ctx.strokeStyle = '#dadce0'; this.ctx.lineWidth = 2
    this.ctx.beginPath(); this.ctx.moveTo(MARGIN, 2250); this.ctx.lineTo(WIDTH - MARGIN, 2250); this.ctx.stroke()
    this.text('CNY 人民币 · 浏览器本机生成', MARGIN, 2280, 22, '#5f6368')
    this.text(`第 ${this.page} 页`, WIDTH - MARGIN - 150, 2280, 22, '#5f6368')
    this.pdf.addImage(this.canvas.toDataURL('image/png'), 'PNG', 0, 0, 210, 297, undefined, 'FAST')
  }
  newPage() { this.finishPage(); this.pdf.addPage(); this.page++; this.startPage() }
  ensure(height: number) { if (this.y + height > BOTTOM) this.newPage() }
  paragraph(value: string, size = 27, color = '#5f6368', bold = false) {
    const lines = this.wrap(value, CONTENT, size, bold)
    for (const line of lines) { this.ensure(size + 14); this.text(line, MARGIN, this.y, size, color, bold); this.y += size + 14 }
    this.y += 8
  }
  title(value: string) { this.ensure(180); this.y += 26; this.text(value, MARGIN, this.y, 32, '#174ea6', true); this.y += 60 }
  field(label: string, value: string) {
    const lines = this.wrap(value || '—', CONTENT - 230)
    lines.forEach((line, index) => {
      this.ensure(42)
      if (index === 0) this.text(label, MARGIN, this.y, 25, '#5f6368')
      this.text(line, MARGIN + 230, this.y, 27)
      this.y += 42
    })
  }
  table(headers: string[], widths: number[], rows: string[][]) {
    const header = () => {
      this.ensure(76)
      this.ctx.fillStyle = '#e8f0fe'; this.ctx.fillRect(MARGIN, this.y, CONTENT, 64)
      let x = MARGIN
      headers.forEach((cell, i) => { this.text(cell, x + 12, this.y + 18, 23, '#174ea6', true); x += widths[i] })
      this.y += 64
    }
    header()
    rows.forEach((row, rowIndex) => {
      const cells = row.map((value, i) => this.wrap(value, widths[i] - 24, 24))
      const lineCount = Math.max(...cells.map(c => c.length))
      const rowHeight = lineCount * 36 + 26
      // Keep ordinary rows intact. Split only rows taller than a complete page.
      if (rowHeight < BOTTOM - 326 && this.y + rowHeight > BOTTOM) { this.newPage(); header() }
      let offset = 0
      while (offset < lineCount) {
        if (this.y + 64 > BOTTOM) { this.newPage(); header() }
        const count = Math.min(lineCount - offset, Math.floor((BOTTOM - this.y - 26) / 36))
        const height = count * 36 + 26
        this.ctx.fillStyle = rowIndex % 2 === 0 ? '#f8fafd' : '#ffffff'; this.ctx.fillRect(MARGIN, this.y, CONTENT, height)
        let x = MARGIN
        cells.forEach((lines, i) => { lines.slice(offset, offset + count).forEach((line, j) => this.text(line, x + 12, this.y + 12 + j * 36, 24)); x += widths[i] })
        this.ctx.strokeStyle = '#e8eaed'; this.ctx.lineWidth = 1; this.ctx.strokeRect(MARGIN, this.y, CONTENT, height)
        this.y += height; offset += count
        if (offset < lineCount) { this.newPage(); header() }
      }
    })
    this.y += 20
  }
}

export async function buildQuotePdf(project: Project): Promise<jsPDF> {
  if (typeof document === 'undefined') throw new Error('PDF 导出需要支持 Canvas 的浏览器。')
  await document.fonts?.ready
  const { jsPDF: PDF } = await import('jspdf')
  const pdf = new PDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true })
  pdf.setProperties({ title: `${project.customer.quoteNumber || project.name} - 3D 打印报价单`, author: project.settings.sellerName, subject: '本地生成报价；价格与分析结果需商务及工艺复核' })
  const p = new QuotePainter(pdf), q = calculateQuote(project.parts, project.settings), s = project.settings, c = project.customer
  const risks = evaluateRisks(project.parts, s)
  p.field('项目名称', project.name)
  p.field('报价编号', c.quoteNumber)
  p.field('客户姓名 / 公司', [c.name, c.company].filter(Boolean).join(' / '))
  p.field('客户联系方式', c.contact)
  p.field('报价日期 / 有效期', `${c.date} / ${c.validDays} 天`)
  p.field('报价方', [s.sellerName, s.sellerContact].filter(Boolean).join(' / '))
  if (project.isDemo) p.paragraph('演示项目：模型及费率仅用于功能体验。', 25, '#b06000', true)
  p.title('01  零件报价')
  p.paragraph(`已计价 ${q.includedCount} 种 / ${q.totalQuantity} 件，未计价 ${q.excludedCount} 种。以下单价包含成本加价，行合计尚未扣除项目折扣、税费及运费。`, 25)
  p.table(['#', '零件 / 原始文件', '材料 / 工艺 / 后处理', '数量', '单价（元）', '行合计（元）'], [54, 420, 410, 92, 235, 245], project.parts.map((part, index) => {
    const line = q.lines[index], material = s.materials.find(m => m.id === part.config.materialId), process = s.processes.find(x => x.id === part.config.processId), post = s.postProcesses.find(x => x.id === part.config.postProcessId)
    return [String(index + 1), `${part.name}\n${part.fileName}${line.eligible ? '' : `\n未计价：${line.reason}`}`, [material?.name ?? part.config.materialId, process?.name ?? part.config.processId, post?.name ?? part.config.postProcessId].join('\n'), String(part.quantity), line.eligible ? money(line.unitPrice) : '未计价', line.eligible ? money(line.lineTotal) : '未计价']
  }))
  if (!project.parts.length) p.paragraph('尚无零件。请先导入模型并完成有效性检查。')
  p.title('02  费用汇总')
  const totals: Array<[string, number]> = [
    ['材料费', q.materialCost], ['加工费（起步价按件应用）', q.processingCost], ['后处理费', q.postCost], ['基础成本', q.baseCost],
    [`成本加价 ${s.markupPercent}%`, q.markupAmount], ['折扣前小计', q.subtotal], [`折扣减免 ${s.discountPercent}%`, -q.discountAmount], ['折后未税金额', q.net], [`税额 ${s.taxPercent}%`, q.taxAmount], ['运费（不计税）', q.shipping],
  ]
  for (const [label, amount] of totals) {
    p.ensure(46); p.text(label, MARGIN, p.y, 26, '#5f6368'); p.text(money(amount), WIDTH - MARGIN - 340, p.y, 28); p.y += 44
  }
  p.ensure(116)
  p.ctx.fillStyle = '#e8f0fe'; p.ctx.fillRect(MARGIN, p.y, CONTENT, 100)
  p.text('含税应付总额', MARGIN + 24, p.y + 30, 32, '#174ea6', true)
  p.text(money(q.total), WIDTH - MARGIN - 460, p.y + 24, 42, '#174ea6', true)
  p.y += 130
  p.paragraph('计算顺序：单件材料费、加工费、后处理费分别舍入到分 → 单件成本 → 成本加价并舍入单价 → 乘数量 → 行金额求和 → 项目折扣 → 税 → 运费。无已计价零件时不收运费。', 24)
  p.title('03  风险与工艺复核')
  p.paragraph('壁厚与悬垂为几何采样筛查，可能遗漏局部特征。P10 是厚度采样的第 10 百分位数，不是全局最小壁厚；未知结果不表示通过。风险结果不构成制造合格结论或失败概率预测。', 24)
  if (!risks.length) p.paragraph('当前启用规则未发现触发项。仍需依据切片、设备能力及实物检查确认。', 25)
  for (const risk of risks) {
    p.ensure(120)
    p.paragraph(`${risk.partName} · ${risk.ruleName} · ${risk.status === 'unknown' ? '未知 / 待复核' : { high: '高风险', medium: '中风险', low: '提醒' }[risk.severity]}`, 27, risk.status === 'unknown' ? '#b06000' : '#b3261e', true)
    p.paragraph(`依据：${risk.message}`, 24)
    p.paragraph(`建议：${risk.suggestion}`, 24)
  }
  p.title('04  报价说明与备注')
  p.paragraph('内置材料和加工费率为可编辑示例，请在对外报价前确认。体积按三角网格计算；不支持直接解析的原生文件及无效模型不会纳入报价。交期、颜色、公差、验收、付款与配送条件以双方确认内容为准。', 24)
  p.paragraph(c.notes || '暂无补充备注。', 26, '#202124')
  p.paragraph('此 PDF 采用高清页面图像以保证本机中文显示，不支持文字搜索。可复制的明细与参数请使用 Excel 导出。', 22)
  p.finishPage()
  p.canvas.width = p.canvas.height = 1
  return pdf
}
