import { importFilesDirect } from './importers'
import { analyzeThickness } from './thickness'
import type { GeometryData, Unit } from '../types'

type Request = { type: 'import'; files: File[]; unit: Unit } | { type: 'thickness'; geometry: GeometryData; thresholdMm: number; samples?: number }
self.onmessage = async (event: MessageEvent<Request>) => {
  try {
    const request = event.data
    const result = request.type === 'import'
      ? await importFilesDirect(request.files, request.unit, message => self.postMessage({ type: 'progress', message }), part => self.postMessage({ type: 'part', part }))
      : analyzeThickness(request.geometry, request.thresholdMm, request.samples)
    self.postMessage({ type: 'result', result })
  } catch (error) { self.postMessage({ type: 'error', message: error instanceof Error ? error.message : '几何分析失败。' }) }
}
