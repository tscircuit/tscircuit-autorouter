import type { Obstacle, SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import clsx from "clsx"
import { type ReactElement, useEffect, useMemo, useRef, useState } from "react"
import * as THREE from "three"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js"
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js"

const BOARD_THICKNESS = 1.55
const COPPER_THICKNESS = 0.055
const TOP_COPPER = 0xe3a43d
const BOTTOM_COPPER = 0xc87855
const INNER_COPPER_COLORS = [0x5b8fb4, 0x8b73b5, 0x4d9b84, 0xc17b59]
const MINIMUM_TRACE_SEGMENT_LENGTH = 0.0001
const CAMERA_REFRAME_ASPECT_THRESHOLD = 0.18
const POINTER_CLICK_TOLERANCE = 5
const TOOLTIP_WIDTH = 260
const DEFAULT_VIEWPORT_WIDTH = 600

type Pcb3dViewerProps = {
  srj: SimpleRouteJson
  inputTraces: SimplifiedPcbTrace[]
  finalTraces: SimplifiedPcbTrace[] | null
}

type ViewerSnapshot = "input" | "final"
type VisibilityCategory =
  | "board"
  | "inferredBodies"
  | "jumpers"
  | "pads"
  | "traces"
  | "vias"
  | "holes"

type ViewerVisibility = Record<VisibilityCategory, boolean>

type HoverDetails = {
  label: string
  x: number
  y: number
}

type RenderSummary = {
  boards: number
  holes: number
  inferredBodies: number
  jumpers: number
  pads: number
  traceSegments: number
  vias: number
}

type Pcb3dSceneObjectState = {
  category: VisibilityCategory
  label: string | undefined
  visible: boolean
}

type InferredBodyVisibilityOptions = {
  includeInferredBodies?: boolean
}

type DebugLayerSpan = {
  fromLayer: string
  height: number
  toLayer: string
}

type DebugObjectMetadata = {
  category: VisibilityCategory
  label?: string
  layer?: string
  layers?: string[]
  net?: string
  span?: DebugLayerSpan
}

type Pcb3dDebugMetadata = DebugObjectMetadata & {
  baseZ: number
  layers: string[]
}

type InferredBodyGroup = {
  componentId: string
  pads: Obstacle[]
}

type TraceSegmentInput = {
  end: { x: number; y: number }
  layer: string
  layerCount: number
  material: THREE.Material
  net: string
  root: THREE.Group
  start: { x: number; y: number }
  width: number
}

type ViaInput = {
  fromLayer: string
  holeDiameter?: number
  layerCount: number
  material: THREE.Material
  net: string
  outerDiameter?: number
  root: THREE.Group
  toLayer: string
  x: number
  y: number
}

type SceneBuildResult = {
  boardCenter: THREE.Vector3
  boardSize: { width: number; height: number }
  root: THREE.Group
}

type BoardMetrics = {
  center: THREE.Vector3
  height: number
  width: number
}

type ViewerRuntime = {
  camera: THREE.PerspectiveCamera
  controls: OrbitControls
  sceneBuild: SceneBuildResult
  shadowPlane: THREE.Mesh
  fit: (layerGap: number) => void
}

type ViewerInitializationInput = {
  boardOpacity: number
  canvas: HTMLCanvasElement
  container: HTMLDivElement
  focusedNet: string | null
  layerGap: number
  onCameraStateChange: (cameraState: CameraState) => void
  onFocusedNetToggle: (net: string) => void
  onHoverDetailsChange: (details: HoverDetails | null) => void
  preservedCamera: CameraState | null
  srj: SimpleRouteJson
  traces: SimplifiedPcbTrace[]
  visibility: ViewerVisibility
  visibleLayers: Set<string>
}

type ViewerInitialization = {
  dispose: () => void
  runtime: ViewerRuntime
}

type CameraState = {
  position: THREE.Vector3
  target: THREE.Vector3
}

type FrameBoardInput = {
  boardCenter: THREE.Vector3
  boardSize: { width: number; height: number }
  camera: THREE.PerspectiveCamera
  controls: OrbitControls
  depth: number
  viewport: { width: number; height: number }
}

const DEFAULT_VISIBILITY: ViewerVisibility = {
  board: true,
  holes: true,
  inferredBodies: false,
  jumpers: true,
  pads: true,
  traces: true,
  vias: true,
}

const createViewerVisibility = (
  includeInferredBodies = false,
): ViewerVisibility => {
  return {
    ...DEFAULT_VISIBILITY,
    inferredBodies: includeInferredBodies,
  }
}

const VISIBILITY_OPTIONS: Array<{
  id: VisibilityCategory
  label: string
}> = [
  { id: "board", label: "Board" },
  { id: "pads", label: "Pads" },
  { id: "traces", label: "Traces" },
  { id: "vias", label: "Vias" },
  { id: "holes", label: "Holes" },
  { id: "inferredBodies", label: "Inferred bodies" },
]

const SNAPSHOT_OPTIONS: Array<{ id: ViewerSnapshot; label: string }> = [
  { id: "input", label: "Start" },
  { id: "final", label: "Final" },
]

const getLayerNames = (layerCount: number): string[] => {
  if (layerCount <= 1) return ["top"]
  return [
    "top",
    ...Array.from(
      { length: Math.max(layerCount - 2, 0) },
      (_, index) => `inner${index + 1}`,
    ),
    "bottom",
  ]
}

const getLayerIndex = (layer: string, layerCount: number): number => {
  if (layer === "top") return 0
  if (layer === "bottom") return Math.max(layerCount - 1, 0)
  const match = layer.match(/inner(\d+)/)
  let innerIndex = 1
  if (match) innerIndex = Number(match[1])
  return Math.min(Math.max(innerIndex, 1), layerCount - 2)
}

/**
 * Returns a copper layer's Z position after applying the viewer's exploded
 * layer spacing. Positive gaps spread every layer away from the board center.
 */
export const getPcb3dExplodedLayerZ = (
  layer: string,
  layerCount: number,
  layerGap: number,
): number => {
  const centerIndex = (Math.max(layerCount, 1) - 1) / 2
  const offset = (centerIndex - getLayerIndex(layer, layerCount)) * layerGap
  return getLayerZ(layer, layerCount) + offset
}

const getBoardPoints = (
  srj: SimpleRouteJson,
): Array<{ x: number; y: number }> => {
  if (srj.outline && srj.outline.length >= 3) return srj.outline
  return [
    { x: srj.bounds.minX, y: srj.bounds.minY },
    { x: srj.bounds.maxX, y: srj.bounds.minY },
    { x: srj.bounds.maxX, y: srj.bounds.maxY },
    { x: srj.bounds.minX, y: srj.bounds.maxY },
  ]
}

const getBoardMetrics = (srj: SimpleRouteJson): BoardMetrics => {
  const points = getBoardPoints(srj)
  const xs = points.map((point) => point.x)
  const ys = points.map((point) => point.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)

  return {
    center: new THREE.Vector3((minX + maxX) / 2, (minY + maxY) / 2, 0),
    height: Math.max(maxY - minY, 1),
    width: Math.max(maxX - minX, 1),
  }
}

const getLayerZ = (layer: string, layerCount: number): number => {
  if (layer === "top") return BOARD_THICKNESS / 2 + COPPER_THICKNESS / 2
  if (layer === "bottom") return -BOARD_THICKNESS / 2 - COPPER_THICKNESS / 2

  const match = layer.match(/inner(\d+)/)
  let innerIndex = 1
  if (match) innerIndex = Number(match[1])
  const layerIndex = Math.min(Math.max(innerIndex, 1), layerCount - 2)
  return BOARD_THICKNESS / 2 - (BOARD_THICKNESS * layerIndex) / (layerCount - 1)
}

const getCopperColor = (layer: string): number => {
  if (layer === "top") return TOP_COPPER
  if (layer === "bottom") return BOTTOM_COPPER
  const match = layer.match(/inner(\d+)/)
  let layerNumber = 1
  if (match) layerNumber = Number(match[1])
  const innerIndex = Math.max(layerNumber - 1, 0)
  return INNER_COPPER_COLORS[innerIndex % INNER_COPPER_COLORS.length]
}

const getLayersInSpan = (
  fromLayer: string,
  toLayer: string,
  layerCount: number,
): string[] => {
  const layers = getLayerNames(layerCount)
  const fromIndex = getLayerIndex(fromLayer, layerCount)
  const toIndex = getLayerIndex(toLayer, layerCount)
  const start = Math.min(fromIndex, toIndex)
  const end = Math.max(fromIndex, toIndex)
  return layers.slice(start, end + 1)
}

/**
 * Attaches the metadata used by visibility, exploded layers, hover details,
 * and net focusing. Keeping it as one typed value avoids scattered userData
 * keys and makes inferred geometry explicit at every call site.
 */
const tagDebugObject = (
  object: THREE.Object3D,
  metadata: DebugObjectMetadata,
): void => {
  let debugLayers: string[] = []
  if (metadata.layers) debugLayers = metadata.layers
  else if (metadata.layer) debugLayers = [metadata.layer]
  const debugMetadata: Pcb3dDebugMetadata = {
    ...metadata,
    baseZ: object.position.z,
    layers: debugLayers,
  }
  object.userData.pcb3dDebug = debugMetadata
}

const getDebugMetadata = (
  object: THREE.Object3D,
): Pcb3dDebugMetadata | undefined => {
  return object.userData.pcb3dDebug as Pcb3dDebugMetadata | undefined
}

const getObjectMaterials = (object: THREE.Object3D): THREE.Material[] => {
  if (!(object instanceof THREE.Mesh)) return []
  if (Array.isArray(object.material)) return object.material
  return [object.material]
}

const setMaterialOpacity = (
  material: THREE.Material,
  opacity: number,
  depthWrite: boolean,
): void => {
  material.opacity = opacity
  material.transparent = opacity < 0.999
  material.depthWrite = depthWrite
  material.needsUpdate = true
}

const getHoleRadius = (obstacle: Obstacle): number => {
  const minimumDimension = Math.min(obstacle.width, obstacle.height)
  const hasPlatedHoleId = obstacle.connectedTo.some((id) =>
    id.startsWith("pcb_plated_hole_"),
  )
  let radiusRatio = 0.42
  if (hasPlatedHoleId) radiusRatio = 0.25
  return Math.max(minimumDimension * radiusRatio, 0.08)
}

const getHoleRadii = (obstacle: Obstacle): { x: number; y: number } => {
  const radius = getHoleRadius(obstacle)
  if (Math.abs(obstacle.width - obstacle.height) <= 0.05) {
    return { x: radius, y: radius }
  }
  return {
    x: Math.max(obstacle.width * 0.25, radius),
    y: Math.max(obstacle.height * 0.25, radius),
  }
}

const isThroughHole = (obstacle: Obstacle): boolean =>
  new Set(obstacle.layers).size > 1

const addBoardHole = (shape: THREE.Shape, obstacle: Obstacle): void => {
  const hole = new THREE.Path()
  const radii = getHoleRadii(obstacle)
  const rotation = THREE.MathUtils.degToRad(obstacle.ccwRotationDegrees ?? 0)

  hole.absellipse(
    obstacle.center.x,
    obstacle.center.y,
    radii.x,
    radii.y,
    0,
    Math.PI * 2,
    true,
    rotation,
  )
  shape.holes.push(hole)
}

const makeBoardGeometry = (
  srj: SimpleRouteJson,
  traces: SimplifiedPcbTrace[],
): THREE.ExtrudeGeometry => {
  const points = getBoardPoints(srj)
  const shape = new THREE.Shape()
  shape.moveTo(points[0].x, points[0].y)
  for (const point of points.slice(1)) shape.lineTo(point.x, point.y)
  shape.closePath()

  for (const obstacle of srj.obstacles) {
    if (isThroughHole(obstacle)) addBoardHole(shape, obstacle)
  }
  for (const trace of traces) {
    for (const routePoint of trace.route) {
      if (routePoint.route_type !== "via") continue
      const radius = Math.max(
        (routePoint.via_hole_diameter ?? 0.28) / 2,
        0.07,
      )
      const hole = new THREE.Path()
      hole.absellipse(
        routePoint.x,
        routePoint.y,
        radius,
        radius,
        0,
        Math.PI * 2,
        true,
      )
      shape.holes.push(hole)
    }
  }

  const geometry = new THREE.ExtrudeGeometry(shape, {
    bevelEnabled: true,
    bevelSegments: 3,
    bevelSize: 0.08,
    bevelThickness: 0.06,
    curveSegments: 32,
    depth: BOARD_THICKNESS,
  })
  geometry.translate(0, 0, -BOARD_THICKNESS / 2)
  geometry.computeVertexNormals()
  return geometry
}

const createCopperMaterial = (layer: string): THREE.MeshPhysicalMaterial =>
  new THREE.MeshPhysicalMaterial({
    clearcoat: 0.2,
    clearcoatRoughness: 0.26,
    color: getCopperColor(layer),
    metalness: 0.58,
    roughness: 0.25,
  })

const createPad = (
  obstacle: Obstacle,
  layer: string,
  layerCount: number,
  material: THREE.Material,
): THREE.Mesh => {
  let geometry: THREE.BufferGeometry
  if (isThroughHole(obstacle)) {
    const shape = new THREE.Shape()
    const halfWidth = obstacle.width / 2
    const halfHeight = obstacle.height / 2
    shape.moveTo(-halfWidth, -halfHeight)
    shape.lineTo(halfWidth, -halfHeight)
    shape.lineTo(halfWidth, halfHeight)
    shape.lineTo(-halfWidth, halfHeight)
    shape.closePath()
    const hole = new THREE.Path()
    const holeRadii = getHoleRadii(obstacle)
    hole.absellipse(
      0,
      0,
      holeRadii.x,
      holeRadii.y,
      0,
      Math.PI * 2,
      true,
    )
    shape.holes.push(hole)
    geometry = new THREE.ExtrudeGeometry(shape, {
      bevelEnabled: false,
      curveSegments: 28,
      depth: COPPER_THICKNESS,
    })
    geometry.translate(0, 0, -COPPER_THICKNESS / 2)
  } else {
    geometry = new THREE.BoxGeometry(
      obstacle.width,
      obstacle.height,
      COPPER_THICKNESS,
    )
  }
  const mesh = new THREE.Mesh(geometry, material)
  mesh.rotation.z = THREE.MathUtils.degToRad(obstacle.ccwRotationDegrees ?? 0)
  mesh.position.set(
    obstacle.center.x,
    obstacle.center.y,
    getLayerZ(layer, layerCount),
  )
  tagDebugObject(mesh, {
    category: "pads",
    label: `${obstacle.componentId ?? obstacle.connectedTo[0] ?? "Pad"} · ${layer}`,
    layer,
  })
  return mesh
}

const createViaBarrel = (
  obstacle: Obstacle,
  material: THREE.Material,
): THREE.Mesh => {
  const radius = getHoleRadius(obstacle)
  const geometry = new THREE.CylinderGeometry(
    radius,
    radius,
    BOARD_THICKNESS + 0.03,
    28,
    1,
    true,
  )
  const barrel = new THREE.Mesh(geometry, material)
  barrel.rotation.x = Math.PI / 2
  barrel.position.set(obstacle.center.x, obstacle.center.y, 0)
  tagDebugObject(barrel, {
    category: "holes",
    label: `${obstacle.componentId ?? obstacle.connectedTo[0] ?? "Hole"} · plated hole`,
    layers: obstacle.layers,
    span: {
      fromLayer: obstacle.layers[0] ?? "top",
      height: BOARD_THICKNESS + 0.03,
      toLayer: obstacle.layers.at(-1) ?? "bottom",
    },
  })
  return barrel
}

const addTraceSegment = (input: TraceSegmentInput): boolean => {
  const end = input.end
  const start = input.start
  const length = Math.hypot(end.x - start.x, end.y - start.y)
  if (length < MINIMUM_TRACE_SEGMENT_LENGTH) return false

  const segment = new THREE.Mesh(
    new THREE.BoxGeometry(
      length,
      Math.max(input.width, 0.06),
      COPPER_THICKNESS,
    ),
    input.material,
  )
  segment.position.set(
    (start.x + end.x) / 2,
    (start.y + end.y) / 2,
    getLayerZ(input.layer, input.layerCount),
  )
  segment.rotation.z = Math.atan2(end.y - start.y, end.x - start.x)
  tagDebugObject(segment, {
    category: "traces",
    label: `${input.net} · ${input.layer}`,
    layer: input.layer,
    net: input.net,
  })
  input.root.add(segment)

  for (const point of [start, end]) {
    const joint = new THREE.Mesh(
      new THREE.CylinderGeometry(
        Math.max(input.width, 0.06) / 2,
        Math.max(input.width, 0.06) / 2,
        COPPER_THICKNESS,
        18,
      ),
      input.material,
    )
    joint.rotation.x = Math.PI / 2
    joint.position.set(
      point.x,
      point.y,
      getLayerZ(input.layer, input.layerCount),
    )
    tagDebugObject(joint, {
      category: "traces",
      label: `${input.net} · ${input.layer}`,
      layer: input.layer,
      net: input.net,
    })
    input.root.add(joint)
  }
  return true
}

const addVia = (input: ViaInput): void => {
  const radius = Math.max((input.outerDiameter ?? 0.55) / 2, 0.15)
  const holeRadius = Math.max((input.holeDiameter ?? radius) / 2, 0.07)
  const fromLayerZ = getLayerZ(input.fromLayer, input.layerCount)
  const toLayerZ = getLayerZ(input.toLayer, input.layerCount)
  const height = Math.max(
    Math.abs(toLayerZ - fromLayerZ),
    COPPER_THICKNESS,
  )
  const centerZ = (fromLayerZ + toLayerZ) / 2

  const barrel = new THREE.Mesh(
    new THREE.CylinderGeometry(
      holeRadius + 0.025,
      holeRadius + 0.025,
      height,
      28,
      1,
      true,
    ),
    input.material,
  )
  barrel.rotation.x = Math.PI / 2
  barrel.position.set(input.x, input.y, centerZ)
  tagDebugObject(barrel, {
    category: "vias",
    label: `${input.net} · via ${input.fromLayer} → ${input.toLayer}`,
    layers: getLayersInSpan(
      input.fromLayer,
      input.toLayer,
      input.layerCount,
    ),
    net: input.net,
    span: {
      fromLayer: input.fromLayer,
      height,
      toLayer: input.toLayer,
    },
  })
  input.root.add(barrel)

  for (const [layer, z] of [
    [input.fromLayer, fromLayerZ],
    [input.toLayer, toLayerZ],
  ] as const) {
    const annulus = new THREE.Mesh(
      new THREE.RingGeometry(holeRadius, radius, 28),
      input.material,
    )
    annulus.position.set(input.x, input.y, z + Math.sign(z || 1) * 0.003)
    tagDebugObject(annulus, {
      category: "vias",
      label: `${input.net} · via ${layer}`,
      layer,
      net: input.net,
    })
    input.root.add(annulus)
  }
}

const getRoutePosition = (
  routePoint: SimplifiedPcbTrace["route"][number],
): { x: number; y: number } | null => {
  if (!("x" in routePoint) || !("y" in routePoint)) return null
  return { x: routePoint.x, y: routePoint.y }
}

const getSegmentLayer = (
  start: SimplifiedPcbTrace["route"][number],
  end: SimplifiedPcbTrace["route"][number],
): string | null => {
  if (start.route_type === "wire") return start.layer
  if (start.route_type === "via") return start.to_layer
  if (end.route_type === "wire") return end.layer
  if (end.route_type === "via") return end.from_layer
  return null
}

const getSegmentWidth = (
  start: SimplifiedPcbTrace["route"][number],
  end: SimplifiedPcbTrace["route"][number],
  fallback: number,
): number => {
  if (start.route_type === "wire") return start.width
  if (end.route_type === "wire") return end.width
  return fallback
}

const addJumper = (
  routePoint: Extract<
    SimplifiedPcbTrace["route"][number],
    { route_type: "jumper" }
  >,
  net: string,
  root: THREE.Group,
): void => {
  const center = {
    x: (routePoint.start.x + routePoint.end.x) / 2,
    y: (routePoint.start.y + routePoint.end.y) / 2,
  }
  const length = Math.hypot(
    routePoint.end.x - routePoint.start.x,
    routePoint.end.y - routePoint.start.y,
  )
  const angle = Math.atan2(
    routePoint.end.y - routePoint.start.y,
    routePoint.end.x - routePoint.start.x,
  )
  let width = 0.8
  if (routePoint.footprint === "1206x4_pair") width = 1.6
  const body = new THREE.Mesh(
    new RoundedBoxGeometry(Math.max(length * 0.48, 1), width, 0.38, 3, 0.08),
    new THREE.MeshPhysicalMaterial({
      clearcoat: 0.25,
      color: 0xf1eee6,
      roughness: 0.52,
    }),
  )
  body.position.set(
    center.x,
    center.y,
    getLayerZ(routePoint.layer, 2) + 0.23,
  )
  body.rotation.z = angle
  body.castShadow = true
  tagDebugObject(body, {
    category: "jumpers",
    label: `${net} · jumper`,
    layer: routePoint.layer,
    net,
  })
  root.add(body)
}

const addTraces = (
  srj: SimpleRouteJson,
  traces: SimplifiedPcbTrace[],
  root: THREE.Group,
): void => {
  const materials = new Map<string, THREE.MeshPhysicalMaterial>()
  const materialForLayer = (
    layer: string,
    net: string,
  ): THREE.MeshPhysicalMaterial => {
    const materialKey = `${layer}:${net}`
    const existing = materials.get(materialKey)
    if (existing) return existing
    const material = createCopperMaterial(layer)
    materials.set(materialKey, material)
    return material
  }

  for (const trace of traces) {
    for (let index = 1; index < trace.route.length; index++) {
      const startRoutePoint = trace.route[index - 1]
      const endRoutePoint = trace.route[index]
      const start = getRoutePosition(startRoutePoint)
      const end = getRoutePosition(endRoutePoint)
      const layer = getSegmentLayer(startRoutePoint, endRoutePoint)
      if (!start || !end || !layer) continue

      addTraceSegment({
        end,
        layer,
        layerCount: srj.layerCount,
        material: materialForLayer(layer, trace.connection_name),
        net: trace.connection_name,
        root,
        start,
        width: getSegmentWidth(
          startRoutePoint,
          endRoutePoint,
          srj.nominalTraceWidth ?? srj.minTraceWidth,
        ),
      })
    }

    for (const routePoint of trace.route) {
      if (routePoint.route_type === "via") {
        addVia({
          fromLayer: routePoint.from_layer,
          holeDiameter: routePoint.via_hole_diameter,
          layerCount: srj.layerCount,
          material: materialForLayer("top", trace.connection_name),
          net: trace.connection_name,
          outerDiameter: routePoint.via_diameter,
          root,
          toLayer: routePoint.to_layer,
          x: routePoint.x,
          y: routePoint.y,
        })
      } else if (routePoint.route_type === "jumper") {
        addJumper(routePoint, trace.connection_name, root)
      } else if (routePoint.route_type === "through_obstacle") {
        const layer = routePoint.from_layer
        addTraceSegment({
          end: routePoint.end,
          layer,
          layerCount: srj.layerCount,
          material: materialForLayer(layer, trace.connection_name),
          net: trace.connection_name,
          root,
          start: routePoint.start,
          width: routePoint.width,
        })
      }
    }
  }
}

const addInferredBodies = (
  obstacles: Obstacle[],
  root: THREE.Group,
): void => {
  for (const group of getInferredBodyGroups(obstacles)) {
    const componentId = group.componentId
    const pads = group.pads
    const minX = Math.min(...pads.map((pad) => pad.center.x - pad.width / 2))
    const maxX = Math.max(...pads.map((pad) => pad.center.x + pad.width / 2))
    const minY = Math.min(...pads.map((pad) => pad.center.y - pad.height / 2))
    const maxY = Math.max(...pads.map((pad) => pad.center.y + pad.height / 2))
    const width = Math.max((maxX - minX) * 0.54, 0.55)
    const height = Math.max((maxY - minY) * 0.54, 0.55)
    let bodyColor = 0xeeeae0
    if (pads.length > 3) bodyColor = 0x34383b
    const body = new THREE.Mesh(
      new RoundedBoxGeometry(width, height, 0.62, 4, 0.1),
      new THREE.MeshPhysicalMaterial({
        clearcoat: 0.12,
        color: bodyColor,
        roughness: 0.5,
      }),
    )
    body.position.set(
      (minX + maxX) / 2,
      (minY + maxY) / 2,
      BOARD_THICKNESS / 2 + 0.35,
    )
    body.castShadow = true
    tagDebugObject(body, {
      category: "inferredBodies",
      label: `${componentId} · inferred body`,
      layer: "top",
    })
    root.add(body)
  }
}

/**
 * Groups pads that share a componentId. These groups are only candidates for
 * synthetic debug bodies; they are never treated as authored SRJ geometry.
 */
const getInferredBodyGroups = (obstacles: Obstacle[]): InferredBodyGroup[] => {
  const groups = new Map<string, Obstacle[]>()
  for (const obstacle of obstacles) {
    if (!obstacle.componentId) continue
    const group = groups.get(obstacle.componentId) ?? []
    group.push(obstacle)
    groups.set(obstacle.componentId, group)
  }

  const inferredBodyGroups: InferredBodyGroup[] = []
  for (const [componentId, pads] of groups) {
    if (pads.length < 2) continue
    inferredBodyGroups.push({ componentId, pads })
  }
  return inferredBodyGroups
}

/** Builds one scene graph for the selected Start or Final trace snapshot. */
const buildScene = (
  srj: SimpleRouteJson,
  traces: SimplifiedPcbTrace[],
): SceneBuildResult => {
  const root = new THREE.Group()
  const metrics = getBoardMetrics(srj)
  const board = new THREE.Mesh(
    makeBoardGeometry(srj, traces),
    new THREE.MeshPhysicalMaterial({
      clearcoat: 0.24,
      clearcoatRoughness: 0.62,
      color: 0x285b50,
      metalness: 0.02,
      roughness: 0.72,
    }),
  )
  board.castShadow = true
  board.receiveShadow = true
  tagDebugObject(board, { category: "board" })
  root.add(board)

  const materials = new Map<string, THREE.MeshPhysicalMaterial>()
  for (const obstacle of srj.obstacles) {
    for (const layer of obstacle.layers) {
      const material = materials.get(layer) ?? createCopperMaterial(layer)
      materials.set(layer, material)
      root.add(createPad(obstacle, layer, srj.layerCount, material))
    }

    if (isThroughHole(obstacle)) {
      const barrelMaterial = materials.get("top")
      if (!barrelMaterial) {
        throw new Error(
          `Cannot render plated hole without a top copper layer: ${obstacle.componentId ?? "unknown component"}`,
        )
      }
      root.add(createViaBarrel(obstacle, barrelMaterial))
    }
  }

  addInferredBodies(srj.obstacles, root)
  addTraces(srj, traces, root)

  return {
    boardCenter: metrics.center,
    boardSize: { height: metrics.height, width: metrics.width },
    root,
  }
}

const getLayerOffset = (
  layer: string,
  layerCount: number,
  layerGap: number,
): number =>
  getPcb3dExplodedLayerZ(layer, layerCount, layerGap) -
  getLayerZ(layer, layerCount)

/**
 * Moves single-layer objects to their exploded copper plane. Spanning objects
 * remain centered between their endpoint layers and stretch to connect them.
 */
const applyLayerGap = (
  root: THREE.Group,
  layerCount: number,
  layerGap: number,
): void => {
  root.traverse((object) => {
    const metadata = getDebugMetadata(object)
    if (!metadata) return
    const layer = metadata.layer
    const baseZ = metadata.baseZ
    const span = metadata.span

    if (span) {
      const fromOffset = getLayerOffset(span.fromLayer, layerCount, layerGap)
      const toOffset = getLayerOffset(span.toLayer, layerCount, layerGap)
      object.position.z = baseZ + (fromOffset + toOffset) / 2
      object.scale.y =
        (span.height + Math.abs(fromOffset - toOffset)) / span.height
      return
    }

    if (layer) {
      object.position.z = baseZ + getLayerOffset(layer, layerCount, layerGap)
    }
  })
}

/** Applies category and copper-layer visibility to every tagged scene object. */
const applyVisibility = (
  root: THREE.Group,
  visibility: ViewerVisibility,
  visibleLayers: Set<string>,
): void => {
  root.traverse((object) => {
    const metadata = getDebugMetadata(object)
    if (!metadata) return
    const layerVisible =
      metadata.layers.length === 0 ||
      metadata.layers.some((layer) => visibleLayers.has(layer))
    object.visible = visibility[metadata.category] && layerVisible
  })
}

/**
 * Builds the real Three.js scene and reports each debug object's visibility.
 * This is intentionally exported for focused tests of the authored-versus-
 * inferred geometry policy without requiring a WebGL browser environment.
 */
export const getPcb3dSceneObjectStates = (
  srj: SimpleRouteJson,
  traces: SimplifiedPcbTrace[],
  options: InferredBodyVisibilityOptions = {},
): Pcb3dSceneObjectState[] => {
  const sceneBuild = buildScene(srj, traces)
  const visibility = createViewerVisibility(options.includeInferredBodies)
  const visibleLayers = new Set(getLayerNames(srj.layerCount))
  applyVisibility(sceneBuild.root, visibility, visibleLayers)

  const objectStates: Pcb3dSceneObjectState[] = []
  sceneBuild.root.traverse((object) => {
    const metadata = getDebugMetadata(object)
    if (!metadata) return
    objectStates.push({
      category: metadata.category,
      label: metadata.label,
      visible: object.visible,
    })
  })
  disposeObject(sceneBuild.root)
  return objectStates
}

const applyAppearance = (
  root: THREE.Group,
  boardOpacity: number,
  focusedNet: string | null,
): void => {
  root.traverse((object) => {
    const metadata = getDebugMetadata(object)
    if (!metadata) return
    for (const material of getObjectMaterials(object)) {
      if (metadata.category === "board") {
        setMaterialOpacity(material, boardOpacity, boardOpacity >= 0.9)
      } else if (metadata.category === "inferredBodies") {
        setMaterialOpacity(material, 0.78, true)
      } else if (
        metadata.category === "traces" ||
        metadata.category === "vias"
      ) {
        let opacity = 1
        if (focusedNet && metadata.net !== focusedNet) opacity = 0.1
        setMaterialOpacity(material, opacity, opacity >= 0.9)
      }
    }
  })
}

const disposeObject = (object: THREE.Object3D): void => {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return
    child.geometry.dispose()
    let materials: THREE.Material[] = [child.material]
    if (Array.isArray(child.material)) materials = child.material
    for (const material of materials) material.dispose()
  })
}

