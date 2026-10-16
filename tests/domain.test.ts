import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, createProject } from '../src/domain/defaults'
import { calculateQuote } from '../src/domain/quote'
import { evaluateRisks } from '../src/domain/risk'
import type { Part, RiskRule, Settings } from '../src/types'

const settings = (): Settings => ({ ...structuredClone(DEFAULT_SETTINGS), markupPercent: 25, discountPercent: 10, taxPercent: 13, shipping: 8 })
const part = (changes: Partial<Part> = {}): Part => ({
  id: 'one', name: '连接支架', fileName: '支架.stl', format: 'STL', color: '#4285f4', quantity: 3, unit: 'mm',
  status: 'ready', visible: true, config: { materialId: 'pla', processId: 'fdm', postProcessId: 'polish' },
  analysis: { volumeCm3: 10, surfaceAreaCm2: 30, dimensionsMm: [10, 20, 50], triangleCount: 12, boundaryEdges: 0, nonManifoldEdges: 0, degenerateTriangles: 0, inconsistentEdges: 0, valid: true, warnings: [], overhangPercent: 20 },
  ...changes,
})
const rule = (changes: Partial<RiskRule> = {}): RiskRule => ({ id: 'test', name: '测试规则', enabled: true, metric: 'wallThickness', operator: 'lt', threshold: 1, severity: 'high', processId: '', materialId: '', suggestion: '检查模型', ...changes })

describe('quote monetary contract', () => {
  it('rounds unit costs before quantity and applies discount, tax, then shipping', () => {
    const s = settings()
    s.materials.find(m => m.id === 'pla')!.pricePerGram = 0.18
    s.processes.find(p => p.id === 'fdm')!.pricePerCm3 = 0.8
    s.processes.find(p => p.id === 'fdm')!.setupFee = 12
    s.postProcesses.find(p => p.id === 'polish')!.pricePerPart = 6
    const q = calculateQuote([part()], s)
    expect(q.lines[0]).toMatchObject({ eligible: true, weightG: 12.4, materialCost: 2.23, processingCost: 12, postCost: 6, unitCost: 20.23, unitPrice: 25.29, quantity: 3, lineTotal: 75.87 })
    expect(q).toMatchObject({ baseCost: 60.69, markupAmount: 15.18, subtotal: 75.87, discountAmount: 7.59, net: 68.28, taxAmount: 8.88, shipping: 8, total: 85.16, totalQuantity: 3, totalWeightG: 37.2 })
  })

  it('keeps each part material and overrides independent', () => {
    const s = settings()
    s.markupPercent = s.discountPercent = s.taxPercent = s.shipping = 0
    s.processes[0].setupFee = 12
    s.postProcesses.find(p => p.id === 'polish')!.pricePerPart = 6
    const a = part({ quantity: 1, config: { materialId: 'pla', processId: 'fdm', postProcessId: 'polish', densityOverride: 2, materialRateOverride: 0.5 } })
    const b = part({ id: 'two', quantity: 2, config: { materialId: 'resin', processId: 'sla', postProcessId: 'none' } })
    const before = calculateQuote([a, b], s)
    a.config.materialRateOverride = 1
    const after = calculateQuote([a, b], s)
    expect(before.lines[0].materialCost).toBe(10)
    expect(after.lines[0].materialCost).toBe(20)
    expect(after.lines[1]).toEqual(before.lines[1])
    expect(after.total - before.total).toBe(10)
  })

  it('uses processing volume price when it exceeds the per-piece setup minimum', () => {
    const s = settings()
    s.processes[0].pricePerCm3 = 10
    s.processes[0].setupFee = 12
    expect(calculateQuote([part()], s).lines[0].processingCost).toBe(100)
  })

  it.each(['pending', 'error', 'invalid'] as const)('excludes %s rows instead of pricing them as successful zeroes', status => {
    const q = calculateQuote([part({ status })], settings())
    expect(q).toMatchObject({ includedCount: 0, excludedCount: 1, shipping: 0, total: 0 })
    expect(q.lines[0]).toMatchObject({ eligible: false, lineTotal: 0 })
    expect(q.lines[0].reason).toBeTruthy()
  })

  it('excludes incompatible material-process and post-process combinations', () => {
    const s = settings()
    s.postProcesses.push({ id: 'metal-only', name: '金属工艺', pricePerPart: 10, processIds: ['slm'] })
    const a = part({ config: { materialId: 'steel', processId: 'sla', postProcessId: 'none' } })
    const b = part({ id: 'two', config: { materialId: 'pla', processId: 'fdm', postProcessId: 'metal-only' } })
    expect(calculateQuote([a, b], s).excludedCount).toBe(2)
  })

  it.each([0, -1, 1.5, NaN, Infinity])('rejects invalid quantity %s', quantity => {
    expect(calculateQuote([part({ quantity })], settings()).lines[0].eligible).toBe(false)
  })

  it('rejects nonfinite overrides, invalid global percentages and untrusted volume', () => {
    const p = part()
    p.config.densityOverride = NaN
    expect(calculateQuote([p], settings()).total).toBe(0)
    p.config.densityOverride = 1
    p.analysis!.volumeCm3 = null
    expect(calculateQuote([p], settings()).total).toBe(0)
    const s = settings()
    s.discountPercent = 101
    expect(calculateQuote([part()], s).lines[0].eligible).toBe(false)
    s.discountPercent = 10
    s.processes[0].pricePerCm3 = -1
    expect(calculateQuote([part()], s).lines[0].eligible).toBe(false)
  })

  it('retains consistent cents and unit-line reconciliation for fractional inputs', () => {
    const s = settings()
    s.markupPercent = 0
    s.materials[0].density = 1
    s.materials[0].pricePerGram = 0.1005
    s.processes[0].setupFee = s.processes[0].pricePerCm3 = 0
    const p = part({ quantity: 7, config: { materialId: 'pla', processId: 'fdm', postProcessId: 'none' } })
    const q = calculateQuote([p], s)
    expect(q.lines[0].unitPrice).toBe(1.01)
    expect(q.lines[0].lineTotal).toBe(7.07)
    expect(q.baseCost).toBe(7.07)
  })

  it('does not share mutable defaults between projects', () => {
    const a = createProject(), b = createProject()
    a.settings.materials[0].density = 10
    a.customer.name = '客户一'
    expect(b.settings.materials[0].density).toBe(1.24)
    expect(b.customer.name).toBe('')
    expect(a.id).not.toBe(b.id)
    expect(a.parts).toHaveLength(0)
  })
})

