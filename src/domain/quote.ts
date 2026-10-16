import type { Part, Quote, QuoteLine, Settings } from '../types'

// Work in integer cents once a charge is rounded. Each part has a rounded unit
// selling price, so the visible unit price multiplied by quantity always reconciles.
const cents = (value: number): number => Math.round((value + Number.EPSILON * Math.max(1, Math.abs(value))) * 100)
const yuan = (value: number): number => value / 100
const validNumber = (value: number, max = 1e9): boolean => Number.isFinite(value) && value >= 0 && value <= max
const safeCents = (value: number): boolean => Number.isSafeInteger(value) && value >= 0

export function settingsError(settings: Settings): string | undefined {
  if (!validNumber(settings.markupPercent, 10000)) return '成本加价率须为 0～10000% 的有限数值'
  if (!validNumber(settings.discountPercent, 100)) return '折扣减免比例须为 0～100%'
  if (!validNumber(settings.taxPercent, 100)) return '税率须为 0～100%'
  if (!validNumber(settings.shipping)) return '运费须为非负有限数值'
}

export function partConfigurationError(part: Part, settings: Settings): string | undefined {
  const materials = settings.materials.filter(m => m.id === part.config.materialId)
  const processes = settings.processes.filter(p => p.id === part.config.processId)
  const posts = settings.postProcesses.filter(p => p.id === part.config.postProcessId)
  if (materials.length !== 1 || processes.length !== 1 || posts.length !== 1) return '材料、工艺或后处理配置缺失，或标识重复'
  const [material] = materials, [process] = processes, [post] = posts
  if (!material.processIds.includes(process.id)) return `${material.name} 不适用于 ${process.name}`
  if (!post.processIds.includes(process.id)) return `${post.name} 不适用于 ${process.name}`
  const density = part.config.densityOverride ?? material.density
  const materialRate = part.config.materialRateOverride ?? material.pricePerGram
  if (!validNumber(density, 10000) || density === 0) return '材料密度须为大于 0 的有限数值'
  if (!validNumber(materialRate)) return '材料单价须为非负有限数值'
  if (!validNumber(process.pricePerCm3) || !validNumber(process.setupFee) || !validNumber(post.pricePerPart)) return '加工、起步价或后处理价格无效'
  if (!Number.isSafeInteger(part.quantity) || part.quantity < 1 || part.quantity > 1e6) return '数量须为 1～1000000 的整数'
}

function exclusionReason(part: Part, settings: Settings): string | undefined {
  if (part.status !== 'ready') return part.message || ({ invalid: '几何无效，未计价', pending: '等待转换或解析，未计价', error: '解析失败，未计价' }[part.status])
  const a = part.analysis
  if (!a || !a.valid || a.volumeCm3 === null || !Number.isFinite(a.volumeCm3) || a.volumeCm3 <= 0) return '未取得可靠的封闭网格体积，未计价'
  if ([a.boundaryEdges, a.nonManifoldEdges, a.degenerateTriangles, a.inconsistentEdges].some(v => !Number.isFinite(v) || v !== 0)) return '网格存在几何异常，修复前未计价'
  return settingsError(settings) || partConfigurationError(part, settings)
}

export function calculateQuote(parts: Part[], settings: Settings): Quote {
  const lines: QuoteLine[] = parts.map(part => {
    const line: QuoteLine = { partId: part.id, eligible: false, volumeCm3: part.analysis?.volumeCm3 ?? null, weightG: null, materialCost: 0, processingCost: 0, postCost: 0, unitCost: 0, unitPrice: 0, quantity: part.quantity, lineTotal: 0 }
    const reason = exclusionReason(part, settings)
    if (reason) return { ...line, reason }
    const material = settings.materials.find(m => m.id === part.config.materialId)!
    const process = settings.processes.find(p => p.id === part.config.processId)!
    const post = settings.postProcesses.find(p => p.id === part.config.postProcessId)!
    const volume = part.analysis!.volumeCm3!
    const weight = volume * (part.config.densityOverride ?? material.density)
    const materialCents = cents(weight * (part.config.materialRateOverride ?? material.pricePerGram))
    const processingCents = cents(Math.max(process.setupFee, volume * process.pricePerCm3))
    const postCents = cents(post.pricePerPart)
    const unitCents = materialCents + processingCents + postCents
    const unitPriceCents = cents(yuan(unitCents) * (1 + settings.markupPercent / 100))
    const totalCents = unitPriceCents * part.quantity
    if (![materialCents, processingCents, postCents, unitCents, unitPriceCents, totalCents, unitCents * part.quantity].every(safeCents) || !Number.isFinite(weight * part.quantity)) {
      return { ...line, reason: '数值超过可安全计算范围，请检查尺寸、密度和价格' }
    }
    return { ...line, eligible: true, weightG: weight, materialCost: yuan(materialCents), processingCost: yuan(processingCents), postCost: yuan(postCents), unitCost: yuan(unitCents), unitPrice: yuan(unitPriceCents), lineTotal: yuan(totalCents) }
  })
  const included = lines.filter(l => l.eligible)
  const sum = (key: 'materialCost' | 'processingCost' | 'postCost' | 'unitCost') => included.reduce((acc, l) => acc + cents(l[key]) * l.quantity, 0)
  const base = sum('unitCost')
  const subtotal = included.reduce((acc, l) => acc + cents(l.lineTotal), 0)
  const discount = included.length ? cents(yuan(subtotal) * settings.discountPercent / 100) : 0
  const net = subtotal - discount
  const tax = included.length ? cents(yuan(net) * settings.taxPercent / 100) : 0
  const shipping = included.length ? cents(settings.shipping) : 0
  const total = net + tax + shipping
  if (![base, subtotal, discount, net, tax, shipping, total].every(safeCents)) {
    return { ...emptyQuote(), lines: lines.map(l => ({ ...l, eligible: false, reason: '项目汇总金额超过可安全计算范围', lineTotal: 0 })), excludedCount: lines.length }
  }
  return {
    lines, includedCount: included.length, excludedCount: parts.length - included.length,
    totalQuantity: included.reduce((n, l) => n + l.quantity, 0),
    totalWeightG: Number(included.reduce((n, l) => n + l.weightG! * l.quantity, 0).toPrecision(12)),
    materialCost: yuan(sum('materialCost')), processingCost: yuan(sum('processingCost')), postCost: yuan(sum('postCost')),
    baseCost: yuan(base), markupAmount: yuan(subtotal - base), subtotal: yuan(subtotal), discountAmount: yuan(discount), net: yuan(net), taxAmount: yuan(tax), shipping: yuan(shipping), total: yuan(total),
  }
}

function emptyQuote(): Quote {
  return { lines: [], includedCount: 0, excludedCount: 0, totalQuantity: 0, totalWeightG: 0, materialCost: 0, processingCost: 0, postCost: 0, baseCost: 0, markupAmount: 0, subtotal: 0, discountAmount: 0, net: 0, taxAmount: 0, shipping: 0, total: 0 }
}