/** Fits the complete exploded board by projecting its extents into camera space. */
const frameBoard = (input: FrameBoardInput): void => {
  const aspect = Math.max(
    input.viewport.width / Math.max(input.viewport.height, 1),
    0.1,
  )
  const verticalFov = THREE.MathUtils.degToRad(input.camera.fov)
  const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * aspect)
  const viewingDirection = new THREE.Vector3(0.28, -0.46, 0.84).normalize()
  const screenRight = new THREE.Vector3()
    .crossVectors(input.camera.up, viewingDirection)
    .normalize()
  const screenUp = new THREE.Vector3()
    .crossVectors(viewingDirection, screenRight)
    .normalize()
  const halfWidth = input.boardSize.width / 2
  const halfHeight = input.boardSize.height / 2
  const halfThickness = input.depth / 2 + 0.7
  const projectedHalfWidth =
    Math.abs(screenRight.x) * halfWidth +
    Math.abs(screenRight.y) * halfHeight +
    Math.abs(screenRight.z) * halfThickness
  const projectedHalfHeight =
    Math.abs(screenUp.x) * halfWidth +
    Math.abs(screenUp.y) * halfHeight +
    Math.abs(screenUp.z) * halfThickness
  const projectedHalfDepth =
    Math.abs(viewingDirection.x) * halfWidth +
    Math.abs(viewingDirection.y) * halfHeight +
    Math.abs(viewingDirection.z) * halfThickness
  const distance =
    Math.max(
      projectedHalfHeight / Math.tan(verticalFov / 2),
      projectedHalfWidth / Math.tan(horizontalFov / 2),
      4,
    ) *
      1.12 +
    projectedHalfDepth

  input.controls.target.copy(input.boardCenter)
  input.camera.position
    .copy(input.boardCenter)
    .addScaledVector(viewingDirection, distance)
  input.camera.near = Math.max(distance / 1000, 0.02)
  input.camera.far = Math.max(distance * 30, 1000)
  input.camera.updateProjectionMatrix()
  input.controls.minDistance = Math.max(
    Math.min(input.boardSize.width, input.boardSize.height) * 0.06,
    0.5,
  )
  input.controls.maxDistance = distance * 12
  input.controls.update()
}

