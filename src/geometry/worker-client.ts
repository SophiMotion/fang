import type { GeometryData, Part, ThicknessResult, Unit } from '../types'
import { importFilesDirect, failedPart } from './importers'
import { analyzeThickness } from './thickness'

function aborted(): DOMException { return new DOMException('操作已取消。', 'AbortError') }

export async function importFiles(files: File[], unit: Unit, onProgress?: (message: string) => void, signal?: AbortSignal): Promise<Part[]> {
  if (signal?.aborted) throw aborted()
  if (typeof Worker === 'undefined') {
    if (typeof window !== 'undefined' && files.some(f => f.size > 5 * 1024 * 1024)) throw new Error('当前浏览器不支持 Worker；大文件请使用新版 Chrome 或 Edge。')
    return importFilesDirect(files, unit, onProgress)
  }
  const worker = new Worker(new URL('./geometry.worker.ts', import.meta.url), { type: 'module' })
  return new Promise((resolve, reject) => {
    const completed: Part[] = []
    let timer: ReturnType<typeof setTimeout>
    const cleanup = () => { clearTimeout(timer); worker.terminate(); signal?.removeEventListener('abort', cancel) }
    const fail = (message: string) => { cleanup(); resolve([...completed, failedPart('未完成导入', unit, message)]) }
    const resetTimeout = () => { clearTimeout(timer); timer = setTimeout(() => fail('导入超过 90 秒，已终止该批次剩余任务。先前完成的部件已保留；请拆分文件或降低精度。'), 90_000) }
    const cancel = () => { cleanup(); reject(aborted()) }
    signal?.addEventListener('abort', cancel, { once: true })
    worker.onmessage = ({ data }: MessageEvent) => {
      if (data.type === 'progress') { resetTimeout(); onProgress?.(data.message) }
      else if (data.type === 'part') { completed.push(data.part); resetTimeout() }
      else if (data.type === 'result') { cleanup(); resolve(data.result) }
      else if (data.type === 'error') fail(data.message)
    }
    worker.onerror = event => fail(`解析 Worker 失败：${event.message || '资源无法加载，请刷新后重试。'}`)
    resetTimeout(); worker.postMessage({ type: 'import', files, unit })
  })
}

export async function analyzeThicknessAsync(geometry: GeometryData, thresholdMm: number, samples = 1500, signal?: AbortSignal): Promise<ThicknessResult> {
  if (signal?.aborted) throw aborted()
  if (typeof Worker === 'undefined') return analyzeThickness(geometry, thresholdMm, samples)
  const worker = new Worker(new URL('./geometry.worker.ts', import.meta.url), { type: 'module' })
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); worker.terminate(); signal?.removeEventListener('abort', cancel) }
    const cancel = () => { cleanup(); reject(aborted()) }
    const timer = setTimeout(() => { cleanup(); reject(new Error('壁厚筛查超过 45 秒，请降低模型精度后重试。')) }, 45_000)
    signal?.addEventListener('abort', cancel, { once: true })
    worker.onmessage = ({ data }: MessageEvent) => { if (data.type === 'result') { cleanup(); resolve(data.result) } else if (data.type === 'error') { cleanup(); reject(new Error(data.message)) } }
    worker.onerror = event => { cleanup(); reject(new Error(`壁厚 Worker 失败：${event.message}`)) }
    // Structured clone preserves the original arrays owned by the project/viewer.
    worker.postMessage({ type: 'thickness', geometry, thresholdMm, samples })
  })
}
