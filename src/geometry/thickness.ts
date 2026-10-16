import { BufferAttribute, BufferGeometry, DoubleSide, Ray, Vector3 } from 'three'
import { MeshBVH } from 'three-mesh-bvh'
import type { GeometryData, ThicknessResult } from '../types'
import { inspectGeometry } from './analysis'

export function analyzeThickness(geometry: GeometryData, thresholdMm: number, samples = 1500): ThicknessResult {
  if (!Number.isFinite(thresholdMm) || thresholdMm <= 0) throw new Error('壁厚阈值必须是大于 0 的毫米数值。')
  const unknown = (): ThicknessResult => ({ minMm: null, p10Mm: null, medianMm: null, thinAreaPercent: null, validSamples: 0, totalSamples: 0, thresholdMm, points: new Float32Array(), values: new Float32Array() })
  const facts = inspectGeometry(geometry)
  if (!facts.analysis.valid) return unknown()
  const totalSamples = Math.max(1, Math.min(5000, Math.round(Number.isFinite(samples) ? samples : 1500)))
  const buffer = new BufferGeometry()
  buffer.setAttribute('position', new BufferAttribute(geometry.positions.slice(), 3))
  if (geometry.indices) buffer.setIndex(new BufferAttribute(geometry.indices.slice(), 1))
  const bvh = new MeshBVH(buffer, { indirect: true })
  const p = geometry.positions, areas = new Float64Array(facts.triangles.length)
  const a = new Vector3(), b = new Vector3(), c = new Vector3(), edge = new Vector3(), normal = new Vector3(), point = new Vector3(), ray = new Ray()
  let cumulativeArea = 0
  for (let i = 0; i < facts.triangles.length; i++) {
    const t = facts.triangles[i]
    a.fromArray(p, t[0] * 3); b.fromArray(p, t[1] * 3); c.fromArray(p, t[2] * 3)
    cumulativeArea += normal.subVectors(b, a).cross(edge.subVectors(c, a)).length() / 2
    areas[i] = cumulativeArea
  }
  const points = new Float32Array(totalSamples * 3), values = new Float32Array(totalSamples).fill(-1)
  const measured: number[] = []
  const diagonal = Math.hypot(...facts.analysis.dimensionsMm)
  const epsilon = Math.max(diagonal * 1e-7, 1e-7)
  const orientation = facts.signedVolume < 0 ? -1 : 1
  let triangleIndex = 0, state = 0x1234abcd
  const random = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 4294967296 }
  try {
    for (let i = 0; i < totalSamples; i++) {
      const areaPosition = (i + 0.5) / totalSamples * cumulativeArea
      while (triangleIndex + 1 < areas.length && areas[triangleIndex] < areaPosition) triangleIndex++
      const t = facts.triangles[triangleIndex]
      a.fromArray(p, t[0] * 3); b.fromArray(p, t[1] * 3); c.fromArray(p, t[2] * 3)
      const rootU = Math.sqrt(random()), v = random()
      point.copy(a).multiplyScalar(1 - rootU).addScaledVector(b, rootU * (1 - v)).addScaledVector(c, rootU * v)
      normal.subVectors(b, a).cross(edge.subVectors(c, a)).normalize().multiplyScalar(orientation)
      point.toArray(points, i * 3)
      ray.origin.copy(point).addScaledVector(normal, -epsilon)
      ray.direction.copy(normal).negate()
      const hit = bvh.raycastFirst(ray, DoubleSide, epsilon * 0.25, diagonal * 1.001)
      if (!hit || !Number.isFinite(hit.distance) || hit.distance <= epsilon * 0.25) continue
      // Only a surface facing out of the material is an admissible opposing surface.
      if (hit.face && hit.face.normal.dot(ray.direction) * orientation < 0.05) continue
      const value = hit.distance + epsilon
      values[i] = value; measured.push(value)
    }
  } finally { buffer.dispose() }
  measured.sort((x, y) => x - y)
  const quantile = (q: number) => measured[Math.floor((measured.length - 1) * q)]
  const reliableCoverage = measured.length / totalSamples >= 0.5
  return { minMm: reliableCoverage ? measured[0] : null, p10Mm: reliableCoverage ? quantile(0.1) : null, medianMm: reliableCoverage ? quantile(0.5) : null, thinAreaPercent: reliableCoverage ? measured.filter(v => v < thresholdMm).length / measured.length * 100 : null, validSamples: measured.length, totalSamples, thresholdMm, points, values }
}