/**
 * Owns the Three.js lifecycle for one SRJ and trace snapshot. React keeps this
 * initializer isolated from lightweight visibility, appearance, and layer-gap
 * updates so those controls never rebuild WebGL or reset the camera.
 */
const initializePcb3dViewer = (
  input: ViewerInitializationInput,
): ViewerInitialization => {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0xfafafa)
  const camera = new THREE.PerspectiveCamera(32, 1, 0.02, 1000)
  const renderer = new THREE.WebGLRenderer({
    alpha: false,
    antialias: true,
    canvas: input.canvas,
    powerPreference: "high-performance",
  })
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.04

  const controls = new OrbitControls(camera, input.canvas)
  controls.enableDamping = true
  controls.dampingFactor = 0.075
  controls.rotateSpeed = 0.62
  controls.panSpeed = 0.72
  controls.zoomSpeed = 0.82
  controls.screenSpacePanning = true

  const sceneBuild = buildScene(input.srj, input.traces)
  scene.add(sceneBuild.root)
  scene.add(new THREE.HemisphereLight(0xffffff, 0xb7b3aa, 2.25))

  const keyLight = new THREE.DirectionalLight(0xffffff, 4.2)
  keyLight.position.set(
    sceneBuild.boardCenter.x - sceneBuild.boardSize.width * 0.5,
    sceneBuild.boardCenter.y - sceneBuild.boardSize.height * 0.65,
    Math.max(sceneBuild.boardSize.width, sceneBuild.boardSize.height) * 0.9,
  )
  keyLight.castShadow = true
  keyLight.shadow.mapSize.set(2048, 2048)
  keyLight.shadow.bias = -0.00015
  const shadowExtent = Math.max(
    sceneBuild.boardSize.width,
    sceneBuild.boardSize.height,
  )
  keyLight.shadow.camera.left = -shadowExtent
  keyLight.shadow.camera.right = shadowExtent
  keyLight.shadow.camera.top = shadowExtent
  keyLight.shadow.camera.bottom = -shadowExtent
  scene.add(keyLight)

  const fillLight = new THREE.DirectionalLight(0xdde9ff, 1.5)
  fillLight.position.set(
    sceneBuild.boardCenter.x + sceneBuild.boardSize.width,
    sceneBuild.boardCenter.y + sceneBuild.boardSize.height,
    sceneBuild.boardSize.width * 0.35,
  )
  scene.add(fillLight)

  const shadowPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(
      sceneBuild.boardSize.width * 2.4,
      sceneBuild.boardSize.height * 2.4,
    ),
    new THREE.ShadowMaterial({ color: 0x53605d, opacity: 0.09 }),
  )
  shadowPlane.position.set(
    sceneBuild.boardCenter.x,
    sceneBuild.boardCenter.y,
    -BOARD_THICKNESS / 2 - 1.4,
  )
  shadowPlane.receiveShadow = true
  scene.add(shadowPlane)

  const fit = (explodedLayerGap: number): void => {
    const containerBounds = input.container.getBoundingClientRect()
    const height = containerBounds.height
    const width = containerBounds.width
    if (width <= 0 || height <= 0) return
    frameBoard({
      boardCenter: sceneBuild.boardCenter,
      boardSize: sceneBuild.boardSize,
      camera,
      controls,
      depth:
        BOARD_THICKNESS +
        explodedLayerGap * Math.max(input.srj.layerCount - 1, 0),
      viewport: { height, width },
    })
    input.onCameraStateChange({
      position: camera.position.clone(),
      target: controls.target.clone(),
    })
  }

  const runtime: ViewerRuntime = {
    camera,
    controls,
    fit,
    sceneBuild,
    shadowPlane,
  }
  applyLayerGap(sceneBuild.root, input.srj.layerCount, input.layerGap)
  applyVisibility(sceneBuild.root, input.visibility, input.visibleLayers)
  applyAppearance(sceneBuild.root, input.boardOpacity, input.focusedNet)

  let animationFrame = 0
  let hasFramed = false
  let framedAspect: number | null = null
  const resize = (): void => {
    const containerBounds = input.container.getBoundingClientRect()
    const height = containerBounds.height
    const width = containerBounds.width
    if (width <= 0 || height <= 0) return
    const nextAspect = width / height
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.setSize(width, height, false)
    camera.aspect = nextAspect
    camera.updateProjectionMatrix()
    const aspectChangedMaterially =
      framedAspect !== null &&
      Math.abs(Math.log(nextAspect / framedAspect)) >
        CAMERA_REFRAME_ASPECT_THRESHOLD

    if (!hasFramed && input.preservedCamera) {
      camera.position.copy(input.preservedCamera.position)
      controls.target.copy(input.preservedCamera.target)
      controls.update()
      hasFramed = true
    } else if (!hasFramed || aspectChangedMaterially) {
      fit(input.layerGap)
      hasFramed = true
    }
    framedAspect = nextAspect
  }

  const raycaster = new THREE.Raycaster()
  const pointer = new THREE.Vector2()
  let pointerDown = { x: 0, y: 0 }
  const getDebugIntersection = (event: PointerEvent): THREE.Object3D | null => {
    const bounds = input.canvas.getBoundingClientRect()
    pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1
    pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1
    raycaster.setFromCamera(pointer, camera)
    const intersections = raycaster.intersectObject(sceneBuild.root, true)
    const intersection = intersections.find((candidate) => {
      const metadata = getDebugMetadata(candidate.object)
      return candidate.object.visible && Boolean(metadata?.label)
    })
    if (!intersection) return null
    return intersection.object
  }
  const handlePointerMove = (event: PointerEvent): void => {
    const object = getDebugIntersection(event)
    const bounds = input.container.getBoundingClientRect()
    if (!object) {
      input.canvas.style.cursor = "grab"
      input.onHoverDetailsChange(null)
      return
    }

    const metadata = getDebugMetadata(object)
    if (!metadata?.label) return
    input.canvas.style.cursor = "pointer"
    input.onHoverDetailsChange({
      label: metadata.label,
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
    })
  }
  const handlePointerUp = (event: PointerEvent): void => {
    const distance = Math.hypot(
      event.clientX - pointerDown.x,
      event.clientY - pointerDown.y,
    )
    if (distance > POINTER_CLICK_TOLERANCE) return
    const object = getDebugIntersection(event)
    if (!object) return
    const metadata = getDebugMetadata(object)
    const net = metadata?.net
    if (!net) return
    input.onFocusedNetToggle(net)
  }
  const handlePointerDown = (event: PointerEvent): void => {
    pointerDown = { x: event.clientX, y: event.clientY }
    input.onHoverDetailsChange(null)
  }
  const handlePointerLeave = (): void => {
    input.canvas.style.cursor = "grab"
    input.onHoverDetailsChange(null)
  }

  input.canvas.addEventListener("pointerdown", handlePointerDown)
  input.canvas.addEventListener("pointermove", handlePointerMove)
  input.canvas.addEventListener("pointerup", handlePointerUp)
  input.canvas.addEventListener("pointerleave", handlePointerLeave)
  const resizeObserver = new ResizeObserver(resize)
  resizeObserver.observe(input.container)
  resize()

  const render = (): void => {
    controls.update()
    renderer.render(scene, camera)
    animationFrame = window.requestAnimationFrame(render)
  }
  render()

  const dispose = (): void => {
    input.onCameraStateChange({
      position: camera.position.clone(),
      target: controls.target.clone(),
    })
    window.cancelAnimationFrame(animationFrame)
    resizeObserver.disconnect()
    input.canvas.removeEventListener("pointerdown", handlePointerDown)
    input.canvas.removeEventListener("pointermove", handlePointerMove)
    input.canvas.removeEventListener("pointerup", handlePointerUp)
    input.canvas.removeEventListener("pointerleave", handlePointerLeave)
    controls.dispose()
    disposeObject(scene)
    renderer.dispose()
  }

  return { dispose, runtime }
}