describe('risk evidence contract', () => {
  it('reports unknown wall thickness until sufficient samples exist', () => {
    const s = settings(); s.rules = [rule()]
    expect(evaluateRisks([part()], s)).toEqual(expect.arrayContaining([expect.objectContaining({ ruleId: 'test', status: 'unknown', value: null })]))
  })

  it('uses p10 thickness and documents both p10 and minimum instead of bounding box size', () => {
    const p = part()
    p.thickness = { minMm: 0.2, p10Mm: 0.8, medianMm: 1.2, thinAreaPercent: 22, validSamples: 80, totalSamples: 100, thresholdMm: 1, points: new Float32Array(), values: new Float32Array() }
    const s = settings(); s.rules = [rule()]
    const result = evaluateRisks([p], s).find(r => r.ruleId === 'test')!
    expect(result).toMatchObject({ status: 'triggered', value: 0.8 })
    expect(result.message).toContain('P10')
    expect(result.message).toContain('0.2')
    p.thickness.validSamples = 2
    expect(evaluateRisks([p], s).find(r => r.ruleId === 'test')!.status).toBe('unknown')
  })

  it('marks thin-area evidence unknown when measured against a stale wall threshold', () => {
    const p = part()
    p.thickness = { minMm: 0.2, p10Mm: 0.8, medianMm: 1.2, thinAreaPercent: 22, validSamples: 80, totalSamples: 100, thresholdMm: 9, points: new Float32Array(), values: new Float32Array() }
    const s = settings(); s.rules = [rule({ metric: 'thinArea', operator: 'gt', threshold: 10 })]
    expect(evaluateRisks([p], s).find(r => r.ruleId === 'test')!.status).toBe('unknown')
  })

  it('matches rule scope and responds immediately to threshold or enabled edits', () => {
    const s = settings(); s.rules = [rule({ metric: 'overhang', operator: 'gt', threshold: 19, processId: 'fdm', materialId: 'pla' })]
    expect(evaluateRisks([part()], s).filter(r => r.ruleId === 'test')).toHaveLength(1)
    s.rules[0].threshold = 21
    expect(evaluateRisks([part()], s).filter(r => r.ruleId === 'test')).toHaveLength(0)
    s.rules[0].threshold = 19; s.rules[0].enabled = false
    expect(evaluateRisks([part()], s).filter(r => r.ruleId === 'test')).toHaveLength(0)
    s.rules[0].enabled = true; s.rules[0].materialId = 'steel'
    expect(evaluateRisks([part()], s).filter(r => r.ruleId === 'test')).toHaveLength(0)
  })

  it('checks each machine axis even when the part maximum dimension fits another axis', () => {
    const p = part(); p.analysis!.dimensionsMm = [150, 90, 90]
    const s = settings(); s.rules = []; s.processes[0].maxSizeMm = [100, 300, 300]
    expect(evaluateRisks([p], s)).toEqual(expect.arrayContaining([expect.objectContaining({ ruleId: 'builtin-build-size', status: 'triggered' })]))
  })

  it('measures geometry anomalies as counts and maxDimension in millimeters', () => {
    const p = part(); p.analysis!.boundaryEdges = 4; p.analysis!.inconsistentEdges = 2
    const s = settings(); s.rules = [rule({ id: 'geometry', metric: 'geometry', operator: 'gt', threshold: 0 }), rule({ id: 'dimension', metric: 'maxDimension', operator: 'gt', threshold: 45 })]
    expect(evaluateRisks([p], s)).toEqual(expect.arrayContaining([
      expect.objectContaining({ ruleId: 'geometry', value: 6, status: 'triggered' }),
      expect.objectContaining({ ruleId: 'dimension', value: 50, status: 'triggered' }),
    ]))
  })

  it('never reports pending or malformed configuration as a clean risk result', () => {
    const s = settings(); s.rules = []
    expect(evaluateRisks([part({ status: 'pending' })], s).some(r => r.status === 'unknown')).toBe(true)
    expect(evaluateRisks([part({ config: { materialId: 'steel', processId: 'sla', postProcessId: 'none' } })], s).some(r => r.status === 'triggered')).toBe(true)
  })
})

