import type { GeometryAnalysis, GeometryData, Vec3 } from '../types'

export const MAX_TRIANGLES = 400_000
export const UNIT_MM = { mm: 1, cm: 10, m: 1000, inch: 25.4 } as const

type Triangle = [number, number, number]
type Shell = { triangles: number[]; volume: number; min: number[]; max: number[] }
export interface MeshFacts {
  analysis: GeometryAnalysis
  triangles: Triangle[]
  signedVolume: number
  min: Vec3
  max: Vec3
}

function blank(warning: string): MeshFacts {
  return { analysis: { volumeCm3: null, surfaceAreaCm2: 0, dimensionsMm: [0, 0, 0], triangleCount: 0, boundaryEdges: 0, nonManifoldEdges: 0, degenerateTriangles: 0, inconsistentEdges: 0, valid: false, warnings: [warning, '自相交检查未执行；本结果不是完整实体有效性证明。'], overhangPercent: 0 }, triangles: [], signedVolume: 0, min: [0, 0, 0], max: [0, 0, 0] }
}

// The input coordinates are immutable physical millimetres. No viewer matrix is used.
export function inspectGeometry(geometry: GeometryData): MeshFacts {
  const { positions: p, indices } = geometry
  if (!p || p.length < 9 || p.length % 3 !== 0) return blank('几何没有完整的三角形顶点。')
  const n = p.length / 3
  const count = indices ? indices.length : n
  if (count % 3 !== 0 || count < 3) return blank('三角形索引数量不完整。')
  if (count / 3 > MAX_TRIANGLES) return blank(`模型超过 ${MAX_TRIANGLES.toLocaleString()} 个三角形的分析上限，请降低网格精度。`)
  const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < p.length; i++) {
    if (!Number.isFinite(p[i])) return blank('模型含非有限坐标。')
    const axis = i % 3
    min[axis] = Math.min(min[axis], p[i]); max[axis] = Math.max(max[axis], p[i])
  }
  if (indices) for (const index of indices) if (!Number.isInteger(index) || index >= n || index < 0) return blank('模型索引越界。')
  const dimensions = max.map((v, i) => v - min[i]) as Vec3
  const span = Math.max(...dimensions)
  if (!Number.isFinite(span) || span <= 0) return blank('模型尺寸为零。')
  const epsilon = Math.max(span * 1e-7, 1e-7)
  const center = min.map((v, i) => (v + max[i]) / 2)
  const welded = new Uint32Array(n), positionMap = new Map<string, number>()
  for (let i = 0; i < n; i++) {
    const key = `${Math.round((p[i * 3] - min[0]) / epsilon)},${Math.round((p[i * 3 + 1] - min[1]) / epsilon)},${Math.round((p[i * 3 + 2] - min[2]) / epsilon)}`
    let id = positionMap.get(key)
    if (id === undefined) { id = positionMap.size; positionMap.set(key, id) }
    welded[i] = id
  }
  const triangleCount = count / 3
  const parent = new Int32Array(triangleCount)
  for (let i = 0; i < triangleCount; i++) parent[i] = i
  const find = (a: number): number => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a] } return a }
  const union = (a: number, b: number) => { parent[find(a)] = find(b) }
  const edges = new Map<string, { count: number; balance: number; triangle: number }>()
  const faceKeys = new Set<string>(), triangles: Triangle[] = []
  const volumes = new Float64Array(triangleCount)
  let area = 0, overhangArea = 0, reversedOverhangArea = 0, degenerate = 0, duplicates = 0, signedVolume = 0
  for (let t = 0; t < triangleCount; t++) {
    const ids: Triangle = indices ? [indices[t * 3], indices[t * 3 + 1], indices[t * 3 + 2]] : [t * 3, t * 3 + 1, t * 3 + 2]
    triangles.push(ids)
    const [ia, ib, ic] = ids.map(i => i * 3)
    const ax = p[ia] - center[0], ay = p[ia + 1] - center[1], az = p[ia + 2] - center[2]
    const bx = p[ib] - center[0], by = p[ib + 1] - center[1], bz = p[ib + 2] - center[2]
    const cx = p[ic] - center[0], cy = p[ic + 1] - center[1], cz = p[ic + 2] - center[2]
    const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
    const doubleArea = Math.hypot(nx, ny, nz)
    if (doubleArea <= epsilon * epsilon) degenerate++
    area += doubleArea / 2
    // Printer builds along +Z; bed-facing triangles at the lowest Z do not require support.
    if (doubleArea > 0 && nz / doubleArea < -Math.SQRT1_2 && (p[ia + 2] + p[ib + 2] + p[ic + 2]) / 3 > min[2] + epsilon * 10) overhangArea += doubleArea / 2
    if (doubleArea > 0 && nz / doubleArea > Math.SQRT1_2 && (p[ia + 2] + p[ib + 2] + p[ic + 2]) / 3 > min[2] + epsilon * 10) reversedOverhangArea += doubleArea / 2
    const volume = (ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx)) / 6
    volumes[t] = volume; signedVolume += volume
    const w = ids.map(i => welded[i])
    const faceKey = [...w].sort((a, b) => a - b).join(',')
    if (faceKeys.has(faceKey)) duplicates++
    faceKeys.add(faceKey)
    for (let k = 0; k < 3; k++) {
      const a = w[k], b = w[(k + 1) % 3]
      const key = a < b ? `${a}:${b}` : `${b}:${a}`
      const direction = a < b ? 1 : -1
      const edge = edges.get(key)
      if (edge) { edge.count++; edge.balance += direction; union(t, edge.triangle) }
      else edges.set(key, { count: 1, balance: direction, triangle: t })
    }
  }
  let boundaryEdges = 0, nonManifoldEdges = 0, inconsistentEdges = 0
  for (const edge of edges.values()) {
    if (edge.count === 1) boundaryEdges++
    else if (edge.count > 2) nonManifoldEdges++
    if (edge.count === 2 && edge.balance !== 0) inconsistentEdges++
  }
  const warnings: string[] = []
  if (boundaryEdges) warnings.push(`发现 ${boundaryEdges} 条开放边，无法可靠计算实体体积。`)
  if (nonManifoldEdges) warnings.push(`发现 ${nonManifoldEdges} 条非流形边。`)
  if (inconsistentEdges) warnings.push(`发现 ${inconsistentEdges} 条朝向不一致的共享边。`)
  if (degenerate) warnings.push(`发现 ${degenerate} 个退化三角形。`)
  if (duplicates) warnings.push(`发现 ${duplicates} 个重复三角形。`)
  let valid = boundaryEdges === 0 && nonManifoldEdges === 0 && inconsistentEdges === 0 && degenerate === 0 && duplicates === 0
  const shellMap = new Map<number, Shell>()
  if (valid) {
    for (let t = 0; t < triangleCount; t++) {
      const root = find(t)
      let shell = shellMap.get(root)
      if (!shell) { shell = { triangles: [], volume: 0, min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }; shellMap.set(root, shell) }
      shell.triangles.push(t); shell.volume += volumes[t]
      for (const id of triangles[t]) for (let k = 0; k < 3; k++) { shell.min[k] = Math.min(shell.min[k], p[id * 3 + k]); shell.max[k] = Math.max(shell.max[k], p[id * 3 + k]) }
    }
    const shells = [...shellMap.values()]
    if (shells.length > 100) { valid = false; warnings.push('独立封闭壳超过 100 个，请拆分模型后进行体积审核。') }
    else {
      const shellSigns: number[] = []
      for (let i = 0; i < shells.length && valid; i++) {
        const shell = shells[i]
        const vertex = triangles[shell.triangles[0]][0]
        const q = [p[vertex * 3], p[vertex * 3 + 1], p[vertex * 3 + 2]]
        let depth = 0
        for (let j = 0; j < shells.length; j++) if (i !== j) {
          const other = shells[j]
          if (q.every((v, k) => v > other.min[k] + epsilon && v < other.max[k] - epsilon) && insideShell(q, other, triangles, p)) depth++
          const overlap = shell.min.every((v, k) => v < other.max[k] - epsilon && shell.max[k] > other.min[k] + epsilon)
          const contained = shell.min.every((v, k) => v >= other.min[k] - epsilon && shell.max[k] <= other.max[k] + epsilon)
          const contains = other.min.every((v, k) => v >= shell.min[k] - epsilon && other.max[k] <= shell.max[k] + epsilon)
          if (overlap && !contained && !contains) { valid = false; warnings.push('多个独立壳的范围交叠，无法排除实体穿插；请拆分或修复后报价。'); break }
        }
        shellSigns.push(Math.sign(shell.volume) * (depth % 2 ? -1 : 1))
      }
      if (shellSigns.some(s => s === 0 || s !== shellSigns[0])) { valid = false; warnings.push('封闭壳或内腔的方向不兼容，不能通过分别取绝对值相加计算材料体积。') }
    }
  }
  if (Math.abs(signedVolume) < Math.max(epsilon ** 3, span ** 3 * 1e-12)) { valid = false; warnings.push('模型有向体积为零或数值不稳定。') }
  if (valid && signedVolume < 0) warnings.push('整体面朝向反转；按整体有向体积的绝对值计算，保留内腔符号。')
  warnings.push('自相交检查未执行；本结果不是完整实体有效性证明。')
  warnings.push('体积来自三角网格；悬垂按 +Z 打印方向筛查，未进行切片。')
  return { analysis: { volumeCm3: valid ? Math.abs(signedVolume) / 1000 : null, surfaceAreaCm2: area / 100, dimensionsMm: dimensions, triangleCount, boundaryEdges, nonManifoldEdges, degenerateTriangles: degenerate, inconsistentEdges, valid, warnings, overhangPercent: area > 0 ? (signedVolume < 0 ? reversedOverhangArea : overhangArea) / area * 100 : 0 }, triangles, signedVolume, min, max }
}

