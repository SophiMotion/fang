import { BufferGeometry, ExtrudeGeometry, Path, Shape } from 'three'
import type { GeometryData, Part, Unit } from '../types'
import { analyzeGeometry, UNIT_MM } from './analysis'

export const PART_COLORS = ['#4285f4', '#34a853', '#fbbc04', '#ea4335']
export const defaultConfig = () => ({ processId: 'fdm', materialId: 'pla', postProcessId: 'none' })
export function geometryData(geometry: BufferGeometry): GeometryData {
  const attribute = geometry.getAttribute('position')
  const positions = new Float32Array(attribute.count * 3)
  for (let i = 0; i < attribute.count; i++) { positions[i * 3] = attribute.getX(i); positions[i * 3 + 1] = attribute.getY(i); positions[i * 3 + 2] = attribute.getZ(i) }
  return { positions, indices: geometry.index ? new Uint32Array(geometry.index.array) : undefined }
}
export function newPart(name: string, fileName: string, format: string, unit: Unit, color: string, geometry?: GeometryData): Part {
  const analysis = geometry ? analyzeGeometry(geometry) : undefined
  return { id: globalThis.crypto?.randomUUID?.() ?? `part-${Date.now()}-${Math.random().toString(36).slice(2)}`, name, fileName, format, color, unit, quantity: 1, visible: true, config: defaultConfig(), geometry, analysis, status: analysis ? analysis.valid ? 'ready' : 'invalid' : 'error', message: analysis && !analysis.valid ? analysis.warnings.filter(w => !w.includes('未执行') && !w.includes('体积来自')).join(' ') : undefined }
}
export function rescalePart(part: Part, unit: Unit): Part {
  if (!UNIT_MM[unit]) throw new Error('不支持的长度单位。')
  if (part.unit === unit) return part
  if (!part.geometry) return { ...part, unit, thickness: undefined }
  if (['STEP', 'STP', 'IGES', 'IGS', 'URDF'].includes(part.format.toUpperCase())) throw new Error('该格式已按文件单位换算为 mm，不能重新解释单位。')
  const scale = UNIT_MM[unit] / UNIT_MM[part.unit]
  const geometry: GeometryData = { positions: part.geometry.positions.map(v => v * scale), indices: part.geometry.indices?.slice() }
  const analysis = analyzeGeometry(geometry)
  return { ...part, unit, geometry, analysis, thickness: undefined, status: analysis.valid ? 'ready' : 'invalid', message: analysis.valid ? undefined : analysis.warnings.join(' ') }
}

function hollowBox(): GeometryData {
  const vertices: number[] = []
  type P = [number, number, number]
  const quad = (a: P, b: P, c: P, d: P, normal: P) => {
    const u = b.map((x, i) => x - a[i]), v = c.map((x, i) => x - a[i])
    const dot = (u[1] * v[2] - u[2] * v[1]) * normal[0] + (u[2] * v[0] - u[0] * v[2]) * normal[1] + (u[0] * v[1] - u[1] * v[0]) * normal[2]
    for (const point of dot > 0 ? [a, b, c, a, c, d] : [a, c, b, a, d, c]) vertices.push(...point)
  }
  const outer: P[] = [[-20, -15, 0], [20, -15, 0], [20, 15, 0], [-20, 15, 0]]
  const inner: P[] = [[-17, -12, 3], [17, -12, 3], [17, 12, 3], [-17, 12, 3]]
  const up = (p: P): P => [p[0], p[1], 26]
  quad(...outer as [P, P, P, P], [0, 0, -1])
  quad(...inner as [P, P, P, P], [0, 0, 1])
  const normals: P[] = [[0, -1, 0], [1, 0, 0], [0, 1, 0], [-1, 0, 0]]
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4
    quad(outer[i], outer[j], up(outer[j]), up(outer[i]), normals[i])
    quad(inner[i], inner[j], up(inner[j]), up(inner[i]), normals[i].map(v => -v) as P)
    quad(up(outer[i]), up(outer[j]), up(inner[j]), up(inner[i]), [0, 0, 1])
  }
  return { positions: new Float32Array(vertices) }
}

export function createDemoParts(): Part[] {
  const shape = new Shape()
  shape.absarc(0, 0, 20, 0, Math.PI * 2, false)
  const centerHole = new Path(); centerHole.absarc(0, 0, 6, 0, Math.PI * 2, true); shape.holes.push(centerHole)
  for (let i = 0; i < 4; i++) { const hole = new Path(); hole.absarc(Math.cos(i * Math.PI / 2) * 14, Math.sin(i * Math.PI / 2) * 14, 2, 0, Math.PI * 2, true); shape.holes.push(hole) }
  const flange = new ExtrudeGeometry(shape, { depth: 6, bevelEnabled: false, curveSegments: 32 })
  flange.translate(-54, 0, 0)
  const box = hollowBox()
  const plateShape = new Shape()
  plateShape.moveTo(-15, -20); plateShape.lineTo(15, -20); plateShape.lineTo(15, 20); plateShape.lineTo(-15, 20); plateShape.closePath()
  for (const height of [-12, 12]) { const hole = new Path(); hole.absarc(0, height, 2, 0, Math.PI * 2, true); plateShape.holes.push(hole) }
  const plate = new ExtrudeGeometry(plateShape, { depth: 1, bevelEnabled: false, curveSegments: 24 })
  plate.rotateX(Math.PI / 2); plate.translate(52, 0.5, 20)
  const parts = [
    newPart('示例 · 四孔法兰盘', 'demo-flange.stl', 'STL', 'mm', PART_COLORS[0], geometryData(flange)),
    newPart('示例 · 3 mm 壁厚空心盒', 'demo-hollow-box.stl', 'STL', 'mm', PART_COLORS[1], box),
    newPart('示例 · 1 mm 双孔立板', 'demo-thin-plate.stl', 'STL', 'mm', PART_COLORS[2], geometryData(plate)),
  ]
  parts[1].quantity = 2
  flange.dispose(); plate.dispose()
  return parts
}
