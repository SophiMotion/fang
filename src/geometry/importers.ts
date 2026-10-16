import { BufferGeometry, Color, Matrix4, Mesh } from 'three'
import { STLLoader } from 'three/addons/loaders/STLLoader.js'
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js'
import type { GeometryData, Part, Unit } from '../types'
import { MAX_TRIANGLES, UNIT_MM } from './analysis'
import { geometryData, newPart, PART_COLORS } from './parts'
import { findAttachment, parseUrdf, urdfMeshReferences } from './urdf'

export const MAX_FILE_BYTES = 50 * 1024 * 1024
const MAX_BATCH_BYTES = 200 * 1024 * 1024
export interface ImportedGeometry { name: string; geometry: GeometryData; color?: string }
export const extension = (name: string) => name.split('.').pop()?.toLowerCase() ?? ''
const CAD_FORMATS = new Set(['step', 'stp', 'iges', 'igs'])
let cadPromise: Promise<Awaited<ReturnType<typeof import('occt-import-js')['default']>>> | undefined

function scaleGeometry(geometry: GeometryData, scale: number): GeometryData {
  return { positions: scale === 1 ? geometry.positions : geometry.positions.map(v => v * scale), indices: geometry.indices }
}
export function transformGeometry(geometry: GeometryData, transform: Matrix4): GeometryData {
  const p = geometry.positions, out = new Float32Array(p.length), e = transform.elements
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i], y = p[i + 1], z = p[i + 2]
    out[i] = e[0] * x + e[4] * y + e[8] * z + e[12]
    out[i + 1] = e[1] * x + e[5] * y + e[9] * z + e[13]
    out[i + 2] = e[2] * x + e[6] * y + e[10] * z + e[14]
  }
  let indices = geometry.indices?.slice()
  if (transform.determinant() < 0) {
    if (!indices) indices = Uint32Array.from({ length: p.length / 3 }, (_, i) => i)
    for (let i = 0; i < indices.length; i += 3) [indices[i + 1], indices[i + 2]] = [indices[i + 2], indices[i + 1]]
  }
  return { positions: out, indices }
}

function validateFileSize(file: File): void {
  if (!file.size) throw new Error('文件为空。')
  if (file.size > MAX_FILE_BYTES) throw new Error('文件超过 50 MB 上限，请拆分或降低网格精度。')
}

export async function parseMeshFile(file: File, unit: Unit): Promise<ImportedGeometry[]> {
  validateFileSize(file)
  const ext = extension(file.name)
  if (ext === 'stl') {
    const bytes = await file.arrayBuffer()
    let binary = false
    if (bytes.byteLength >= 84) {
      const faces = new DataView(bytes).getUint32(80, true)
      binary = 84 + faces * 50 === bytes.byteLength
      if (binary && faces > MAX_TRIANGLES) throw new Error(`超过 ${MAX_TRIANGLES.toLocaleString()} 个三角形上限。`)
    }
    if (!binary && !/^\s*solid\b/i.test(new TextDecoder().decode(bytes.slice(0, 200)))) throw new Error('文件不是有效的二进制或 ASCII STL。')
    const geometry = new STLLoader().parse(bytes)
    if (!geometry.getAttribute('position')?.count) throw new Error('STL 没有可解析的三角形。')
    const groups = geometry.groups.length > 1 ? geometry.groups : [{ start: 0, count: geometry.getAttribute('position').count }]
    const groupNames = geometry.userData.groupNames as string[] | undefined
    const all = geometryData(geometry)
    const colors = geometry.getAttribute('color')
    const result: ImportedGeometry[] = []
    for (let i = 0; i < groups.length; i++) {
      const group = groups[i]
      if (!group.count) continue
      const positions = all.positions.slice(group.start * 3, (group.start + group.count) * 3)
      const data = scaleGeometry({ positions }, UNIT_MM[unit])
      const color = colors ? `#${new Color().setRGB(colors.getX(group.start), colors.getY(group.start), colors.getZ(group.start)).getHexString()}` : undefined
      result.push({ name: groupNames?.[i]?.trim() || (groups.length > 1 ? `${file.name} · solid ${i + 1}` : file.name), geometry: data, color })
    }
    geometry.dispose()
    return result
  }
  if (ext === 'obj') {
    const text = await file.text()
    // OBJLoader parses text only. It does not fetch mtllib or other URLs.
    const object = new OBJLoader().parse(text)
    object.updateMatrixWorld(true)
    const meshes: ImportedGeometry[] = []
    object.traverse(child => {
      if (!(child instanceof Mesh)) return
      const source = child.geometry as BufferGeometry
      if (!source.getAttribute('position')?.count) return
      meshes.push({ name: child.name || file.name, geometry: scaleGeometry(transformGeometry(geometryData(source), child.matrixWorld), UNIT_MM[unit]) })
      source.dispose()
      for (const material of Array.isArray(child.material) ? child.material : [child.material]) material.dispose()
    })
    if (!meshes.length) throw new Error('OBJ 没有三角面；线和点不能用于实体报价。')
    return meshes
  }
  if (CAD_FORMATS.has(ext)) {
    if (!cadPromise) cadPromise = Promise.all([import('occt-import-js'), import('occt-import-js/dist/occt-import-js.wasm?url')]).then(([factory, asset]) => factory.default({ locateFile: () => asset.default, print: () => undefined, printErr: () => undefined })).catch(error => { cadPromise = undefined; throw error })
    const cad = await cadPromise
    const bytes = new Uint8Array(await file.arrayBuffer())
    const options = { linearUnit: 'millimeter', linearDeflectionType: 'absolute_value', linearDeflection: 0.05, angularDeflection: 0.35 }
    const result = ['step', 'stp'].includes(ext) ? cad.ReadStepFile(bytes, options) : cad.ReadIgesFile(bytes, options)
    if (!result.success || !result.meshes?.length) throw new Error('CAD 转换未得到可分析的曲面网格；请检查文件或重新导出 STEP。')
    const paths = new Map<number, string>()
    const visit = (node: NonNullable<typeof result.root>, parents: string[]) => {
      const path = node.name ? [...parents, node.name] : parents
      for (const i of node.meshes ?? []) paths.set(i, path.join(' / '))
      for (const child of node.children ?? []) visit(child, path)
    }
    if (result.root) visit(result.root, [])
    return result.meshes.map((mesh, i) => {
      if (mesh.index.array.length / 3 > MAX_TRIANGLES) throw new Error(`CAD 三角化结果超过 ${MAX_TRIANGLES.toLocaleString()} 个面上限，请简化模型。`)
      let color: string | undefined
      if (mesh.color?.length === 3 && mesh.color.every(v => Number.isFinite(v) && v >= 0 && v <= 1)) color = `#${new Color().setRGB(mesh.color[0], mesh.color[1], mesh.color[2]).getHexString()}`
      return { name: paths.get(i) || mesh.name || `${file.name} · 零件 ${i + 1}`, geometry: { positions: new Float32Array(mesh.attributes.position.array), indices: new Uint32Array(mesh.index.array) }, color }
    })
  }
  throw new Error(`网格附件格式 .${ext || '(无扩展名)'} 暂不支持；请导出 STL、OBJ、STEP 或 IGES。`)
}

