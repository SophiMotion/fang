import { describe, expect, it, vi } from 'vitest'
import { BoxGeometry, BufferGeometry, Float32BufferAttribute, Mesh } from 'three'
import { STLExporter } from 'three/addons/exporters/STLExporter.js'
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js'
import { readFile } from 'node:fs/promises'
import { analyzeGeometry } from '../src/geometry/analysis'
import { analyzeThickness } from '../src/geometry/thickness'
import { createDemoParts, rescalePart } from '../src/geometry/parts'
import type { GeometryData } from '../src/types'

function data(g: BufferGeometry): GeometryData {
  return { positions: new Float32Array(g.getAttribute('position').array), indices: g.index ? new Uint32Array(g.index.array) : undefined }
}
function join(...geometries: GeometryData[]): GeometryData {
  const points: number[] = []
  for (const g of geometries) for (const i of g.indices ?? Array.from({ length: g.positions.length / 3 }, (_, index) => index)) points.push(...g.positions.slice(i * 3, i * 3 + 3))
  return { positions: new Float32Array(points) }
}

describe('physical geometry', () => {
  it('measures a 10 mm cube rather than its display bounds', () => {
    const result = analyzeGeometry(data(new BoxGeometry(10, 10, 10)))
    expect(result.valid).toBe(true)
    expect(result.volumeCm3).toBeCloseTo(1, 6)
    expect(result.surfaceAreaCm2).toBeCloseTo(6, 6)
    expect(result.dimensionsMm).toEqual([10, 10, 10])
    expect(result.boundaryEdges).toBe(0)
    expect(result.warnings.some(w => w.includes('自相交'))).toBe(true)
  })
  it('rejects missing faces and inconsistent winding', () => {
    const g = data(new BoxGeometry(10, 10, 10))
    const open = { ...g, indices: g.indices!.slice(3) }
    expect(analyzeGeometry(open).valid).toBe(false)
    expect(analyzeGeometry(open).volumeCm3).toBeNull()
    const indices = g.indices!.slice()
    ;[indices[0], indices[1]] = [indices[1], indices[0]]
    expect(analyzeGeometry({ ...g, indices }).inconsistentEdges).toBeGreaterThan(0)
  })
  it('rejects invalid numeric coordinates and malformed indices', () => {
    expect(analyzeGeometry({ positions: new Float32Array([NaN, 0, 0]) }).valid).toBe(false)
    expect(analyzeGeometry({ positions: new Float32Array(9), indices: new Uint32Array([0, 1, 9]) }).volumeCm3).toBeNull()
  })
  it('subtracts a reversed inner cavity and rejects incorrectly wound nested shells', () => {
    const outer = data(new BoxGeometry(10, 10, 10))
    const inner = data(new BoxGeometry(6, 6, 6))
    const reversed = inner.indices!.slice()
    for (let i = 0; i < reversed.length; i += 3) [reversed[i + 1], reversed[i + 2]] = [reversed[i + 2], reversed[i + 1]]
    expect(analyzeGeometry(join(outer, { ...inner, indices: reversed })).volumeCm3).toBeCloseTo(0.784, 6)
    expect(analyzeGeometry(join(outer, inner)).valid).toBe(false)
  })
  it('is translation invariant and handles a fully reversed closed mesh', () => {
    const g = new BoxGeometry(10, 10, 10)
    g.translate(12340, -8100, 5200)
    expect(analyzeGeometry(data(g)).volumeCm3).toBeCloseTo(1, 6)
    const d = data(g)
    for (let i = 0; i < d.indices!.length; i += 3) [d.indices![i + 1], d.indices![i + 2]] = [d.indices![i + 2], d.indices![i + 1]]
    expect(analyzeGeometry(d).volumeCm3).toBeCloseTo(1, 6)
    expect(analyzeGeometry(d).overhangPercent).toBe(0)
  })
  it('scales length and volume consistently without mutating the source', () => {
    const part = createDemoParts()[2]
    const before = part.geometry!.positions.slice()
    const result = rescalePart(part, 'cm')
    expect(result.analysis!.volumeCm3).toBeCloseTo(part.analysis!.volumeCm3! * 1000, 4)
    expect(result.analysis!.dimensionsMm[2]).toBeCloseTo(part.analysis!.dimensionsMm[2] * 10)
    expect(part.geometry!.positions).toEqual(before)
    expect(result.thickness).toBeUndefined()
  })
  it('provides three ready demo parts with real closed surfaces', () => {
    const demos = createDemoParts()
    expect(demos).toHaveLength(3)
    for (const part of demos) {
      expect(part.status).toBe('ready')
      expect(part.analysis!.volumeCm3).toBeGreaterThan(0)
      expect(part.analysis!.boundaryEdges).toBe(0)
      expect(part.visible).toBe(true)
    }
    expect(demos[2].analysis!.dimensionsMm).toEqual([30, 1, 40])
    expect(demos[2].analysis!.volumeCm3).toBeCloseTo((30 * 40 - 2 * Math.PI * 2 ** 2) / 1000, 3)
    expect(demos[1].analysis!.volumeCm3).toBeCloseTo((40 * 30 * 26 - 34 * 24 * 23) / 1000, 5)
  })
})

