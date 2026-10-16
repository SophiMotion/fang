export type Unit = 'mm' | 'cm' | 'm' | 'inch'
export type Vec3 = [number, number, number]
export type GeometryData = { positions: Float32Array; indices?: Uint32Array }
export interface GeometryAnalysis {
  volumeCm3: number | null
  surfaceAreaCm2: number
  dimensionsMm: Vec3
  triangleCount: number
  boundaryEdges: number
  nonManifoldEdges: number
  degenerateTriangles: number
  inconsistentEdges: number
  valid: boolean
  warnings: string[]
  overhangPercent: number
}
export interface ThicknessResult {
  minMm: number | null
  p10Mm: number | null
  medianMm: number | null
  thinAreaPercent: number | null
  validSamples: number
  totalSamples: number
  thresholdMm: number
  points: Float32Array
  values: Float32Array
}
export interface PartConfig {
  materialId: string
  processId: string
  postProcessId: string
  densityOverride?: number
  materialRateOverride?: number
}
export interface Part {
  id: string
  name: string
  fileName: string
  format: string
  color: string
  quantity: number
  unit: Unit
  geometry?: GeometryData
  analysis?: GeometryAnalysis
  thickness?: ThicknessResult
  status: 'ready' | 'invalid' | 'pending' | 'error'
  message?: string
  config: PartConfig
  visible: boolean
}
export interface Material {
  id: string
  name: string
  density: number
  pricePerGram: number
  processIds: string[]
}
export interface Process {
  id: string
  name: string
  pricePerCm3: number
  setupFee: number
  minWallMm: number
  maxSizeMm: Vec3
}
export interface PostProcess {
  id: string
  name: string
  pricePerPart: number
  processIds: string[]
}
export type RiskMetric = 'wallThickness' | 'thinArea' | 'maxDimension' | 'overhang' | 'geometry'
export interface RiskRule {
  id: string
  name: string
  enabled: boolean
  metric: RiskMetric
  operator: 'lt' | 'gt'
  threshold: number
  severity: 'high' | 'medium' | 'low'
  processId: string
  materialId: string
  suggestion: string
}
export interface Settings {
  materials: Material[]
  processes: Process[]
  postProcesses: PostProcess[]
  rules: RiskRule[]
  markupPercent: number
  discountPercent: number
  taxPercent: number
  shipping: number
  currency: 'CNY'
  sellerName: string
  sellerContact: string
}
export interface Customer {
  name: string
  company: string
  contact: string
  quoteNumber: string
  date: string
  validDays: number
  notes: string
}
export interface Project {
  schema: 'printquote-v1'
  id: string
  name: string
  customer: Customer
  parts: Part[]
  settings: Settings
  createdAt: string
  updatedAt: string
  isDemo: boolean
}
export interface QuoteLine {
  partId: string
  eligible: boolean
  reason?: string
  volumeCm3: number | null
  weightG: number | null
  materialCost: number
  processingCost: number
  postCost: number
  unitCost: number
  unitPrice: number
  quantity: number
  lineTotal: number
}
export interface Quote {
  lines: QuoteLine[]
  includedCount: number
  excludedCount: number
  totalQuantity: number
  totalWeightG: number
  materialCost: number
  processingCost: number
  postCost: number
  baseCost: number
  markupAmount: number
  subtotal: number
  discountAmount: number
  net: number
  taxAmount: number
  shipping: number
  total: number
}
export interface RiskResult {
  id: string
  partId: string
  partName: string
  ruleId: string
  ruleName: string
  severity: 'high' | 'medium' | 'low'
  status: 'triggered' | 'unknown'
  value: number | null
  threshold: number
  message: string
  suggestion: string
}
export type ProjectSummary = Pick<Project, 'id' | 'name' | 'customer' | 'updatedAt' | 'isDemo'> & { partCount: number }
