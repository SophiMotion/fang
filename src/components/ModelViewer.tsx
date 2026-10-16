import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import type { Part } from '../types'

export interface ModelViewerProps {
  parts: Part[]
  selectedId: string | null
  onSelect: (id: string) => void
  mode: 'solid' | 'wireframe' | 'thickness'
  explode: number
  isolated: boolean
  fitKey: number
}
interface PartDisplay { part: Part; group: THREE.Group; mesh: THREE.Mesh; material: THREE.MeshStandardMaterial; edges: THREE.LineSegments; heat?: THREE.Points; origin: THREE.Vector3 }
interface Stage {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  controls: OrbitControls
  modelRoot: THREE.Group
  helpers: THREE.Group
  displays: PartDisplay[]
  modelScale: number
  sceneBounds: THREE.Box3
  requestRender: () => void
  fit: () => void
  rebuild: (parts: Part[]) => void
  update: (props: ModelViewerProps) => void
}
const legend = [ ['#ea4335', '低于阈值'], ['#fbbc05', '接近阈值'], ['#4285f4', '较厚'], ['#9aa0a6', '未知'] ]

function disposeTree(root: THREE.Object3D) {
  root.traverse(object => {
    const renderable = object as THREE.Mesh
    renderable.geometry?.dispose()
    const materials = Array.isArray(renderable.material) ? renderable.material : renderable.material ? [renderable.material] : []
    materials.forEach(material => material.dispose())
  })
  root.clear()
}
function safeColor(value: string) { return /^#[0-9a-f]{6}$/i.test(value) ? value : '#4285f4' }

export function ModelViewer(props: ModelViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const axesRef = useRef<SVGSVGElement>(null)
  const stageRef = useRef<Stage | null>(null)
  const previousParts = useRef<Part[] | null>(null)
  const propsRef = useRef(props)
  propsRef.current = props
  const [error, setError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'default' })
    } catch {
      setError('无法启动 3D 预览。请确认浏览器已启用硬件加速；零件参数与报价仍可使用。')
      return
    }
    setError(null)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.15
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFShadowMap
    renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;outline:none;'
    renderer.domElement.tabIndex = 0
    renderer.domElement.setAttribute('aria-label', '3D 模型预览，拖动旋转，滚轮缩放，点击选择零件；方向键平移')
    container.prepend(renderer.domElement)
    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#f6f8fc')
    const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 100000)
    camera.up.set(0, 0, 1)
    camera.position.set(150, -220, 160)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = false
    controls.enablePan = true
    controls.screenSpacePanning = true
    controls.maxPolarAngle = Math.PI * .94
    controls.listenToKeyEvents(renderer.domElement)
    const modelRoot = new THREE.Group()
    const helpers = new THREE.Group()
    scene.add(modelRoot, helpers)
    scene.add(new THREE.HemisphereLight('#ffffff', '#c4ccda', 2.1))
    const sun = new THREE.DirectionalLight('#ffffff', 3)
    sun.castShadow = true
    sun.shadow.mapSize.set(1024, 1024)
    sun.shadow.bias = -.0003
    sun.shadow.normalBias = .035
    scene.add(sun, sun.target)
    const fill = new THREE.DirectionalLight('#dbe7ff', 1.2)
    fill.position.set(-100, -100, 80)
    scene.add(fill)
    let disposed = false
    let contextLost = false
    let animationFrame = 0
    const requestRender = () => {
      if (disposed || contextLost || animationFrame) return
      animationFrame = requestAnimationFrame(() => {
        animationFrame = 0
        if (!disposed && !contextLost) {
          renderer.render(scene, camera)
          const inverse = camera.quaternion.clone().invert()
          ;[new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)].forEach((axis, index) => {
            axis.applyQuaternion(inverse)
            const x = 29 + axis.x * 20
            const y = 29 - axis.y * 20
            const line = axesRef.current?.querySelector(`[data-axis-line="${index}"]`)
            const label = axesRef.current?.querySelector(`[data-axis-label="${index}"]`)
            line?.setAttribute('x2', String(x))
            line?.setAttribute('y2', String(y))
            label?.setAttribute('x', String(29 + axis.x * 27))
            label?.setAttribute('y', String(32 - axis.y * 27))
          })
        }
      })
    }
    const stage: Stage = {
      renderer, scene, camera, controls, modelRoot, helpers, displays: [], modelScale: 1, sceneBounds: new THREE.Box3(), requestRender,
      fit: () => {
        modelRoot.updateMatrixWorld(true)
        const bounds = new THREE.Box3()
        for (const display of stage.displays) if (display.group.visible) bounds.expandByObject(display.mesh)
        if (bounds.isEmpty()) bounds.set(new THREE.Vector3(-40, -40, -20), new THREE.Vector3(40, 40, 20))
        stage.sceneBounds.copy(bounds)
        const size = bounds.getSize(new THREE.Vector3())
        const center = bounds.getCenter(new THREE.Vector3())
        const radius = Math.max(size.length() / 2, .01)
        const vFov = THREE.MathUtils.degToRad(camera.fov)
        const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect)
        const direction = new THREE.Vector3(.8, -2.6, 1.6).normalize()
        camera.position.copy(center).add(direction)
        camera.lookAt(center)
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion)
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion)
        // Fit individual mesh bounds, not the empty corners of a whole assembly box.
        const corners: THREE.Vector3[] = []
        for (const display of stage.displays) {
          if (!display.group.visible) continue
          const local = display.mesh.geometry.boundingBox
          if (!local) continue
          for (const x of [local.min.x, local.max.x]) for (const y of [local.min.y, local.max.y]) for (const z of [local.min.z, local.max.z]) corners.push(new THREE.Vector3(x, y, z).applyMatrix4(display.mesh.matrixWorld))
        }
        if (!corners.length) corners.push(bounds.min.clone(), bounds.max.clone())
        let minR = Infinity, maxR = -Infinity, minU = Infinity, maxU = -Infinity
        for (const corner of corners) {
          const delta = corner.clone().sub(center)
          const r = delta.dot(right), u = delta.dot(up)
          minR = Math.min(minR, r); maxR = Math.max(maxR, r); minU = Math.min(minU, u); maxU = Math.max(maxU, u)
        }
        center.addScaledVector(right, (minR + maxR) / 2).addScaledVector(up, (minU + maxU) / 2)
        let distance = .01
        for (const point of corners) {
          const corner = point.clone().sub(center)
          const depth = corner.dot(direction)
          distance = Math.max(distance, depth + Math.abs(corner.dot(right)) / Math.tan(hFov / 2), depth + Math.abs(corner.dot(up)) / Math.tan(vFov / 2))
        }
        distance *= 1.16
        camera.position.copy(center).addScaledVector(direction, distance)
        controls.target.copy(center)
        camera.near = Math.max(radius / 10000, .00001)
        camera.far = Math.max(distance * 100, 100)
        controls.minDistance = Math.max(radius / 100, .001)
        controls.maxDistance = distance * 20
        camera.updateProjectionMatrix()
        controls.update()
        disposeTree(helpers)
        const floorSize = Math.max(size.x, size.y, size.z, 1) * 4
        const floorZ = bounds.min.z - Math.max(radius * .003, .001)
        const grid = new THREE.GridHelper(floorSize, 32, '#dce4ef', '#e5ebf3')
        grid.rotation.x = Math.PI / 2
        grid.position.set(center.x, center.y, floorZ + .0001)
        helpers.add(grid)
        const floor = new THREE.Mesh(new THREE.PlaneGeometry(floorSize, floorSize), new THREE.ShadowMaterial({ opacity: .13 }))
        floor.position.set(center.x, center.y, floorZ)
        floor.receiveShadow = true
        helpers.add(floor)
        sun.position.copy(center).add(new THREE.Vector3(radius, -radius * 1.2, radius * 3))
        sun.target.position.copy(center)
        sun.shadow.camera.left = -radius * 2
        sun.shadow.camera.right = radius * 2
        sun.shadow.camera.top = radius * 2
        sun.shadow.camera.bottom = -radius * 2
        sun.shadow.camera.near = .01
        sun.shadow.camera.far = radius * 10 + 10
        sun.shadow.camera.updateProjectionMatrix()
        requestRender()
      },
      rebuild: parts => {
        disposeTree(modelRoot)
        stage.displays = []
        const byFile = new Map<string, { parts: Part[]; bounds: THREE.Box3 }>()
        for (const part of parts) {
          if (!part.geometry || part.geometry.positions.length < 9) continue
          const sourceKey = part.fileName || part.id
          const entry = byFile.get(sourceKey) ?? { parts: [], bounds: new THREE.Box3() }
          const attribute = new THREE.BufferAttribute(part.geometry.positions, 3)
          const box = new THREE.Box3().setFromBufferAttribute(attribute)
          if (![box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z].every(Number.isFinite)) continue
          entry.parts.push(part)
          entry.bounds.union(box)
          byFile.set(sourceKey, entry)
        }
        const entries = [...byFile.values()].filter(entry => !entry.bounds.isEmpty())
        const largest = Math.max(1, ...entries.map(entry => entry.bounds.getSize(new THREE.Vector3()).length()))
        const gap = largest * .25
        const totalWidth = entries.reduce((sum, entry) => sum + entry.bounds.getSize(new THREE.Vector3()).x, 0) + Math.max(entries.length - 1, 0) * gap
        stage.modelScale = Math.max(largest, totalWidth)
        let cursor = -totalWidth / 2
        for (const entry of entries) {
          const size = entry.bounds.getSize(new THREE.Vector3())
          const center = entry.bounds.getCenter(new THREE.Vector3())
          const origin = new THREE.Vector3(cursor + size.x / 2 - center.x, -center.y, -entry.bounds.min.z)
          cursor += size.x + gap
          for (const part of entry.parts) {
            if (!part.geometry) continue
            const geometry = new THREE.BufferGeometry()
            // Buffers are copied once so Three.js never owns or mutates analysis/source buffers.
            geometry.setAttribute('position', new THREE.BufferAttribute(part.geometry.positions.slice(), 3))
            if (part.geometry.indices) geometry.setIndex(new THREE.BufferAttribute(part.geometry.indices.slice(), 1))
            geometry.computeVertexNormals()
            geometry.computeBoundingBox()
            const material = new THREE.MeshStandardMaterial({ color: safeColor(part.color), roughness: .5, metalness: .08, side: THREE.DoubleSide })
            const mesh = new THREE.Mesh(geometry, material)
            mesh.userData.partId = part.id
            mesh.castShadow = true
            mesh.receiveShadow = false
            const triangleCount = (geometry.index?.count ?? geometry.getAttribute('position').count) / 3
            // Edge extraction can dominate main-thread time on CAD meshes; large meshes retain shaded / wireframe views.
            const edges = new THREE.LineSegments(triangleCount <= 150000 ? new THREE.EdgesGeometry(geometry, 28) : new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: '#31455f', transparent: true, opacity: .13 }))
            const group = new THREE.Group()
            group.position.copy(origin)
            group.add(mesh, edges)
            let heat: THREE.Points | undefined
            if (part.thickness && part.thickness.points.length === part.thickness.values.length * 3) {
              const heatGeometry = new THREE.BufferGeometry()
              heatGeometry.setAttribute('position', new THREE.BufferAttribute(part.thickness.points.slice(), 3))
              const colors = new Float32Array(part.thickness.values.length * 3)
              const color = new THREE.Color()
              for (let i = 0; i < part.thickness.values.length; i++) {
                const value = part.thickness.values[i]
                const threshold = part.thickness.thresholdMm
                color.set(!Number.isFinite(value) || value < 0 ? '#9aa0a6' : value < threshold ? '#ea4335' : value < threshold * 1.5 ? '#fbbc05' : '#4285f4')
                color.toArray(colors, i * 3)
              }
              heatGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
              heat = new THREE.Points(heatGeometry, new THREE.PointsMaterial({ vertexColors: true, size: largest * .009, sizeAttenuation: true, depthWrite: false, transparent: true, opacity: 1 }))
              heat.renderOrder = 2
              group.add(heat)
            }
            modelRoot.add(group)
            stage.displays.push({ part, group, mesh, material, edges, heat, origin: origin.clone() })
          }
        }
      },
      update: current => {
        const count = stage.displays.length
        const distance = stage.modelScale * .22 * Math.max(0, Math.min(1, current.explode))
        stage.displays.forEach((display, index) => {
          const selected = display.part.id === current.selectedId
          display.group.visible = display.part.visible && (!current.isolated || selected)
          display.group.position.copy(display.origin)
          if (count > 1 && distance > 0) {
            const angle = index / count * Math.PI * 2
            display.group.position.add(new THREE.Vector3(Math.cos(angle) * distance, Math.sin(angle) * distance, 0))
          }
          display.material.color.set(safeColor(display.part.color))
          display.material.emissive.set(selected ? '#18356a' : '#000000')
          display.material.emissiveIntensity = selected ? .13 : 0
          display.material.wireframe = current.mode === 'wireframe'
          display.material.transparent = current.mode === 'thickness'
          display.material.opacity = current.mode === 'thickness' ? .22 : 1
          display.material.depthWrite = current.mode !== 'thickness'
          display.material.needsUpdate = true
          display.edges.visible = current.mode !== 'wireframe'
          const edgeMaterial = display.edges.material as THREE.LineBasicMaterial
          edgeMaterial.color.set(selected ? '#1a73e8' : '#31455f')
          edgeMaterial.opacity = selected ? .5 : .13
          if (display.heat) display.heat.visible = current.mode === 'thickness'
        })
        requestRender()
      },
    }
    stageRef.current = stage
    const resize = () => {
      const width = Math.max(container.clientWidth, 1)
      const height = Math.max(container.clientHeight, 1)
      renderer.setSize(width, height, false)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      if (!stage.sceneBounds.isEmpty()) stage.fit()
      requestRender()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(container)
    resize()
    controls.addEventListener('change', requestRender)
    const raycaster = new THREE.Raycaster()
    const pointer = new THREE.Vector2()
    let down: { x: number; y: number; id: number } | null = null
    let dragged = false
    const pointerDown = (event: PointerEvent) => { if (event.button === 0) { down = { x: event.clientX, y: event.clientY, id: event.pointerId }; dragged = false } }
    const pointerMove = (event: PointerEvent) => { if (down && Math.hypot(event.clientX - down.x, event.clientY - down.y) > 5) dragged = true }
    const pointerCancel = () => { down = null }
    const pointerUp = (event: PointerEvent) => {
      const click = down && event.pointerId === down.id && !dragged && Math.hypot(event.clientX - down.x, event.clientY - down.y) <= 5
      down = null
      if (!click) return
      const rect = renderer.domElement.getBoundingClientRect()
      pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1)
      raycaster.setFromCamera(pointer, camera)
      modelRoot.updateMatrixWorld(true)
      const hit = raycaster.intersectObjects(stage.displays.filter(display => display.group.visible).map(display => display.mesh), false)[0]
      if (hit) propsRef.current.onSelect(String(hit.object.userData.partId))
    }
    const lost = (event: Event) => { event.preventDefault(); contextLost = true; setError('3D 图形连接已暂停，浏览器恢复后将重新显示。报价数据不受影响。') }
    // Recreate the stage after restoration; stale GPU handles must not be disposed against a new context.
    const restored = () => { setError(null); setRetry(value => value + 1) }
    renderer.domElement.addEventListener('pointerdown', pointerDown)
    renderer.domElement.addEventListener('pointermove', pointerMove)
    renderer.domElement.addEventListener('pointerup', pointerUp)
    renderer.domElement.addEventListener('pointercancel', pointerCancel)
    renderer.domElement.addEventListener('webglcontextlost', lost)
    renderer.domElement.addEventListener('webglcontextrestored', restored)
    stage.rebuild(propsRef.current.parts)
    previousParts.current = propsRef.current.parts
    stage.update(propsRef.current)
    stage.fit()
    return () => {
      disposed = true
      if (animationFrame) cancelAnimationFrame(animationFrame)
      observer.disconnect()
      controls.removeEventListener('change', requestRender)
      controls.stopListenToKeyEvents()
      controls.dispose()
      renderer.domElement.removeEventListener('pointerdown', pointerDown)
      renderer.domElement.removeEventListener('pointermove', pointerMove)
      renderer.domElement.removeEventListener('pointerup', pointerUp)
      renderer.domElement.removeEventListener('pointercancel', pointerCancel)
      renderer.domElement.removeEventListener('webglcontextlost', lost)
      renderer.domElement.removeEventListener('webglcontextrestored', restored)
      renderer.forceContextLoss()
      disposeTree(modelRoot)
      disposeTree(helpers)
      sun.shadow.dispose()
      renderer.dispose()
      renderer.domElement.remove()
      stageRef.current = null
    }
  }, [retry])

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const geometryChanged = previousParts.current?.length !== props.parts.length || props.parts.some((part, index) => {
      const previous = previousParts.current?.[index]
      return !previous || previous.id !== part.id || previous.geometry !== part.geometry || previous.thickness !== part.thickness || previous.fileName !== part.fileName
    })
    if (geometryChanged) {
      stage.rebuild(props.parts)
      stage.update(props)
      stage.fit()
    } else {
      const byId = new Map(props.parts.map(part => [part.id, part]))
      stage.displays.forEach(display => { display.part = byId.get(display.part.id) ?? display.part })
      stage.update(props)
    }
    previousParts.current = props.parts
  }, [props.parts, props.selectedId, props.mode, props.explode, props.isolated, retry])

  useEffect(() => { stageRef.current?.fit() }, [props.fitKey, props.isolated])
  useEffect(() => { if (props.isolated) stageRef.current?.fit() }, [props.selectedId, props.isolated])
  const shown = props.parts.filter(part => part.geometry && part.visible && (!props.isolated || part.id === props.selectedId))
  const hasThickness = shown.some(part => part.thickness)
  return <div className="model-viewer" ref={containerRef} style={{ position: 'relative', width: '100%', height: '100%', minHeight: 340, overflow: 'hidden', borderRadius: 8, background: '#f6f8fc' }}>
    {error ? <div role="alert" style={{ position: 'absolute', inset: 0, display: 'grid', alignContent: 'center', justifyItems: 'center', gap: 16, padding: 32, background: '#f6f8fc', color: '#475467', textAlign: 'center' }}><p>{error}</p><button type="button" onClick={() => setRetry(value => value + 1)}>重试 3D 预览</button></div>
      : shown.length === 0 ? <div style={{ position: 'absolute', inset: 0, display: 'grid', placeContent: 'center', pointerEvents: 'none', textAlign: 'center', color: '#667085', gap: 8 }}><strong>{props.parts.length ? '当前没有可见模型' : '从一个 3D 模型开始'}</strong><span style={{ fontSize: 13 }}>{props.parts.length ? '显示零件或关闭隔离视图后即可查看' : '添加模型后即可旋转、查看尺寸并配置报价'}</span></div> : null}
    {!error && shown.length > 0 && <>
      <svg ref={axesRef} aria-hidden="true" viewBox="0 0 60 60" style={{ position: 'absolute', left: 12, bottom: 10, width: 60, height: 60, fontSize: 10, fontWeight: 700, pointerEvents: 'none' }}>{['#ea4335', '#34a853', '#4285f4'].map((color, index) => <g key={color}><line data-axis-line={index} x1="29" y1="29" x2="29" y2="29" stroke={color} strokeWidth="1.7" /><text data-axis-label={index} x="29" y="29" fill={color} textAnchor="middle">{['X', 'Y', 'Z'][index]}</text></g>)}</svg>
      {props.mode !== 'thickness' && <div style={{ position: 'absolute', left: 14, top: 12, color: '#667085', fontSize: 11, pointerEvents: 'none' }}>拖动旋转 · 滚轮缩放</div>}
    </>}
    {!error && props.mode === 'thickness' && <div style={{ position: 'absolute', left: 12, top: 12, maxWidth: 'calc(100% - 24px)', background: '#ffffffed', border: '1px solid #e3e8ef', borderRadius: 6, padding: '8px 10px', pointerEvents: 'none', color: '#475467', fontSize: 11 }}>
      {hasThickness ? <><div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>{legend.map(([color, name]) => <span key={name} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><i style={{ width: 7, height: 7, borderRadius: '50%', background: color }} />{name}</span>)}</div><div style={{ marginTop: 5, color: '#667085' }}>离散采样热图 · 未覆盖区域未经检测 · 阈值按各零件设置</div></> : '尚未运行壁厚采样，请在“壁厚与风险”中开始分析'}
    </div>}
  </div>
}

export default ModelViewer
