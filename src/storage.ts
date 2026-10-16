import type { Customer, GeometryAnalysis, Part, Project, ProjectSummary, Settings, ThicknessResult, Vec3 } from './types'

const DB_NAME = 'sophimotion-printquote'
const STORE = 'projects'
const MAX_BYTES = 100 * 1024 * 1024
const MAX_PARTS = 2000
const MAX_ITEMS = 10000
const MAX_VALUES = 25_000_000
type RecordValue = Record<string, unknown>

function invalid(path: string, detail: string): never { throw new Error(`项目数据无效：${path}${detail}`) }
function object(value: unknown, path: string): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value)) invalid(path, '必须为对象')
  const record = value as RecordValue
  for (const key of Object.keys(record)) if (['__proto__', 'prototype', 'constructor'].includes(key)) invalid(path, '包含不安全字段')
  return record
}
function str(value: unknown, path: string, max = 1000, allowEmpty = true): string {
  if (typeof value !== 'string' || value.length > max || (!allowEmpty && !value.trim()) || value.includes('\0')) invalid(path, '不是有效文本')
  return value
}
function id(value: unknown, path: string): string {
  const result = str(value, path, 200, false)
  if (/\s|[<>"'\\/]/.test(result)) invalid(path, '不是有效标识符')
  return result
}
function num(value: unknown, path: string, min = 0, max = 1e15, integer = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isSafeInteger(value))) invalid(path, '超出有效数值范围')
  return value
}
function nullable(value: unknown, path: string, min = 0, max = 1e15): number | null { return value === null ? null : num(value, path, min, max) }
function bool(value: unknown, path: string): boolean { if (typeof value !== 'boolean') invalid(path, '必须为布尔值'); return value }
function oneOf<T extends string>(value: unknown, path: string, values: readonly T[]): T {
  if (typeof value !== 'string' || !values.includes(value as T)) invalid(path, '不是支持的选项')
  return value as T
}
function array(value: unknown, path: string, max = MAX_ITEMS): unknown[] {
  if (!Array.isArray(value) || value.length > max) invalid(path, '不是有效列表或超过数量限制')
  return value
}
function unique<T extends { id: string }>(items: T[], path: string): T[] {
  if (new Set(items.map(item => item.id)).size !== items.length) invalid(path, '存在重复标识符')
  return items
}
function vec(value: unknown, path: string): Vec3 {
  const values = array(value, path, 3)
  if (values.length !== 3) invalid(path, '必须包含三个尺寸')
  return values.map((n, i) => num(n, `${path}[${i}]`, 0, 1e9)) as Vec3
}
function date(value: unknown, path: string, short = false): string {
  const result = str(value, path, 50, false)
  if (!(short ? /^\d{4}-\d{2}-\d{2}$/ : /^\d{4}-\d{2}-\d{2}T/).test(result) || !Number.isFinite(Date.parse(result))) invalid(path, '不是有效日期')
  return result
}
function stringList(value: unknown, path: string): string[] { return array(value, path, 1000).map((item, i) => str(item, `${path}[${i}]`, 1000)) }

