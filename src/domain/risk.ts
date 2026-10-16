import type { Part, RiskMetric, RiskResult, Settings } from '../types'
import { partConfigurationError, settingsError } from './quote'

type Evidence = { value: number | null; detail: string }
const finite = (value: number | null | undefined): value is number => typeof value === 'number' && Number.isFinite(value)
const fmt = (value: number) => Number(value.toFixed(3)).toString()
const validDimensions = (dims: number[] | undefined): dims is number[] => !!dims && dims.length === 3 && dims.every(v => finite(v) && v > 0)
const scopeMatches = (scope: string, selected: string) => !scope || scope === 'all' || scope === '*' || scope === selected

function evidence(part: Part, metric: RiskMetric, settings: Settings): Evidence {
  const a = part.analysis, t = part.thickness
  if (!a || part.status === 'pending' || part.status === 'error') return { value: null, detail: '尚未取得可用的几何分析' }
  if (metric === 'geometry') {
    const counts = [a.boundaryEdges, a.nonManifoldEdges, a.degenerateTriangles, a.inconsistentEdges]
    if (counts.some(v => !Number.isSafeInteger(v) || v < 0)) return { value: null, detail: '网格异常计数无效，需重新分析' }
    return { value: counts.reduce((n, v) => n + v, 0), detail: `开放边 ${a.boundaryEdges}、非流形边 ${a.nonManifoldEdges}、退化三角形 ${a.degenerateTriangles}、朝向冲突边 ${a.inconsistentEdges}（异常数量求和）` }
  }
  if (metric === 'maxDimension') return validDimensions(a.dimensionsMm) ? { value: Math.max(...a.dimensionsMm), detail: `轴向尺寸 ${a.dimensionsMm.map(fmt).join(' × ')} mm；指标为最大轴长 mm` } : { value: null, detail: '尺寸数据不可用' }
  if (metric === 'overhang') return finite(a.overhangPercent) && a.overhangPercent >= 0 && a.overhangPercent <= 100 ? { value: a.overhangPercent, detail: `当前姿态的悬垂筛查占比 ${fmt(a.overhangPercent)}%；需由切片软件确认支撑` } : { value: null, detail: '悬垂数据不可用' }
  if (!a.valid || part.status !== 'ready') return { value: null, detail: '网格未通过有效性检查，壁厚结果不可作为可靠依据' }
  if (!t || t.validSamples < 5 || t.totalSamples < t.validSamples || t.totalSamples <= 0 || t.validSamples / t.totalSamples < 0.2) return { value: null, detail: t ? `有效壁厚样本不足（${t.validSamples}/${t.totalSamples}），需重新分析或复核模型` : '尚未运行壁厚采样；未知不代表通过' }
  if (metric === 'wallThickness') {
    if (!finite(t.p10Mm) || !finite(t.minMm) || t.p10Mm <= 0 || t.minMm <= 0) return { value: null, detail: '壁厚采样没有有效的厚度统计' }
    return { value: t.p10Mm, detail: `采样壁厚 P10 ${fmt(t.p10Mm)} mm；最低采样值 ${fmt(t.minMm)} mm；命中 ${t.validSamples}/${t.totalSamples}。P10 为第 10 百分位数，非全局最小壁厚` }
  }
  const process = settings.processes.find(p => p.id === part.config.processId)
  if (!process || Math.abs(t.thresholdMm - process.minWallMm) > 1e-6) return { value: null, detail: `薄壁占比使用的阈值 ${fmt(t.thresholdMm)} mm 与当前工艺推荐壁厚不一致，请重新运行壁厚分析` }
  if (!finite(t.thinAreaPercent) || t.thinAreaPercent < 0 || t.thinAreaPercent > 100) return { value: null, detail: '薄壁采样占比不可用' }
  return { value: t.thinAreaPercent, detail: `厚度低于 ${fmt(t.thresholdMm)} mm 的采样占比 ${fmt(t.thinAreaPercent)}%；并非精确表面积比例` }
}

export function evaluateRisks(parts: Part[], settings: Settings): RiskResult[] {
  const results: RiskResult[] = []
  for (const part of parts) {
    const pushBuiltin = (ruleId: string, ruleName: string, status: 'triggered' | 'unknown', message: string, suggestion: string, value: number | null = null, threshold = 0) => results.push({ id: `${part.id}:${ruleId}`, partId: part.id, partName: part.name, ruleId, ruleName, severity: status === 'triggered' ? 'high' : 'medium', status, value, threshold, message, suggestion })
    const configError = settingsError(settings) || partConfigurationError(part, settings)
    if (configError) pushBuiltin('builtin-configuration', '报价配置检查', 'triggered', configError, '修正配置后重新确认报价。')
    if (part.status !== 'ready' || !part.analysis?.valid) pushBuiltin('builtin-geometry-status', '模型有效性检查', part.status === 'invalid' ? 'triggered' : 'unknown', part.message || '模型尚未通过完整的有效性检查，当前不作为正式报价依据。', '完成转换、补齐附件或修复网格后重新导入。')

    const process = settings.processes.find(p => p.id === part.config.processId)
    const dimensions = part.analysis?.dimensionsMm
    if (!process || !validDimensions(process.maxSizeMm) || !validDimensions(dimensions)) {
      pushBuiltin('builtin-build-size', '设备成型范围', 'unknown', '模型尺寸或当前工艺设备成型范围不可用。', '补全设备三轴尺寸并完成几何解析。')
    } else {
      const exceeded = [0, 1, 2].filter(i => dimensions[i] > process.maxSizeMm[i])
      const axes = exceeded.map(i => ['X', 'Y', 'Z'][i])
      if (axes.length) pushBuiltin('builtin-build-size', '设备成型范围', 'triggered', `当前模型 ${dimensions.map(fmt).join(' × ')} mm，设备 ${process.maxSizeMm.map(fmt).join(' × ')} mm；${axes.join(' / ')} 轴超界。`, '按当前模型姿态比较三轴，未自动搜索最优摆放；请在切片软件确认旋转、拆件及边界余量。', dimensions[exceeded[0]], process.maxSizeMm[exceeded[0]])
    }
    for (const rule of settings.rules) {
      if (!rule.enabled || !scopeMatches(rule.processId, part.config.processId) || !scopeMatches(rule.materialId, part.config.materialId)) continue
      let e: Evidence
      if (!finite(rule.threshold) || rule.threshold < 0 || !['lt', 'gt'].includes(rule.operator) || !['wallThickness', 'thinArea', 'maxDimension', 'overhang', 'geometry'].includes(rule.metric)) e = { value: null, detail: '规则阈值、指标或比较关系无效，请编辑规则' }
      else e = evidence(part, rule.metric, settings)
      const triggered = e.value !== null && (rule.operator === 'lt' ? e.value < rule.threshold : e.value > rule.threshold)
      if (e.value === null || triggered) results.push({ id: `${part.id}:${rule.id}`, partId: part.id, partName: part.name, ruleId: rule.id, ruleName: rule.name, severity: rule.severity, status: e.value === null ? 'unknown' : 'triggered', value: e.value, threshold: rule.threshold, message: e.detail, suggestion: rule.suggestion })
    }
  }
  return results
}
