import { DOMParser } from '@xmldom/xmldom'
import { BoxGeometry, BufferGeometry, CylinderGeometry, Euler, Matrix4, Quaternion, SphereGeometry, Vector3 } from 'three'
import type { Part } from '../types'
import { geometryData, newPart, PART_COLORS } from './parts'
import { failedPart, parseMeshFile, transformGeometry } from './importers'

type XmlNode = NonNullable<ReturnType<DOMParser['parseFromString']>['documentElement']>
function children(node: XmlNode, tag?: string): XmlNode[] {
  const result: XmlNode[] = []
  for (let i = 0; i < node.childNodes.length; i++) { const child = node.childNodes.item(i); if (child?.nodeType === 1 && (!tag || child.nodeName === tag)) result.push(child as XmlNode) }
  return result
}
function first(node: XmlNode, tag: string): XmlNode | undefined { return children(node, tag)[0] }
function numbers(text: string | null, count: number, fallback?: number[]): number[] {
  if (text === null || text.trim() === '') { if (fallback) return fallback; throw new Error('URDF 缺少几何尺寸。') }
  const values = text.trim().split(/\s+/).map(Number)
  if (values.length !== count || values.some(v => !Number.isFinite(v))) throw new Error('URDF 含无效坐标、角度或尺寸。')
  return values
}
function documentRoot(text: string): XmlNode {
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(text)) throw new Error('URDF 不接受 DOCTYPE 或实体声明。')
  const errors: string[] = []
  const document = new DOMParser({ onError: (level, message) => { if (level !== 'warning') errors.push(message) } }).parseFromString(text, 'application/xml')
  const root = document.documentElement
  if (!root || root.tagName !== 'robot' || errors.length) throw new Error('URDF XML 无效，必须包含合法 robot 根节点。')
  return root
}
export function urdfMeshReferences(text: string): string[] {
  const root = documentRoot(text), references: string[] = []
  for (const link of children(root, 'link')) for (const visual of children(link, 'visual')) {
    const geometry = first(visual, 'geometry'), mesh = geometry && first(geometry, 'mesh')
    const ref = mesh?.getAttribute('filename')
    if (ref) references.push(ref)
  }
  return references
}
export function findAttachment(reference: string, source: File, files: File[]): File | undefined {
  if (/^(?:https?:|data:|blob:|file:|ftp:|\/\/)/i.test(reference)) throw new Error('URDF 外网或绝对 URI 网格被禁止；请随附本地文件。')
  let ref: string
  try { ref = decodeURIComponent(reference).replaceAll('\\', '/').replace(/^package:\/\//, '') } catch { throw new Error('URDF 网格路径编码无效。') }
  if (/^[a-zA-Z]:|^\//.test(ref) || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(ref) || ref.split('/').includes('..')) throw new Error('URDF 网格路径必须是本地相对路径，不允许目录穿越。')
  ref = ref.replace(/^\.\//, '')
  const normalize = (file: File) => (file.webkitRelativePath || file.name).replaceAll('\\', '/')
  const path = normalize(source), directory = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : ''
  let matches = files.filter(file => file !== source && [ref, directory + ref].includes(normalize(file)))
  if (!matches.length) matches = files.filter(file => file !== source && (normalize(file).endsWith('/' + ref) || ref.endsWith('/' + normalize(file))))
  if (!matches.length) matches = files.filter(file => file !== source && file.name === ref.split('/').pop())
  if (matches.length > 1) throw new Error(`URDF 附件 ${reference} 存在重名歧义，请使用保留目录结构的文件。`)
  return matches[0]
}
function origin(node: XmlNode): Matrix4 {
  const source = first(node, 'origin')
  const xyz = numbers(source?.getAttribute('xyz') ?? null, 3, [0, 0, 0])
  const rpy = numbers(source?.getAttribute('rpy') ?? null, 3, [0, 0, 0])
  return new Matrix4().compose(new Vector3(...xyz.map(v => v * 1000) as [number, number, number]), new Quaternion().setFromEuler(new Euler(rpy[0], rpy[1], rpy[2], 'ZYX')), new Vector3(1, 1, 1))
}
export async function parseUrdf(file: File, files: File[], defaultColor: string): Promise<Part[]> {
  const root = documentRoot(await file.text()), links = children(root, 'link')
  if (links.length > 300) throw new Error('URDF 超过 300 个 link 上限，请拆分模型。')
  const names = new Map<string, XmlNode>()
  for (const link of links) { const name = link.getAttribute('name'); if (!name || names.has(name)) throw new Error('URDF 的 link 名称缺失或重复。'); names.set(name, link) }
  const joints = new Map<string, { parent: string; matrix: Matrix4 }>()
  for (const joint of children(root, 'joint')) {
    const parent = first(joint, 'parent')?.getAttribute('link'), child = first(joint, 'child')?.getAttribute('link')
    if (!parent || !child || !names.has(parent) || !names.has(child) || joints.has(child)) throw new Error('URDF 关节父子引用无效或同一 link 有多个父节点。')
    joints.set(child, { parent, matrix: origin(joint) })
  }
  const poses = new Map<string, Matrix4>()
  const worldPose = (name: string, visited = new Set<string>()): Matrix4 => {
    if (poses.has(name)) return poses.get(name)!
    if (visited.has(name)) throw new Error('URDF 关节关系包含循环。')
    visited.add(name)
    const joint = joints.get(name)
    const pose = joint ? worldPose(joint.parent, visited).clone().multiply(joint.matrix) : new Matrix4()
    poses.set(name, pose); return pose
  }
  for (const name of names.keys()) worldPose(name)
  const parts: Part[] = []
  for (const [linkName, link] of names) {
    const visuals = children(link, 'visual')
    for (let i = 0; i < visuals.length; i++) {
      const visual = visuals[i], displayName = `${linkName}${visuals.length > 1 ? ` · ${visual.getAttribute('name') || i + 1}` : ''}`
      try {
        const geometry = first(visual, 'geometry'), shape = geometry && children(geometry)[0]
        if (!shape) throw new Error('visual 缺少几何。')
        const transform = worldPose(linkName).clone().multiply(origin(visual))
        let color = defaultColor
        const material = first(visual, 'material')
        let colorNode = material && first(material, 'color')
        if (!colorNode && material?.getAttribute('name')) colorNode = children(root, 'material').filter(m => m.getAttribute('name') === material.getAttribute('name')).map(m => first(m, 'color'))[0]
        if (colorNode) { const rgba = numbers(colorNode.getAttribute('rgba'), 4); if (rgba.some(v => v < 0 || v > 1)) throw new Error('URDF 颜色应在 0–1 范围。'); color = '#' + rgba.slice(0, 3).map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('') }
        if (shape.tagName === 'mesh') {
          const reference = shape.getAttribute('filename')
          if (!reference) throw new Error('mesh 缺少 filename。')
          const attachment = findAttachment(reference, file, files)
          if (!attachment) throw new Error(`缺失本地网格附件：${reference}。请与 URDF 一起选择导入。`)
          const scale = numbers(shape.getAttribute('scale'), 3, [1, 1, 1])
          if (scale.some(v => v === 0)) throw new Error('mesh scale 不能为零。')
          transform.scale(new Vector3(scale[0], scale[1], scale[2]))
          // URDF mesh coordinates are metres unless its explicit mesh scale says otherwise.
          const imported = await parseMeshFile(attachment, 'm')
          for (const [j, mesh] of imported.entries()) {
            const part = newPart(imported.length > 1 ? `${displayName} / ${mesh.name || j + 1}` : displayName, file.name, 'URDF', 'mm', mesh.color ?? color, transformGeometry(mesh.geometry, transform))
            part.analysis?.warnings.push(`URDF visual 网格附件 ${attachment.name}；坐标按米及 mesh scale 换算，需核对真实尺寸。`)
            parts.push(part)
          }
        } else {
          let buffer: BufferGeometry
          if (shape.tagName === 'box') { const size = numbers(shape.getAttribute('size'), 3); if (size.some(v => v <= 0)) throw new Error('box 尺寸必须大于零。'); buffer = new BoxGeometry(size[0] * 1000, size[1] * 1000, size[2] * 1000) }
          else if (shape.tagName === 'cylinder') { const radius = numbers(shape.getAttribute('radius'), 1)[0], length = numbers(shape.getAttribute('length'), 1)[0]; if (radius <= 0 || length <= 0) throw new Error('cylinder 尺寸必须大于零。'); buffer = new CylinderGeometry(radius * 1000, radius * 1000, length * 1000, 48); buffer.rotateX(Math.PI / 2) }
          else if (shape.tagName === 'sphere') { const radius = numbers(shape.getAttribute('radius'), 1)[0]; if (radius <= 0) throw new Error('sphere 半径必须大于零。'); buffer = new SphereGeometry(radius * 1000, 40, 24) }
          else throw new Error(`不支持 URDF 几何 ${shape.tagName}。`)
          const data = transformGeometry(geometryData(buffer), transform); buffer.dispose()
          parts.push(newPart(displayName, file.name, 'URDF', 'mm', color, data))
        }
      } catch (error) { parts.push({ ...failedPart(file.name, 'mm', error instanceof Error ? error.message : 'URDF 几何解析失败。', 'error', PART_COLORS[3]), name: displayName }) }
    }
  }
  if (!parts.length) throw new Error('URDF 没有 visual 几何。collision 不替代制造实体，也不会与 visual 重复计价。')
  return parts
}
