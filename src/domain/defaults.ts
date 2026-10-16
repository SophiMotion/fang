import type { Project, Settings } from '../types'

/** All prices below are editable examples, not market quotations. */
export const DEFAULT_SETTINGS: Settings = {
  materials: [
    { id: 'pla', name: 'PLA', density: 1.24, pricePerGram: 0.18, processIds: ['fdm'] },
    { id: 'abs', name: 'ABS', density: 1.04, pricePerGram: 0.22, processIds: ['fdm'] },
    { id: 'resin', name: '标准光敏树脂', density: 1.1, pricePerGram: 0.35, processIds: ['sla'] },
    { id: 'nylon', name: '尼龙 PA12', density: 1.01, pricePerGram: 0.65, processIds: ['sls', 'fdm'] },
    { id: 'aluminum', name: '铝合金', density: 2.7, pricePerGram: 1.2, processIds: ['slm'] },
    { id: 'steel', name: '不锈钢', density: 7.9, pricePerGram: 0.8, processIds: ['slm'] },
  ],
  processes: [
    { id: 'fdm', name: 'FDM 熔融沉积', pricePerCm3: 0.8, setupFee: 12, minWallMm: 1.2, maxSizeMm: [256, 256, 256] },
    { id: 'sla', name: 'SLA 光固化', pricePerCm3: 1.5, setupFee: 20, minWallMm: 0.8, maxSizeMm: [200, 200, 250] },
    { id: 'sls', name: 'SLS 尼龙烧结', pricePerCm3: 2.4, setupFee: 35, minWallMm: 1, maxSizeMm: [300, 300, 300] },
    { id: 'slm', name: 'SLM 金属熔融', pricePerCm3: 18, setupFee: 100, minWallMm: 1.5, maxSizeMm: [250, 250, 300] },
  ],
  postProcesses: [
    { id: 'none', name: '无后处理', pricePerPart: 0, processIds: ['fdm', 'sla', 'sls', 'slm'] },
    { id: 'polish', name: '打磨', pricePerPart: 6, processIds: ['fdm', 'sla', 'sls', 'slm'] },
    { id: 'paint', name: '喷漆', pricePerPart: 15, processIds: ['fdm', 'sla', 'sls', 'slm'] },
    { id: 'sandblast', name: '喷砂', pricePerPart: 10, processIds: ['sls', 'slm'] },
    { id: 'heat', name: '热处理', pricePerPart: 35, processIds: ['slm'] },
  ],
  rules: [
    ...(['fdm', 'sla', 'sls', 'slm'] as const).map((processId, index) => ({
      id: `wall-${processId}`, name: `${processId.toUpperCase()} 薄壁筛查`, enabled: true,
      metric: 'wallThickness' as const, operator: 'lt' as const, threshold: [1.2, 0.8, 1, 1.5][index],
      severity: 'high' as const, processId, materialId: 'all',
      suggestion: '复核局部薄壁、加强筋和打印方向；根据供应商验证结果调整规则阈值。',
    })),
    { id: 'thin-area', name: '薄壁采样占比较高', enabled: true, metric: 'thinArea', operator: 'gt', threshold: 15, severity: 'medium', processId: 'all', materialId: 'all', suggestion: '检查热图标记区域。此占比为采样筛查值，不是连续表面的精确面积积分。' },
    { id: 'overhang-fdm', name: '悬垂与支撑筛查', enabled: true, metric: 'overhang', operator: 'gt', threshold: 25, severity: 'medium', processId: 'fdm', materialId: 'all', suggestion: '尝试调整打印方向并由切片软件核对支撑。悬垂比例不是失败概率。' },
    { id: 'geometry-anomalies', name: '网格几何异常', enabled: true, metric: 'geometry', operator: 'gt', threshold: 0, severity: 'high', processId: 'all', materialId: 'all', suggestion: '修复开放边、非流形、退化三角形或朝向冲突后重新导入。' },
    { id: 'large-part', name: '大尺寸零件复核', enabled: true, metric: 'maxDimension', operator: 'gt', threshold: 200, severity: 'low', processId: 'all', materialId: 'all', suggestion: '确认设备尺寸、收缩变形、摆放方向及包装运输方式。' },
  ],
  markupPercent: 25, discountPercent: 0, taxPercent: 0, shipping: 0, currency: 'CNY',
  sellerName: 'SophiMotion', sellerContact: '',
}

export function createProject(): Project {
  const now = new Date()
  const date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
  const id = crypto.randomUUID()
  return {
    schema: 'printquote-v1', id, name: '未命名报价项目',
    customer: { name: '', company: '', contact: '', quoteNumber: `QT-${date.replaceAll('-', '')}-${id.slice(0, 6).toUpperCase()}`, date, validDays: 15, notes: '' },
    parts: [], settings: structuredClone(DEFAULT_SETTINGS), createdAt: now.toISOString(), updatedAt: now.toISOString(), isDemo: false,
  }
}