/**
 * Counts authored SRJ geometry represented by the viewer. Synthetic bodies
 * are excluded unless the caller explicitly opts in, matching the UI default.
 */
export const getPcb3dRenderSummary = (
  srj: SimpleRouteJson,
  traces: SimplifiedPcbTrace[],
  options: InferredBodyVisibilityOptions = {},
): RenderSummary => {
  let inferredBodyCount = 0
  if (options.includeInferredBodies) {
    inferredBodyCount = getInferredBodyGroups(srj.obstacles).length
  }
  const summary: RenderSummary = {
    boards: 1,
    holes: srj.obstacles.filter(isThroughHole).length,
    inferredBodies: inferredBodyCount,
    jumpers: 0,
    pads: srj.obstacles.reduce(
      (count, obstacle) => count + new Set(obstacle.layers).size,
      0,
    ),
    traceSegments: 0,
    vias: 0,
  }

  for (const trace of traces) {
    for (let index = 1; index < trace.route.length; index++) {
      const start = getRoutePosition(trace.route[index - 1])
      const end = getRoutePosition(trace.route[index])
      if (
        start &&
        end &&
        Math.hypot(end.x - start.x, end.y - start.y) >
          MINIMUM_TRACE_SEGMENT_LENGTH
      ) {
        summary.traceSegments += 1
      }
    }
    for (const point of trace.route) {
      if (point.route_type === "via") summary.vias += 1
      if (point.route_type === "jumper") summary.jumpers += 1
      if (point.route_type === "through_obstacle") summary.traceSegments += 1
    }
  }
  return summary
}

