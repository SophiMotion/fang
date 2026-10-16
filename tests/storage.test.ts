import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { deleteProject, importProjectFile, listProjects, loadProject, saveProject } from '../src/storage'
import type { Project } from '../src/types'

function sampleProject(): Project {
  return {
    schema: 'printquote-v1', id: 'project-1', name: '本地恢复测试', createdAt: '2026-10-16T08:00:00.000Z', updatedAt: '2026-10-16T08:00:00.000Z', isDemo: false,
    customer: { name: '王工', company: '苏州智造', contact: '123', quoteNumber: 'QT-001', date: '2026-10-16', validDays: 15, notes: '保留中文与换行\n第二行' },
    settings: {
      materials: [{ id: 'pla', name: 'PLA', density: 1.24, pricePerGram: .3, processIds: ['fdm'] }],
      processes: [{ id: 'fdm', name: 'FDM', pricePerCm3: .5, setupFee: 20, minWallMm: .8, maxSizeMm: [220, 220, 250] }],
      postProcesses: [{ id: 'none', name: '无', pricePerPart: 0, processIds: ['fdm'] }],
      rules: [{ id: 'wall', name: '薄壁', enabled: true, metric: 'wallThickness', operator: 'lt', threshold: .8, severity: 'high', processId: 'all', materialId: 'all', suggestion: '复核薄壁' }],
      markupPercent: 20, discountPercent: 0, taxPercent: 0, shipping: 0, currency: 'CNY', sellerName: '', sellerContact: '',
    },
    parts: [{
      id: 'part-1', name: '四面体', fileName: 'tetra.stl', format: 'STL', color: '#4285f4', quantity: 2, unit: 'mm', visible: true, status: 'ready',
      config: { materialId: 'pla', processId: 'fdm', postProcessId: 'none' },
      geometry: { positions: new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0, 0, 0, 10]), indices: new Uint32Array([0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3]) },
      analysis: { volumeCm3: 1 / 6, surfaceAreaCm2: 2.366, dimensionsMm: [10, 10, 10], triangleCount: 4, boundaryEdges: 0, nonManifoldEdges: 0, degenerateTriangles: 0, inconsistentEdges: 0, valid: true, warnings: [], overhangPercent: 25 },
      thickness: { minMm: 2, p10Mm: 2, medianMm: 2, thinAreaPercent: 0, validSamples: 1, totalSamples: 2, thresholdMm: .8, points: new Float32Array([1, 1, 0, 3, 3, 3]), values: new Float32Array([2, -1]) },
    }],
  }
}
function json(project: unknown): string { return JSON.stringify(project, (_key, value) => ArrayBuffer.isView(value) ? Array.from(value as unknown as ArrayLike<number>) : value) }
function file(value: unknown) { return new File([json(value)], 'backup.printquote.json', { type: 'application/json' }) }
function editable(): any { return JSON.parse(json(sampleProject())) }

beforeEach(() => { vi.stubGlobal('indexedDB', new IDBFactory()) })

describe('local project store', () => {
  it('restores independent typed arrays, metadata, visibility and Chinese text after a database reopen', async () => {
    const project = sampleProject()
    project.parts[0].visible = false
    await saveProject(project)
    project.parts[0].geometry!.positions[0] = 999
    const restored = await loadProject(project.id)
    expect(restored!.parts[0].geometry!.positions).toBeInstanceOf(Float32Array)
    expect(restored!.parts[0].geometry!.indices).toBeInstanceOf(Uint32Array)
    expect(restored!.parts[0].thickness!.points).toBeInstanceOf(Float32Array)
    expect(restored!.parts[0].thickness!.values).toEqual(new Float32Array([2, -1]))
    expect(restored!.parts[0].geometry!.positions[0]).toBe(0)
    expect(restored!.parts[0].visible).toBe(false)
    expect(restored!.customer.notes).toBe('保留中文与换行\n第二行')
    expect(await listProjects()).toEqual([{ id: project.id, name: project.name, customer: project.customer, updatedAt: project.updatedAt, isDemo: false, partCount: 1 }])
    await deleteProject(project.id)
    expect(await loadProject(project.id)).toBeUndefined()
    expect(await listProjects()).toEqual([])
  })
  it('does not overwrite a stored project when a backup or save is rejected', async () => {
    const project = sampleProject()
    await saveProject(project)
    const malformed = editable()
    malformed.name = '不应写入'
    malformed.parts[0].geometry.indices[0] = 200
    await expect(importProjectFile(file(malformed))).rejects.toThrow('不存在的顶点')
    project.settings.shipping = -1
    await expect(saveProject(project)).rejects.toThrow('运费')
    expect((await loadProject(project.id))!.name).toBe('本地恢复测试')
    expect((await loadProject(project.id))!.settings.shipping).toBe(0)
  })
  it('keeps valid backups read-only until explicitly saved, reconstructing geometry arrays and clearing cached wall samples', async () => {
    const backup = editable()
    backup.parts[0].thickness.values[1] = null
    const imported = await importProjectFile(file(backup))
    expect(imported.parts[0].geometry!.positions).toBeInstanceOf(Float32Array)
    expect(imported.parts[0].geometry!.indices).toBeInstanceOf(Uint32Array)
    expect(imported.parts[0].thickness).toBeUndefined()
    expect(imported.parts[0].message).toContain('重新执行壁厚检测')
    expect(await listProjects()).toEqual([])
    await saveProject(imported)
    expect(await loadProject(imported.id)).toEqual(imported)
  })
})