// A shared byte budget prevents a small object with many arrays from allocating unbounded memory.
interface Budget { bytes: number }
function numericArray(value: unknown, path: string, budget: Budget, indices = false): Float32Array | Uint32Array {
  if (!Array.isArray(value) && !(value instanceof Float32Array) && !(value instanceof Uint32Array)) invalid(path, '必须为数值数组')
  const source = value as ArrayLike<number>
  if (source.length > MAX_VALUES || (budget.bytes += source.length * 4) > MAX_BYTES) invalid(path, '网格数据超过 100 MB 限制')
  for (let i = 0; i < source.length; i++) num(source[i], `${path}[${i}]`, indices ? 0 : -1e9, indices ? 0xffffffff : 1e9, indices)
  return indices ? Uint32Array.from(source) : Float32Array.from(source)
}
function customer(value: unknown): Customer {
  const v = object(value, '客户')
  return { name: str(v.name, '客户姓名', 500), company: str(v.company, '客户公司', 500), contact: str(v.contact, '联系人', 1000), quoteNumber: str(v.quoteNumber, '报价编号', 200), date: date(v.date, '报价日期', true), validDays: num(v.validDays, '有效期', 1, 3650, true), notes: str(v.notes, '备注', 20000) }
}
function settings(value: unknown): Settings {
  const v = object(value, '价格设置')
  const processes = unique(array(v.processes, '工艺', 1000).map((item, i) => {
    const p = object(item, `工艺${i}`)
    return { id: id(p.id, '工艺ID'), name: str(p.name, '工艺名称', 200, false), pricePerCm3: num(p.pricePerCm3, '加工单价', 0, 1e9), setupFee: num(p.setupFee, '起步费', 0, 1e9), minWallMm: num(p.minWallMm, '最小壁厚', 0, 1e6), maxSizeMm: vec(p.maxSizeMm, '设备尺寸') }
  }), '工艺')
  const materials = unique(array(v.materials, '材料', 1000).map((item, i) => {
    const m = object(item, `材料${i}`)
    return { id: id(m.id, '材料ID'), name: str(m.name, '材料名称', 200, false), density: num(m.density, '密度', 0.000001, 1e6), pricePerGram: num(m.pricePerGram, '材料单价', 0, 1e9), processIds: stringList(m.processIds, '材料适用工艺') }
  }), '材料')
  const postProcesses = unique(array(v.postProcesses, '后处理', 1000).map((item, i) => {
    const p = object(item, `后处理${i}`)
    return { id: id(p.id, '后处理ID'), name: str(p.name, '后处理名称', 200, false), pricePerPart: num(p.pricePerPart, '后处理单价', 0, 1e9), processIds: stringList(p.processIds, '后处理适用工艺') }
  }), '后处理')
  const rules = unique(array(v.rules, '风险规则', 2000).map((item, i) => {
    const r = object(item, `风险规则${i}`)
    return { id: id(r.id, '规则ID'), name: str(r.name, '规则名称', 200, false), enabled: bool(r.enabled, '规则状态'), metric: oneOf(r.metric, '规则指标', ['wallThickness', 'thinArea', 'maxDimension', 'overhang', 'geometry'] as const), operator: oneOf(r.operator, '比较关系', ['lt', 'gt'] as const), threshold: num(r.threshold, '规则阈值', 0, 1e9), severity: oneOf(r.severity, '严重度', ['high', 'medium', 'low'] as const), processId: str(r.processId, '规则工艺', 200), materialId: str(r.materialId, '规则材料', 200), suggestion: str(r.suggestion, '规则建议', 4000) }
  }), '风险规则')
  return { materials, processes, postProcesses, rules, markupPercent: num(v.markupPercent, '成本加价', 0, 10000), discountPercent: num(v.discountPercent, '折扣', 0, 100), taxPercent: num(v.taxPercent, '税率', 0, 100), shipping: num(v.shipping, '运费', 0, 1e9), currency: oneOf(v.currency, '币种', ['CNY'] as const), sellerName: str(v.sellerName, '供应方名称', 500), sellerContact: str(v.sellerContact, '供应方联系方式', 1000) }
}
function analysis(value: unknown): GeometryAnalysis {
  const a = object(value, '几何分析')
  return { volumeCm3: nullable(a.volumeCm3, '体积'), surfaceAreaCm2: num(a.surfaceAreaCm2, '表面积'), dimensionsMm: vec(a.dimensionsMm, '尺寸'), triangleCount: num(a.triangleCount, '三角面数量', 0, MAX_VALUES, true), boundaryEdges: num(a.boundaryEdges, '边界边', 0, MAX_VALUES * 3, true), nonManifoldEdges: num(a.nonManifoldEdges, '非流形边', 0, MAX_VALUES * 3, true), degenerateTriangles: num(a.degenerateTriangles, '退化三角面', 0, MAX_VALUES, true), inconsistentEdges: num(a.inconsistentEdges, '不一致边', 0, MAX_VALUES * 3, true), valid: bool(a.valid, '网格有效性'), warnings: stringList(a.warnings, '几何警告'), overhangPercent: num(a.overhangPercent, '悬垂比例', 0, 100) }
}
function thickness(value: unknown, budget: Budget): ThicknessResult {
  const t = object(value, '壁厚分析')
  const points = numericArray(t.points, '壁厚采样点', budget) as Float32Array
  // JSON null is an explicit unknown sample, represented by -1 in the typed array.
  const values = numericArray(Array.isArray(t.values) ? t.values.map(v => v === null ? -1 : v) : t.values, '壁厚采样值', budget) as Float32Array
  if (points.length !== values.length * 3) invalid('壁厚采样', '坐标和值数量不一致')
  const validSamples = num(t.validSamples, '有效采样数', 0, MAX_VALUES, true)
  const totalSamples = num(t.totalSamples, '总采样数', 0, MAX_VALUES, true)
  if (validSamples > totalSamples || values.length !== totalSamples) invalid('壁厚采样', '采样数量不一致')
  return { minMm: nullable(t.minMm, '最小采样厚度'), p10Mm: nullable(t.p10Mm, '采样10分位'), medianMm: nullable(t.medianMm, '采样中位数'), thinAreaPercent: nullable(t.thinAreaPercent, '薄壁比例', 0, 100), validSamples, totalSamples, thresholdMm: num(t.thresholdMm, '壁厚阈值', 0, 1e6), points, values }
}
function part(value: unknown, budget: Budget): Part {
  const p = object(value, '零件')
  const c = object(p.config, '零件配置')
  const result: Part = { id: id(p.id, '零件ID'), name: str(p.name, '零件名称', 1000, false), fileName: str(p.fileName, '文件名', 2000), format: str(p.format, '格式', 30), color: str(p.color, '零件颜色', 30), quantity: num(p.quantity, '零件数量', 1, 1000000, true), unit: oneOf(p.unit, '单位', ['mm', 'cm', 'm', 'inch'] as const), status: oneOf(p.status, '零件状态', ['ready', 'invalid', 'pending', 'error'] as const), visible: bool(p.visible, '零件显示状态'), config: { materialId: id(c.materialId, '材料ID'), processId: id(c.processId, '工艺ID'), postProcessId: id(c.postProcessId, '后处理ID') } }
  if (!/^#[0-9a-f]{6}$/i.test(result.color)) invalid('零件颜色', '必须为六位十六进制颜色')
  if (c.densityOverride !== undefined) result.config.densityOverride = num(c.densityOverride, '覆盖密度', 0.000001, 1e6)
  if (c.materialRateOverride !== undefined) result.config.materialRateOverride = num(c.materialRateOverride, '覆盖材料价', 0, 1e9)
  if (p.message !== undefined) result.message = str(p.message, '状态说明', 10000)
  if (p.geometry !== undefined) {
    const g = object(p.geometry, '网格')
    const positions = numericArray(g.positions, '顶点', budget) as Float32Array
    if (positions.length < 9 || positions.length % 3 !== 0) invalid('顶点', '长度必须为三的倍数且至少包含一个三角面')
    result.geometry = { positions }
    if (g.indices !== undefined) {
      const indices = numericArray(g.indices, '面索引', budget, true) as Uint32Array
      if (indices.length < 3 || indices.length % 3 !== 0) invalid('面索引', '长度必须为三的倍数')
      for (const index of indices) if (index >= positions.length / 3) invalid('面索引', '引用了不存在的顶点')
      result.geometry.indices = indices
    } else if (positions.length % 9 !== 0) invalid('未索引网格', '必须包含完整三角面')
  }
  if (p.analysis !== undefined) result.analysis = analysis(p.analysis)
  if (p.thickness !== undefined) result.thickness = thickness(p.thickness, budget)
  if (result.status === 'ready' && (!result.geometry || !result.analysis || !result.analysis.valid || result.analysis.volumeCm3 === null)) invalid('已完成零件', '缺少有效网格和分析')
  if (result.thickness && !result.geometry) invalid('壁厚分析', '缺少对应网格')
  return result
}
function validateProject(value: unknown): Project {
  const p = object(value, '项目')
  const budget: Budget = { bytes: 0 }
  return { schema: oneOf(p.schema, '备份版本', ['printquote-v1'] as const), id: id(p.id, '项目ID'), name: str(p.name, '项目名称', 1000, false), customer: customer(p.customer), parts: unique(array(p.parts, '零件', MAX_PARTS).map(value => part(value, budget)), '零件'), settings: settings(p.settings), createdAt: date(p.createdAt, '创建时间'), updatedAt: date(p.updatedAt, '更新时间'), isDemo: bool(p.isDemo, '示例状态') }
}
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('当前浏览器不支持本机项目数据库，请使用项目备份。')); return }
    const request = indexedDB.open(DB_NAME, 1)
    let blocked = false
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: 'id' }) }
    request.onerror = () => reject(new Error(`无法打开本机项目数据库：${request.error?.message ?? '未知错误'}`))
    request.onblocked = () => { blocked = true; reject(new Error('项目数据库被其他页面占用，请关闭旧页面后重试。')) }
    request.onsuccess = () => { const db = request.result; if (blocked) { db.close(); return }; db.onversionchange = () => db.close(); resolve(db) }
  })
}
async function transaction<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    let tx: IDBTransaction
    let request: IDBRequest<T>
    try { tx = db.transaction(STORE, mode); request = operation(tx.objectStore(STORE)) }
    catch (error) { db.close(); reject(error); return }
    tx.oncomplete = () => { db.close(); resolve(request.result) }
    tx.onabort = tx.onerror = () => { db.close(); reject(new Error(`本机项目${mode === 'readwrite' ? '保存' : '读取'}失败：${tx.error?.message ?? request.error?.message ?? '数据库事务未完成'}`)) }
  })
}
export async function saveProject(project: Project): Promise<void> {
  const validated = validateProject(project)
  await transaction('readwrite', store => store.put(validated))
}
export async function loadProject(projectId: string): Promise<Project | undefined> {
  const result = await transaction('readonly', store => store.get(id(projectId, '项目ID')))
  return result === undefined ? undefined : validateProject(result)
}
export async function listProjects(): Promise<ProjectSummary[]> {
  const stored = await transaction('readonly', store => store.getAll())
  return stored.map(value => {
    const p = validateProject(value)
    return { id: p.id, name: p.name, customer: p.customer, updatedAt: p.updatedAt, isDemo: p.isDemo, partCount: p.parts.length }
  }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}
export async function deleteProject(projectId: string): Promise<void> { await transaction('readwrite', store => store.delete(id(projectId, '项目ID'))) }
export function downloadProject(project: Project): void {
  const validated = validateProject(project)
  const json = JSON.stringify(validated, (_key, value) => ArrayBuffer.isView(value) ? Array.from(value as unknown as ArrayLike<number>) : value)
  const blob = new Blob([json], { type: 'application/json;charset=utf-8' })
  if (blob.size > MAX_BYTES) throw new Error('项目备份超过 100 MB，请减少模型数量或拆分项目。')
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${validated.name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 100)}.printquote.json`
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export async function importProjectFile(file: File): Promise<Project> {
  if (file.size > MAX_BYTES) throw new Error('备份文件超过 100 MB，无法导入。')
  let parsed: unknown
  try { parsed = JSON.parse(await file.text()) } catch { throw new Error('无法读取项目备份：文件不是有效 JSON。') }
  // Import is deliberately read-only: a rejected backup cannot overwrite an existing project.
  const project = validateProject(parsed)
  const { analyzeGeometry } = await import('./geometry/analysis')
  for (const part of project.parts) {
    const suppliedThickness = part.thickness !== undefined
    delete part.thickness
    if (part.geometry) {
      // Geometry is the evidence; cached volume, dimensions and valid flags are untrusted.
      part.analysis = analyzeGeometry(part.geometry)
      part.status = part.analysis.valid && part.analysis.volumeCm3 !== null ? 'ready' : 'invalid'
      const geometryMessage = part.analysis.valid ? '' : part.analysis.warnings.join(' ')
      part.message = [geometryMessage, suppliedThickness ? '备份内的壁厚结果已清除，请重新执行壁厚检测。' : ''].filter(Boolean).join(' ') || undefined
    } else {
      // Never retain detached analysis results for a pending / unavailable mesh.
      delete part.analysis
    }
  }
  return project
}