/**
 * Renders authored SRJ geometry for Start and Final solver states in an
 * interactive Three.js view. Pad-derived bodies are synthetic debug aids and
 * remain hidden until the user explicitly enables Inferred bodies.
 */
export const Pcb3dViewer = (props: Pcb3dViewerProps): ReactElement => {
  const srj = props.srj
  const inputTraces = props.inputTraces
  const finalTraces = props.finalTraces
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const runtimeRef = useRef<ViewerRuntime | null>(null)
  const cameraStateRef = useRef<CameraState | null>(null)
  const [snapshot, setSnapshot] = useState<ViewerSnapshot>("input")
  const [layerGap, setLayerGap] = useState(0)
  const [boardOpacity, setBoardOpacity] = useState(0.42)
  const [visibility, setVisibility] = useState<ViewerVisibility>(() =>
    createViewerVisibility(),
  )
  const layerNames = useMemo(() => getLayerNames(srj.layerCount), [srj.layerCount])
  const [visibleLayers, setVisibleLayers] = useState<Set<string>>(
    () => new Set(layerNames),
  )
  const [visibilityOpen, setVisibilityOpen] = useState(false)
  const [hoverDetails, setHoverDetails] = useState<HoverDetails | null>(null)
  const [focusedNet, setFocusedNet] = useState<string | null>(null)
  let traces = inputTraces
  if (snapshot === "final" && finalTraces) traces = finalTraces
  const renderSummary = useMemo(
    () =>
      getPcb3dRenderSummary(srj, traces, {
        includeInferredBodies: visibility.inferredBodies,
      }),
    [srj, traces, visibility.inferredBodies],
  )

  useEffect(() => {
    setVisibleLayers(new Set(layerNames))
  }, [layerNames])

  useEffect(() => {
    if (finalTraces || snapshot === "input") return
    setSnapshot("input")
    setFocusedNet(null)
  }, [finalTraces, snapshot])

  useEffect(() => {
    const container = containerRef.current
    const canvas = canvasRef.current
    if (!container || !canvas) return
    const initialization = initializePcb3dViewer({
      boardOpacity,
      canvas,
      container,
      focusedNet,
      layerGap,
      onCameraStateChange: (cameraState) => {
        cameraStateRef.current = cameraState
      },
      onFocusedNetToggle: (net) => {
        setFocusedNet((current) => {
          if (current === net) return null
          return net
        })
      },
      onHoverDetailsChange: setHoverDetails,
      preservedCamera: cameraStateRef.current,
      srj,
      traces,
      visibility,
      visibleLayers,
    })
    runtimeRef.current = initialization.runtime
    return () => {
      const currentRuntime = runtimeRef.current
      if (currentRuntime?.camera === initialization.runtime.camera) {
        runtimeRef.current = null
      }
      initialization.dispose()
    }
  }, [srj, traces])

  useEffect(() => {
    const runtime = runtimeRef.current
    if (!runtime) return
    applyLayerGap(runtime.sceneBuild.root, srj.layerCount, layerGap)
    const bottomLayer = layerNames.at(-1) ?? "top"
    runtime.shadowPlane.position.z =
      -BOARD_THICKNESS / 2 -
      1.4 +
      Math.min(getLayerOffset(bottomLayer, srj.layerCount, layerGap), 0)
  }, [layerGap, layerNames, srj.layerCount])

  useEffect(() => {
    const runtime = runtimeRef.current
    if (!runtime) return
    applyVisibility(runtime.sceneBuild.root, visibility, visibleLayers)
  }, [visibility, visibleLayers])

  useEffect(() => {
    const runtime = runtimeRef.current
    if (!runtime) return
    applyAppearance(runtime.sceneBuild.root, boardOpacity, focusedNet)
  }, [boardOpacity, focusedNet])

  let tooltipTransform = "translateX(12px)"
  if (hoverDetails) {
    const containerWidth =
      containerRef.current?.clientWidth ?? DEFAULT_VIEWPORT_WIDTH
    if (hoverDetails.x > containerWidth - TOOLTIP_WIDTH) {
      tooltipTransform = "translateX(-100%)"
    }
  }

  const visibilityButtonClassName = clsx(
    "rounded-md px-2 py-1 font-medium",
    visibilityOpen && "bg-slate-900 text-white",
    !visibilityOpen && "hover:bg-slate-100",
  )

  return (
    <div
      ref={containerRef}
      className="relative h-[clamp(420px,68vh,720px)] min-h-0 w-full overflow-hidden rounded-xl bg-[#fafafa] text-[11px] text-slate-700"
      data-board-opacity={boardOpacity}
      data-final-available={Boolean(finalTraces)}
      data-layer-gap={layerGap}
      data-snapshot={snapshot}
      data-testid="pcb-3d-viewer"
    >
      <canvas
        ref={canvasRef}
        aria-label="Interactive 3D circuit view. Drag to orbit, right-drag to pan, scroll to zoom, and click routed copper to focus its net."
        className="block h-full w-full touch-none"
        data-boards={renderSummary.boards}
        data-holes={renderSummary.holes}
        data-inferred-bodies={renderSummary.inferredBodies}
        data-jumpers={renderSummary.jumpers}
        data-pads={renderSummary.pads}
        data-trace-segments={renderSummary.traceSegments}
        data-vias={renderSummary.vias}
      />

      <div className="pointer-events-none absolute inset-x-0 top-3 flex items-start justify-between px-3">
        <div className="pointer-events-auto flex rounded-lg border border-black/10 bg-white/90 p-0.5 shadow-sm backdrop-blur-md">
          {SNAPSHOT_OPTIONS.map((option) => {
            const disabled = option.id === "final" && !finalTraces
            let title = ""
            if (disabled) title = "Final is available after a successful solve"
            const buttonClassName = clsx(
              "rounded-md px-3 py-1.5 font-medium capitalize transition-colors",
              snapshot === option.id && "bg-slate-900 text-white shadow-sm",
              snapshot !== option.id &&
                "text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent",
            )
            return (
              <button
                key={option.id}
                type="button"
                className={buttonClassName}
                disabled={disabled}
                onClick={() => {
                  setSnapshot(option.id)
                  setFocusedNet(null)
                }}
                title={title}
              >
                {option.label}
              </button>
            )
          })}
        </div>

        <button
          type="button"
          className="pointer-events-auto rounded-lg border border-black/10 bg-white/90 px-2.5 py-1.5 font-medium shadow-sm backdrop-blur-md hover:bg-white"
          onClick={() => runtimeRef.current?.fit(layerGap)}
          title="Frame the complete circuit"
        >
          Fit
        </button>
      </div>

      {focusedNet && (
        <button
          type="button"
          className="absolute left-3 top-14 max-w-[calc(100%-24px)] truncate rounded-full border border-amber-500/20 bg-white/95 px-2.5 py-1 font-medium text-amber-800 shadow-sm"
          onClick={() => setFocusedNet(null)}
          title="Clear focused net"
        >
          {focusedNet} ×
        </button>
      )}

      {hoverDetails && (
        <div
          className="pointer-events-none absolute max-w-64 truncate rounded-md bg-slate-900/90 px-2 py-1 text-white shadow-sm"
          style={{
            left: hoverDetails.x,
            top: Math.max(hoverDetails.y - 28, 48),
            transform: tooltipTransform,
          }}
        >
          {hoverDetails.label}
        </div>
      )}

      <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center px-3">
        <div className="pointer-events-auto relative flex max-w-full flex-wrap items-center justify-center gap-x-3 gap-y-2 rounded-xl border border-black/10 bg-white/95 px-3 py-2 shadow-sm backdrop-blur-md">
          <label className="flex items-center gap-2 whitespace-nowrap">
            <span className="font-medium text-slate-600">Layer gap</span>
            <input
              aria-label="Layer gap"
              className="h-1 w-24 cursor-pointer accent-slate-700 sm:w-32"
              type="range"
              min="0"
              max="6"
              step="0.1"
              value={layerGap}
              onChange={(event) => setLayerGap(Number(event.target.value))}
            />
            <span className="w-10 text-right tabular-nums text-slate-400">
              {layerGap.toFixed(1)}mm
            </span>
          </label>
          <span className="hidden h-4 w-px bg-slate-200 sm:block" />
          <label className="flex items-center gap-2 whitespace-nowrap">
            <span className="font-medium text-slate-600">Board</span>
            <input
              aria-label="Board opacity"
              className="h-1 w-20 cursor-pointer accent-slate-700 sm:w-24"
              type="range"
              min="0.08"
              max="1"
              step="0.01"
              value={boardOpacity}
              onChange={(event) => setBoardOpacity(Number(event.target.value))}
            />
            <span className="w-7 text-right tabular-nums text-slate-400">
              {Math.round(boardOpacity * 100)}%
            </span>
          </label>
          <span className="hidden h-4 w-px bg-slate-200 sm:block" />
          <button
            type="button"
            className={visibilityButtonClassName}
            onClick={() => setVisibilityOpen((open) => !open)}
            aria-expanded={visibilityOpen}
          >
            Visibility
          </button>

          {visibilityOpen && (
            <div className="absolute bottom-[calc(100%+8px)] right-0 grid min-w-48 grid-cols-2 gap-x-4 gap-y-1 rounded-xl border border-black/10 bg-white/95 p-3 shadow-lg backdrop-blur-md sm:right-auto">
              <div className="col-span-2 mb-1 flex items-center justify-between">
                <span className="font-semibold text-slate-800">Visible geometry</span>
                <button
                  type="button"
                  className="text-slate-400 hover:text-slate-700"
                  onClick={() => {
                    setVisibility(createViewerVisibility())
                    setVisibleLayers(new Set(layerNames))
                  }}
                >
                  Reset
                </button>
              </div>
              {VISIBILITY_OPTIONS.map((option) => (
                <label key={option.id} className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={visibility[option.id]}
                    onChange={(event) =>
                      setVisibility((current) => ({
                        ...current,
                        [option.id]: event.target.checked,
                      }))
                    }
                  />
                  {option.label}
                </label>
              ))}
              <div className="col-span-2 my-1 h-px bg-slate-200" />
              {layerNames.map((layer) => (
                <label key={layer} className="flex items-center gap-1.5 capitalize">
                  <input
                    type="checkbox"
                    checked={visibleLayers.has(layer)}
                    onChange={(event) => {
                      const next = new Set(visibleLayers)
                      if (event.target.checked) next.add(layer)
                      else next.delete(layer)
                      setVisibleLayers(next)
                    }}
                  />
                  {layer.replace("inner", "Inner ")}
                </label>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