describe('sampled wall thickness', () => {
  it('detects a 1 mm plate using opposing surfaces', () => {
    const result = analyzeThickness(data(new BoxGeometry(30, 24, 1)), 1.2, 1200)
    expect(result.validSamples / result.totalSamples).toBeGreaterThan(0.97)
    expect(result.p10Mm).toBeCloseTo(1, 3)
    expect(result.medianMm).toBeCloseTo(1, 3)
    expect(result.thinAreaPercent).toBeGreaterThan(90)
    expect(result.points.length).toBe(result.values.length * 3)
  })
  it('does not call a closed empty box wall its outside dimension', () => {
    const result = analyzeThickness(createDemoParts()[1].geometry!, 3.1, 1500)
    expect(result.p10Mm).toBeCloseTo(3, 2)
    expect(result.medianMm).toBeCloseTo(3, 2)
  })
  it('handles a consistently reversed plate without losing wall hits', () => {
    const g = data(new BoxGeometry(30, 24, 1))
    for (let i = 0; i < g.indices!.length; i += 3) [g.indices![i + 1], g.indices![i + 2]] = [g.indices![i + 2], g.indices![i + 1]]
    const result = analyzeThickness(g, 1.2, 500)
    expect(result.medianMm).toBeCloseTo(1, 3)
    expect(result.validSamples / result.totalSamples).toBeGreaterThan(0.97)
  })
  it('returns unknown for an open surface rather than green success', () => {
    const g = new BufferGeometry()
    g.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 10, 0, 0, 0, 10, 0], 3))
    const result = analyzeThickness(data(g), 1.2, 100)
    expect(result.minMm).toBeNull()
    expect(result.validSamples).toBe(0)
  })
})

describe('file imports', () => {
  it('really parses ASCII STL, binary STL and OBJ of the same 10 mm cube', async () => {
    const { importFiles } = await import('../src/geometry/worker-client')
    const mesh = new Mesh(new BoxGeometry(10, 10, 10))
    const ascii = new STLExporter().parse(mesh)
    const binary = new STLExporter().parse(mesh, { binary: true })
    const obj = new OBJExporter().parse(mesh)
    const parts = await importFiles([new File([ascii], 'cube-ascii.stl'), new File([binary.buffer as ArrayBuffer], 'cube-binary.stl'), new File([obj], 'cube.obj')], 'mm')
    expect(parts).toHaveLength(3)
    for (const part of parts) { expect(part.status).toBe('ready'); expect(part.analysis!.volumeCm3).toBeCloseTo(1, 5) }
  })
  it('preserves successful files in a batch with pending and failed files', async () => {
    const { importFiles } = await import('../src/geometry/worker-client')
    const parts = await importFiles([
      new File(['invalid'], 'broken.stl'),
      new File(['archive'], 'design.f3d'),
      new File(['v 0 0 0\nv 10 0 0\nv 0 10 0\nf 1 2 3'], 'open.obj'),
    ], 'mm')
    expect(parts.map(p => p.status)).toEqual(['error', 'pending', 'invalid'])
    expect(parts[1].geometry).toBeUndefined()
    expect(parts[2].analysis!.volumeCm3).toBeNull()
  })
  it('imports URDF primitives with millimetre conversion and joint placement', async () => {
    const { importFiles } = await import('../src/geometry/worker-client')
    const xml = '<robot name="sample"><link name="base"/><link name="cube"><visual><origin xyz="0 0 0.02"/><geometry><box size="0.01 0.01 0.01"/></geometry><material name="blue"><color rgba="0.1 0.2 0.8 1"/></material></visual></link><joint name="fixed" type="fixed"><parent link="base"/><child link="cube"/><origin xyz="0.1 0 0"/></joint></robot>'
    const parts = await importFiles([new File([xml], 'robot.urdf')], 'mm')
    expect(parts).toHaveLength(1)
    expect(parts[0].status).toBe('ready')
    expect(parts[0].analysis!.volumeCm3).toBeCloseTo(1, 6)
    expect(Math.min(...parts[0].geometry!.positions.filter((_, i) => i % 3 === 0))).toBeCloseTo(95)
    expect(Math.min(...parts[0].geometry!.positions.filter((_, i) => i % 3 === 2))).toBeCloseTo(15)
    expect(parts[0].color).toBe('#1a33cc')
  })
  it('resolves only attached URDF meshes and does not import attachments twice', async () => {
    const { importFiles } = await import('../src/geometry/worker-client')
    const stl = new STLExporter().parse(new Mesh(new BoxGeometry(10, 10, 10)))
    const xml = '<robot name="sample"><link name="part"><visual><geometry><mesh filename="package://robot/part.stl" scale="0.001 0.001 0.001"/></geometry></visual></link></robot>'
    const parts = await importFiles([new File([xml], 'robot.urdf'), new File([stl], 'part.stl')], 'mm')
    expect(parts).toHaveLength(1)
    expect(parts[0].status).toBe('ready')
    expect(parts[0].analysis!.volumeCm3).toBeCloseTo(1, 6)
  })
  it('imports URDF cylinder and sphere primitives as closed solids', async () => {
    const { importFiles } = await import('../src/geometry/worker-client')
    const xml = '<robot name="sample"><link name="cylinder"><visual><geometry><cylinder radius="0.005" length="0.02"/></geometry></visual></link><link name="sphere"><visual><geometry><sphere radius="0.005"/></geometry></visual></link></robot>'
    const parts = await importFiles([new File([xml], 'primitives.urdf')], 'mm')
    expect(parts).toHaveLength(2)
    expect(parts.every(p => p.status === 'ready')).toBe(true)
    expect(parts[0].analysis!.dimensionsMm).toEqual([10, 10, 20])
    expect(parts[0].analysis!.volumeCm3!).toBeGreaterThan(Math.PI * 25 * 20 / 1000 * 0.99)
    expect(parts[1].analysis!.volumeCm3!).toBeGreaterThan(4 / 3 * Math.PI * 125 / 1000 * 0.98)
  })
  it('rejects entities and remote URDF meshes without network calls', async () => {
    const { importFiles } = await import('../src/geometry/worker-client')
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network prohibited'))
    try {
      const remote = '<robot name="sample"><link name="part"><visual><geometry><mesh filename="https://example.com/private.stl"/></geometry></visual></link></robot>'
      const dtd = '<!DOCTYPE robot [<!ENTITY data SYSTEM "file:///etc/passwd">]><robot name="sample"/>'
      const parts = await importFiles([new File([remote], 'remote.urdf'), new File([dtd], 'entity.urdf')], 'mm')
      expect(parts).toHaveLength(2)
      expect(parts.every(p => p.status === 'error' && !p.geometry)).toBe(true)
      expect(fetch).not.toHaveBeenCalled()
    } finally { fetch.mockRestore() }
  })
})