// Oblique ray parity with deduplicated distances avoids triangulated face diagonal double hits.
function insideShell(q: number[], shell: Shell, triangles: Triangle[], p: Float32Array): boolean {
  const dx = 0.9238795325, dy = 0.331413574, dz = 0.191341716
  const hits: number[] = []
  for (const t of shell.triangles) {
    const [a, b, c] = triangles[t].map(i => i * 3)
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2]
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2]
    const hx = dy * vz - dz * vy, hy = dz * vx - dx * vz, hz = dx * vy - dy * vx
    const det = ux * hx + uy * hy + uz * hz
    if (Math.abs(det) < 1e-14) continue
    const sx = q[0] - p[a], sy = q[1] - p[a + 1], sz = q[2] - p[a + 2]
    const u = (sx * hx + sy * hy + sz * hz) / det
    if (u < -1e-9 || u > 1 + 1e-9) continue
    const qx = sy * uz - sz * uy, qy = sz * ux - sx * uz, qz = sx * uy - sy * ux
    const v = (dx * qx + dy * qy + dz * qz) / det
    if (v < -1e-9 || u + v > 1 + 1e-9) continue
    const distance = (vx * qx + vy * qy + vz * qz) / det
    if (distance > 1e-8) hits.push(distance)
  }
  hits.sort((a, b) => a - b)
  let unique = 0, last = -Infinity
  for (const hit of hits) if (hit - last > Math.max(1e-7, Math.abs(hit) * 1e-7)) { unique++; last = hit }
  return unique % 2 === 1
}

export function analyzeGeometry(geometry: GeometryData): GeometryAnalysis { return inspectGeometry(geometry).analysis }