export function failedPart(fileName: string, unit: Unit, message: string, status: 'error' | 'pending' = 'error', color = PART_COLORS[3]): Part {
  return { ...newPart(fileName, fileName, extension(fileName).toUpperCase() || 'UNKNOWN', unit, color), status, message }
}

export async function importFilesDirect(files: File[], unit: Unit, onProgress?: (message: string) => void, onPart?: (part: Part) => void): Promise<Part[]> {
  if (!UNIT_MM[unit]) throw new Error('不支持的长度单位。')
  if (files.length > 100) throw new Error('一次最多选择 100 个文件（含附件）。')
  if (files.reduce((sum, file) => sum + file.size, 0) > MAX_BATCH_BYTES) throw new Error('本批次超过 200 MB，请分批导入。')
  const referenced = new Set<File>()
  for (const file of files) if (extension(file.name) === 'urdf' && file.size <= MAX_FILE_BYTES) {
    try { for (const ref of urdfMeshReferences(await file.text())) { const attachment = findAttachment(ref, file, files); if (attachment) referenced.add(attachment) } } catch { /* The main pass preserves a precise error row. */ }
  }
  const parts: Part[] = []
  const append = (part: Part) => { parts.push(part); onPart?.(part) }
  for (let i = 0; i < files.length; i++) {
    const file = files[i], ext = extension(file.name), color = PART_COLORS[i % PART_COLORS.length]
    if (referenced.has(file) || ext === 'mtl') continue
    onProgress?.(`正在解析 ${i + 1}/${files.length}：${file.name}`)
    try {
      validateFileSize(file)
      if (ext === 'f3d' || ext === 'f3z') { append(failedPart(file.name, unit, 'Fusion 专有归档需转换：在 Fusion 中打开模型，选择 文件 → 导出 → STEP（或导出 STL 网格），然后重新导入。当前文件未计算体积或报价。', 'pending', color)); continue }
      if (ext === 'urdf') {
        const urdfParts = await parseUrdf(file, files, color)
        for (const part of urdfParts) append(part)
      } else {
        const geometries = await parseMeshFile(file, unit)
        for (const [index, imported] of geometries.entries()) {
          const part = newPart(imported.name, file.name, ext.toUpperCase(), CAD_FORMATS.has(ext) ? 'mm' : unit, imported.color ?? PART_COLORS[(i + index) % PART_COLORS.length], imported.geometry)
          if (CAD_FORMATS.has(ext) && part.analysis) part.analysis.warnings.push('CAD 曲面以 0.05 mm 线性偏差三角化；网格体积为近似值。')
          append(part)
        }
      }
    } catch (error) { append(failedPart(file.name, unit, error instanceof Error ? error.message : '文件解析失败。', 'error', color)) }
  }
  onProgress?.(`解析结束：${parts.filter(p => p.status === 'ready').length} 个可报价部件，${parts.filter(p => p.status !== 'ready').length} 个待处理条目。`)
  return parts
}