describe('real CAD kernel fixtures', () => {
  it('triangulates real 10 mm STEP and IGES fixtures and verifies physical volume', async () => {
    const factory = (await import('occt-import-js')).default
    const wasmBinary = new Uint8Array(await readFile(new URL('../node_modules/occt-import-js/dist/occt-import-js.wasm', import.meta.url)))
    const cad = await factory({ wasmBinary, print: () => undefined, printErr: () => undefined })
    for (const ext of ['stp', 'igs']) {
      const bytes = new Uint8Array(await readFile(new URL(`../node_modules/occt-import-js/test/testfiles/cube-10x10mm/Cube 10x10.${ext}`, import.meta.url)))
      const result = ext === 'stp' ? cad.ReadStepFile(bytes, { linearUnit: 'millimeter' }) : cad.ReadIgesFile(bytes, { linearUnit: 'millimeter' })
      expect(result.success).toBe(true)
      expect(result.meshes).toHaveLength(1)
      const mesh = result.meshes![0]
      const analysis = analyzeGeometry({ positions: new Float32Array(mesh.attributes.position.array), indices: new Uint32Array(mesh.index.array) })
      expect(analysis.valid).toBe(true)
      expect(analysis.volumeCm3).toBeCloseTo(1, 6)
      expect(analysis.dimensionsMm).toEqual([10, 10, 10])
    }
    const volumes: number[] = []
    for (const unit of ['mm', 'm', 'in']) {
      const bytes = new Uint8Array(await readFile(new URL(`../node_modules/occt-import-js/test/testfiles/cube-units/cube-${unit}.step`, import.meta.url)))
      const result = cad.ReadStepFile(bytes, { linearUnit: 'millimeter' })
      expect(result.success).toBe(true)
      const mesh = result.meshes![0]
      volumes.push(analyzeGeometry({ positions: new Float32Array(mesh.attributes.position.array), indices: new Uint32Array(mesh.index.array) }).volumeCm3!)
    }
    expect(volumes[0]).toBeGreaterThan(0)
    expect(volumes[1]).toBeCloseTo(volumes[0], 5)
    expect(volumes[2]).toBeCloseTo(volumes[0], 5)
  }, 30_000)
})