describe('untrusted backup validation', () => {
  it('recomputes a tampered volume and dimensions from source geometry', async () => {
    const backup = editable()
    backup.parts[0].analysis.volumeCm3 = 1000
    backup.parts[0].analysis.dimensionsMm = [999, 999, 999]
    const imported = await importProjectFile(file(backup))
    expect(imported.parts[0].analysis!.volumeCm3).toBeCloseTo(1 / 6)
    expect(imported.parts[0].analysis!.dimensionsMm).toEqual([10, 10, 10])
    expect(imported.parts[0].status).toBe('ready')
  })
  it('does not trust a forged valid flag on a mesh with a missing face', async () => {
    const backup = editable()
    backup.parts[0].geometry.indices.splice(-3)
    backup.parts[0].analysis.valid = true
    backup.parts[0].analysis.volumeCm3 = 1000
    const imported = await importProjectFile(file(backup))
    expect(imported.parts[0].analysis!.valid).toBe(false)
    expect(imported.parts[0].analysis!.volumeCm3).toBeNull()
    expect(imported.parts[0].status).toBe('invalid')
    expect(imported.parts[0].analysis!.boundaryEdges).toBeGreaterThan(0)
  })
  it('clears fabricated thickness statistics and heatmap samples on backup import', async () => {
    const backup = editable()
    backup.parts[0].thickness.minMm = 1000
    backup.parts[0].thickness.medianMm = 1000
    backup.parts[0].thickness.thinAreaPercent = 0
    backup.parts[0].thickness.values = [1000, 1000]
    const imported = await importProjectFile(file(backup))
    expect(imported.parts[0].thickness).toBeUndefined()
    expect(imported.parts[0].message).toContain('重新执行壁厚检测')
  })
  it.each([
    ['unsupported version', (p: any) => { p.schema = 'unknown' }],
    ['duplicate part ids', (p: any) => { p.parts.push(p.parts[0]) }],
    ['non-finite coordinate', (p: any) => { p.parts[0].geometry.positions[0] = null }],
    ['fractional index', (p: any) => { p.parts[0].geometry.indices[0] = .5 }],
    ['negative index', (p: any) => { p.parts[0].geometry.indices[0] = -1 }],
    ['out of range index', (p: any) => { p.parts[0].geometry.indices[0] = 4 }],
    ['incomplete triangle indices', (p: any) => { p.parts[0].geometry.indices.pop() }],
    ['incomplete vertex coordinates', (p: any) => { p.parts[0].geometry.positions.pop() }],
    ['invalid typed array object', (p: any) => { p.parts[0].geometry.positions = { 0: 1, length: 9 } }],
    ['negative material price', (p: any) => { p.settings.materials[0].pricePerGram = -10 }],
    ['excessive discount', (p: any) => { p.settings.discountPercent = 101 }],
    ['zero quantity', (p: any) => { p.parts[0].quantity = 0 }],
    ['fractional quantity', (p: any) => { p.parts[0].quantity = 1.3 }],
    ['excessive quantity', (p: any) => { p.parts[0].quantity = 1e9 }],
    ['invalid id', (p: any) => { p.id = '../project' }],
    ['missing completed geometry', (p: any) => { delete p.parts[0].geometry }],
    ['thickness count mismatch', (p: any) => { p.parts[0].thickness.totalSamples = 5 }],
    ['negative risk threshold', (p: any) => { p.settings.rules[0].threshold = -1 }],
  ])('rejects %s', async (_label, corrupt) => {
    const backup = editable()
    corrupt(backup)
    await expect(importProjectFile(file(backup))).rejects.toThrow('项目数据无效')
  })
  it('rejects unsafe prototype fields and invalid JSON', async () => {
    const backup = json(sampleProject()).replace('"schema":', '"__proto__":{"polluted":true},"schema":')
    await expect(importProjectFile(new File([backup], 'bad.json'))).rejects.toThrow('不安全字段')
    await expect(importProjectFile(new File(['{bad json'], 'bad.json'))).rejects.toThrow('有效 JSON')
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })
  it('rejects files over 100 MB before reading their contents', async () => {
    const text = vi.fn()
    await expect(importProjectFile({ size: 100 * 1024 * 1024 + 1, text } as unknown as File)).rejects.toThrow('100 MB')
    expect(text).not.toHaveBeenCalled()
  })
  it('rejects non-finite live data before writing to IndexedDB', async () => {
    const project = sampleProject()
    project.parts[0].geometry!.positions[0] = Infinity
    await expect(saveProject(project)).rejects.toThrow('顶点')
    expect(await listProjects()).toEqual([])
  })
})