describe('export data integrity', () => {
  it('exports numeric amounts and customer fields, while retaining excluded rows and blocking spreadsheet formulas', async () => {
    const { buildQuoteWorkbook } = await import('../src/export/index')
    const project = createProject()
    project.customer.name = '=HYPERLINK("https://example.com")'
    project.parts = [part(), part({ id: 'pending', name: '待转换文件', status: 'pending' })]
    const workbook = await buildQuoteWorkbook(project)
    const summary = workbook.getWorksheet('报价汇总')!
    const rows = summary.getRows(1, summary.rowCount)!.map(row => row.values as unknown[])
    expect(rows.find(row => row[1] === '客户姓名')?.[2]).toBe('\'=HYPERLINK("https://example.com")')
    expect(rows.find(row => row[1] === '含税应付总额（元）')?.[2]).toBe(calculateQuote(project.parts, project.settings).total)
    const detail = workbook.getWorksheet('零件明细')!
    const header = detail.getRow(1).values as unknown[]
    const statusIndex = header.indexOf('报价状态'), totalIndex = header.indexOf('行合计（元）')
    expect(detail.getRow(2).getCell(totalIndex).type).toBe(2)
    expect(detail.getRow(3).getCell(statusIndex).value).toBe('未计价')
    expect(detail.getRow(3).getCell(totalIndex).value).toBeNull()
    expect(workbook.getWorksheet('风险筛查')).toBeTruthy()
    expect(workbook.getWorksheet('价格与规则')).toBeTruthy()
    const buffer = await workbook.xlsx.writeBuffer()
    expect(buffer.byteLength).toBeGreaterThan(1000)
  }, 30_000)

  it('normalizes unsafe filenames without accepting path separators or control characters', async () => {
    const { safeFileName } = await import('../src/export/index')
    expect(safeFileName('../../报价\u0000<客户>', 'pdf')).not.toMatch(/[<>\x00/\\]/)
    expect(safeFileName('CON', 'xlsx')).not.toBe('CON.xlsx')
    expect(safeFileName('项目', 'pdf')).toBe('项目.pdf')
  })
})
