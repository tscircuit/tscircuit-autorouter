import {
  doSegmentsIntersect,
  isPointInsidePolygon,
  segmentToSegmentMinDistance,
  pointToSegmentDistance,
  segmentToBoundsMinDistance,
} from "@tscircuit/math-utils"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { isObstacleConnectedToRoute } from "../TraceWidthSolver/isObstacleConnectedToRoute"
import type { HighDensityBoardGeometry } from "lib/types/high-density-board-geometry"
import type {
  HighDensityIntraNodeRoute,
  NodeWithPortPoints,
  PortPoint,
} from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"
import { getConnectionPortPointPairs } from "lib/utils/getConnectionPortPointPairs"
import { getPipeline9RouteCopperGeometry } from "../../autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"
import { areNodePortPointPairsConnectedByRoutes } from "./repairDisconnectedSameRootPortPoints"

type Point = { x: number; y: number; z: number }
type Bounds = HighDensityBoardGeometry["bounds"]
type OutlinePoint = { x: number; y: number }
type BoardCertificate = {
  bounds: Bounds
  outline: OutlinePoint[]
  rectangular: boolean
}
export type StraightRoutePreflightContext = {
  readonly originalBounds: Readonly<Bounds>
  readonly surroundingRoutes: readonly HighDensityIntraNodeRoute[]
  readonly minTraceToHoleEdgeClearance?: number
  readonly minTraceToPadEdgeClearance?: number
  readonly allowBlindAndBuriedVias?: boolean
}
const nativePreloadFreeContexts = new WeakSet<object>()
type Segment = {
  A: Point
  B: Point
  connectionName: string
  rootConnectionName?: string
}
type Task = Segment & {
  A: PortPoint
  B: PortPoint
  path: Point[]
}
type StraightRoutePreflightBoardRules = {
  minTraceToHoleEdgeClearance?: number
  minTraceToPadEdgeClearance?: number
}
type Params = {
  nodeWithPortPoints: NodeWithPortPoints
  boardGeometry?: HighDensityBoardGeometry
  obstacles?: Obstacle[]
  layerCount?: number
  connMap?: ConnectivityMap
  traceWidth?: number
  viaDiameter?: number
  obstacleMargin?: number
  straightRoutePreflightContext?: StraightRoutePreflightContext
  preserveTerminalPcbPortIds?: boolean
}

/** Created only after Pipeline9's native expanded preload query is empty. */
export function createStraightRoutePreflightContext(
  originalBounds: Bounds,
  surroundings: Omit<StraightRoutePreflightContext, "originalBounds"> = { surroundingRoutes: [] },
): StraightRoutePreflightContext {
  const context = Object.freeze({
    ...surroundings,
    originalBounds: Object.freeze({ ...originalBounds }),
    surroundingRoutes: Object.freeze([...surroundings.surroundingRoutes]),
  })
  nativePreloadFreeContexts.add(context)
  return context
}

/** Accessor-backed geometry remains on the ordinary search path. */
export function hasPlainDataProperties(value: unknown): boolean {
  if (value === null || typeof value !== "object") return false
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return false
  const properties = Object.getOwnPropertyDescriptors(value)
  return Object.values(properties).every((property) => "value" in property)
}

/** New board-rule reads never invoke a getter earlier than native search. */
export function getOwnedStraightRoutePreflightBoardRules(
  srj: unknown,
): StraightRoutePreflightBoardRules | undefined {
  if (!hasPlainDataProperties(srj)) return undefined
  const hole = Object.getOwnPropertyDescriptor(srj, "minTraceToHoleEdgeClearance")?.value as unknown
  const pad = Object.getOwnPropertyDescriptor(srj, "minTraceToPadEdgeClearance")?.value as unknown
  if (hole !== undefined && (!isSupportedNumber(hole) || hole < 0)) return undefined
  if (pad !== undefined && (!isSupportedNumber(pad) || pad < 0)) return undefined
  return {
    minTraceToHoleEdgeClearance: hole as number | undefined,
    minTraceToPadEdgeClearance: pad as number | undefined,
  }
}

function hasPlainArrayItems(value: unknown): value is unknown[] {
  if (!Array.isArray(value)) return false
  if (Object.getPrototypeOf(value) !== Array.prototype) return false
  const properties = Object.getOwnPropertyDescriptors(value)
  if (!Object.values(properties).every((property) => "value" in property)) {
    return false
  }
  if (Object.keys(properties).some((key) => key !== "length" && !/^(0|[1-9][0-9]*)$/.test(key))) return false
  if (Object.getOwnPropertySymbols(value).length > 0) return false
  for (let index = 0; index < value.length; index++) {
    if (!Object.hasOwn(value, index)) return false
  }
  return true
}

/** Reads method descriptors without invoking a custom accessor. */
export function hasNativeDataMethods(
  value: object,
  methods: ReadonlyArray<readonly [string, unknown]>,
): boolean {
  for (const [name, method] of methods) {
    let owner: object | null = value
    let descriptor: PropertyDescriptor | undefined
    while (owner && !descriptor) {
      descriptor = Object.getOwnPropertyDescriptor(owner, name)
      owner = Object.getPrototypeOf(owner)
    }
    if (!descriptor || !("value" in descriptor) || descriptor.value !== method) return false
  }
  return true
}

/** Identity and data checks preserve native connectivity callback dispatch. */
function hasNativeConnectivityMap(map: ConnectivityMap | undefined): boolean {
  if (map === undefined) return true
  if (map === null || typeof map !== "object" || Object.getPrototypeOf(map) !== ConnectivityMap.prototype) return false
  if (!Object.values(Object.getOwnPropertyDescriptors(map)).every((property) => "value" in property)) return false
  if (!hasNativeDataMethods(map, nativeConnectivityDispatch)) return false
  if (!hasPlainDataProperties(map.netMap) || !hasPlainDataProperties(map.idToNetMap)) return false
  if (Object.values(map.idToNetMap).some((net) => typeof net !== "string")) return false
  return true
}

/** Matches Pipeline9's existing root/connection identity checks. */
function routesShareNet(
  left: Pick<Segment, "connectionName" | "rootConnectionName">,
  right: Pick<Segment, "connectionName" | "rootConnectionName">,
  map: ConnectivityMap | undefined,
): boolean {
  const leftIds = [left.connectionName, left.rootConnectionName].filter((id): id is string => typeof id === "string")
  const rightIds = [right.connectionName, right.rootConnectionName].filter((id): id is string => typeof id === "string")
  return leftIds.some((leftId) => rightIds.some((rightId) => leftId === rightId || (map?.areIdsConnected(leftId, rightId) ?? false)))
}

/** Native canonical and physically exported named layers must agree. */
function getSupportedObstacleLayers(obstacle: Obstacle, layerCount: number): number[] | null {
  if (!hasPlainArrayItems(obstacle.layers) || obstacle.layers.length === 0) return null
  const named: number[] = []
  for (const layer of obstacle.layers) {
    if (typeof layer !== "string") return null
    const z = layer === "top" ? 0 : layer === "bottom" ? layerCount - 1 : /^inner[0-9]+$/.test(layer) ? Number(layer.slice(5)) : -1
    if (!Number.isInteger(z) || z < 0 || z >= layerCount) return null
    named.push(z)
  }
  const canonical = obstacle.__zLayers ?? obstacle.zLayers
  if (canonical === undefined) return named
  if (!hasPlainArrayItems(canonical) || canonical.length === 0) return null
  if (canonical.some((z) => !Number.isInteger(z) || z < 0 || z >= layerCount)) return null
  // The fixed kernel reads canonical indexes; physical export reads names.
  // Contradictory geometry cannot serve as a clearance certificate.
  const namedSet = new Set(named)
  const canonicalSet = new Set(canonical)
  if (namedSet.size !== canonicalSet.size || named.some((z) => !canonicalSet.has(z))) return null
  return canonical
}

/** Full supported rectangle/circle distance, using the native math kernel. */
function getSegmentObstacleDistance(segment: Segment, obstacle: Obstacle): number {
  if (obstacle.isNonPlatedHole && obstacle.shape === "circle") {
    return pointToSegmentDistance(obstacle.center, segment.A, segment.B) - Math.max(obstacle.width, obstacle.height) / 2
  }
  const radians = ((obstacle.ccwRotationDegrees ?? 0) * Math.PI) / 180
  const cosine = Math.cos(radians)
  const sine = Math.sin(radians)
  const local = [segment.A, segment.B].map((point) => {
    const dx = point.x - obstacle.center.x
    const dy = point.y - obstacle.center.y
    return { x: dx * cosine + dy * sine, y: -dx * sine + dy * cosine }
  })
  return segmentToBoundsMinDistance(local[0]!, local[1]!, {
    minX: -obstacle.width / 2,
    maxX: obstacle.width / 2,
    minY: -obstacle.height / 2,
    maxY: obstacle.height / 2,
  })
}

/** Every terminal of each connection must be in one exact endpoint component. */
function tasksConnectAllPorts(
  tasks: Task[],
  groups: Map<string, PortPoint[]>,
): boolean {
  const key = (point: Point): string => {
    const x = point.x
    const y = point.y
    const z = point.z
    return `${x}:${y}:${z}`
  }
  for (const [connectionName, points] of groups) {
    if (points.length < 2) return false
    const adjacency = new Map<string, Set<string>>()
    for (const task of tasks) {
      if (task.connectionName !== connectionName) continue
      const left = key(task.A)
      const right = key(task.B)
      if (!adjacency.has(left)) adjacency.set(left, new Set())
      if (!adjacency.has(right)) adjacency.set(right, new Set())
      adjacency.get(left)!.add(right)
      adjacency.get(right)!.add(left)
    }
    const reached = new Set<string>([key(points[0]!)])
    const pending = [...reached]
    while (pending.length > 0) {
      for (const next of adjacency.get(pending.pop()!) ?? []) {
        if (reached.has(next)) continue
        reached.add(next)
        pending.push(next)
      }
    }
    if (points.some((point) => !reached.has(key(point)))) return false
  }
  return true
}

function isSupportedNumber(value: unknown): value is number {
  if (typeof value !== "number") return false
  if (!Number.isFinite(value)) return false
  // Bound intermediate products and leave ample room for the clearance guard.
  if (Math.abs(value) > 10_000) return false
  return true
}

function getRectangularBoardBounds(board: HighDensityBoardGeometry): Bounds | null {
  if (!hasPlainDataProperties(board) || !hasPlainDataProperties(board.bounds)) {
    return null
  }
  if (![board.bounds.minX, board.bounds.maxX, board.bounds.minY, board.bounds.maxY].every(isSupportedNumber)) return null
  if (board.bounds.minX >= board.bounds.maxX || board.bounds.minY >= board.bounds.maxY) return null
  if (board.outline === undefined) return board.bounds
  if (!hasPlainArrayItems(board.outline)) return null
  const outline = board.outline
  if (outline.length !== 4 && outline.length !== 5) return null
  for (const point of outline) {
    if (!hasPlainDataProperties(point) || ![point.x, point.y].every(isSupportedNumber)) return null
  }
  const bounds: Bounds = {
    minX: Math.min(...outline.map((point) => point.x)),
    maxX: Math.max(...outline.map((point) => point.x)),
    minY: Math.min(...outline.map((point) => point.y)),
    maxY: Math.max(...outline.map((point) => point.y)),
  }
  const { minX, maxX, minY, maxY } = bounds
  if (minX >= maxX || minY >= maxY) return null
  const keys = new Set<string>()
  for (let index = 0; index < outline.length; index++) {
    const point = outline[index]!
    if (![minX, maxX].includes(point.x) || ![minY, maxY].includes(point.y)) return null
    if (index === 4) {
      if (point.x !== outline[0]!.x || point.y !== outline[0]!.y) return null
      continue
    }
    keys.add(`${point.x}:${point.y}`)
    const next = outline[(index + 1) % 4]!
    if (point.x !== next.x && point.y !== next.y) return null
  }
  return keys.size === 4 ? bounds : null
}

/** Bounded simple outlines retain the native point and edge predicates. */
function getSupportedBoard(board: HighDensityBoardGeometry): BoardCertificate | null {
  const rectangle = getRectangularBoardBounds(board)
  if (rectangle) {
    return {
      bounds: rectangle,
      rectangular: true,
      outline: [
        { x: rectangle.minX, y: rectangle.minY },
        { x: rectangle.maxX, y: rectangle.minY },
        { x: rectangle.maxX, y: rectangle.maxY },
        { x: rectangle.minX, y: rectangle.maxY },
      ],
    }
  }
  if (!hasPlainDataProperties(board) || !hasPlainDataProperties(board.bounds)) return null
  if (![board.bounds.minX, board.bounds.maxX, board.bounds.minY, board.bounds.maxY].every(isSupportedNumber)) return null
  if (board.bounds.minX >= board.bounds.maxX || board.bounds.minY >= board.bounds.maxY) return null
  if (!hasPlainArrayItems(board.outline) || board.outline.length < 3 || board.outline.length > 129) return null
  for (const point of board.outline) {
    if (!hasPlainDataProperties(point) || ![point.x, point.y].every(isSupportedNumber)) return null
  }
  const outline = board.outline.map((point) => ({ x: point.x, y: point.y }))
  if (outline[0]!.x === outline.at(-1)!.x && outline[0]!.y === outline.at(-1)!.y) outline.pop()
  if (outline.length < 3 || outline.length > 128) return null
  if (new Set(outline.map((point) => `${point.x}:${point.y}`)).size !== outline.length) return null
  let area = 0
  for (let index = 0; index < outline.length; index++) {
    const point = outline[index]!
    const next = outline[(index + 1) % outline.length]!
    const previous = outline[(index + outline.length - 1) % outline.length]!
    if (Math.hypot(next.x - point.x, next.y - point.y) < 1e-6) return null
    area += point.x * next.y - next.x * point.y
    const cross = (previous.x - point.x) * (next.y - point.y) - (previous.y - point.y) * (next.x - point.x)
    const dot = (previous.x - point.x) * (next.x - point.x) + (previous.y - point.y) * (next.y - point.y)
    if (Math.abs(cross) < 1e-6 && dot > 0) return null
    for (let otherIndex = index + 2; otherIndex < outline.length; otherIndex++) {
      if (index === 0 && otherIndex === outline.length - 1) continue
      const other = outline[otherIndex]!
      const otherNext = outline[(otherIndex + 1) % outline.length]!
      if (doSegmentsIntersect(point, next, other, otherNext)) return null
      if (!(segmentToSegmentMinDistance(point, next, other, otherNext) >= 1e-6)) return null
    }
  }
  if (!Number.isFinite(area) || Math.abs(area) < 1e-6) return null
  return {
    rectangular: false,
    outline,
    bounds: {
      minX: Math.min(...outline.map((point) => point.x)),
      maxX: Math.max(...outline.map((point) => point.x)),
      minY: Math.min(...outline.map((point) => point.y)),
      maxY: Math.max(...outline.map((point) => point.y)),
    },
  }
}

/** Positive full-segment clearance keeps connected copper inside the outline. */
function segmentsInsideBoard(
  segments: Segment[],
  board: BoardCertificate,
  reach: number,
): boolean {
  if (board.rectangular) return true
  for (const segment of segments) {
    if (!isPointInsidePolygon(segment.A, board.outline) || !isPointInsidePolygon(segment.B, board.outline)) return false
    for (let index = 0; index < board.outline.length; index++) {
      const start = board.outline[index]!
      const end = board.outline[(index + 1) % board.outline.length]!
      if (doSegmentsIntersect(segment.A, segment.B, start, end)) return false
      if (!(segmentToSegmentMinDistance(segment.A, segment.B, start, end) >= reach)) return false
    }
  }
  return true
}

function pointsShareEdge(A: Point, B: Point, bounds: Bounds): boolean {
  return (
    (Math.abs(A.x - bounds.minX) < 0.001 &&
      Math.abs(B.x - bounds.minX) < 0.001) ||
    (Math.abs(A.x - bounds.maxX) < 0.001 &&
      Math.abs(B.x - bounds.maxX) < 0.001) ||
    (Math.abs(A.y - bounds.minY) < 0.001 &&
      Math.abs(B.y - bounds.minY) < 0.001) ||
    (Math.abs(A.y - bounds.maxY) < 0.001 &&
      Math.abs(B.y - bounds.maxY) < 0.001)
  )
}

function isPointWithinBounds(point: Point, bounds: Bounds, margin: number): boolean {
  if (point.x < bounds.minX + margin) return false
  if (point.x > bounds.maxX - margin) return false
  if (point.y < bounds.minY + margin) return false
  if (point.y > bounds.maxY - margin) return false
  return true
}

function segmentsAreSeparated(left: Segment, right: Segment, clearance: number): boolean {
  if (left.A.z !== right.A.z) return true
  if (doSegmentsIntersect(left.A, left.B, right.A, right.B)) return false
  const distance = Math.min(
    pointToSegmentDistance(left.A, right.A, right.B),
    pointToSegmentDistance(left.B, right.A, right.B),
    pointToSegmentDistance(right.A, left.A, left.B),
    pointToSegmentDistance(right.B, left.A, left.B),
  )
  return Number.isFinite(distance) && distance >= clearance
}

/** Validates the query's copper representation before using its certificate. */
function hasSupportedRouteGeometry(
  route: HighDensityIntraNodeRoute,
  layerCount: number,
): boolean {
  if (!hasPlainDataProperties(route)) return false
  if (!hasPlainArrayItems(route.route) || route.route.length < 2) return false
  if (!hasPlainArrayItems(route.vias)) return false
  if (route.jumpers !== undefined && (!hasPlainArrayItems(route.jumpers) || route.jumpers.length > 0)) return false
  if (![route.traceThickness, route.viaDiameter].every(isSupportedNumber)) return false
  if (route.traceThickness <= 0 || route.viaDiameter <= 0) return false
  if (typeof route.connectionName !== "string" || (route.rootConnectionName !== undefined && typeof route.rootConnectionName !== "string")) return false
  for (const point of route.route) {
    if (!hasPlainDataProperties(point)) return false
    if (![point.x, point.y, point.z].every(isSupportedNumber)) return false
    if (!Number.isInteger(point.z) || point.z < 0 || point.z >= layerCount) return false
    if (point.traceThickness !== undefined && (!isSupportedNumber(point.traceThickness) || point.traceThickness <= 0)) return false
    if (point.toNextSegmentType !== undefined && point.toNextSegmentType !== "through_obstacle") return false
    if (point.insideJumperPad) return false
  }
  for (const via of route.vias) {
    if (!hasPlainDataProperties(via) || ![via.x, via.y].every(isSupportedNumber)) return false
    if (!route.route.some((point, index) => {
      const next = route.route[index + 1]
      return next && point.z !== next.z && ((point.x === via.x && point.y === via.y) || (next.x === via.x && next.y === via.y))
    })) return false
  }
  return true
}

/** Uses full wire segments and full drilled via spans, including prior nodes. */
function tasksClearSurroundingCopper(
  tasks: Segment[],
  context: StraightRoutePreflightContext,
  layerCount: number,
  traceWidth: number,
  obstacleMargin: number,
  connMap: ConnectivityMap | undefined,
): boolean {
  if (!hasPlainArrayItems(context.surroundingRoutes)) return false
  for (const route of context.surroundingRoutes) {
    if (!hasSupportedRouteGeometry(route, layerCount)) return false
    // The existing query caches immutable native routes. A fresh geometry copy
    // here also keeps mutable standalone data from reusing an earlier query.
    const copy: HighDensityIntraNodeRoute = {
      ...route,
      route: route.route.map((point) => ({ ...point })),
      vias: route.vias.map((via) => ({ ...via })),
    }
    const geometry = getPipeline9RouteCopperGeometry(copy, {
      layerCount,
      allowBlindAndBuriedVias: context.allowBlindAndBuriedVias,
    })
    for (const task of tasks) {
      if (routesShareNet(task, route, connMap)) continue
      for (const segment of geometry.wireSegments) {
        const clearance = traceWidth / 2 + segment.width / 2 + obstacleMargin + 1e-6
        const other: Segment = {
          A: segment.start,
          B: segment.end,
          connectionName: route.connectionName,
        }
        if (!segmentsAreSeparated(task, other, clearance)) return false
      }
      for (const via of geometry.viaSpans) {
        if (task.A.z < via.minZ || task.A.z > via.maxZ) continue
        const clearance = traceWidth / 2 + via.diameter / 2 + obstacleMargin + 1e-6
        if (!(pointToSegmentDistance(via.center, task.A, task.B) >= clearance)) return false
      }
    }
  }
  return true
}

/**
 * Certifies native A13 boundary stubs and a straight interior for every task.
 * The complete current route set includes all future terminals.
 * Supported fixed copper uses native layers, pad ownership and exact math.
 * Holes keep unconditional original-rule clearance. Unknown geometry and
 * crowded tasks leave the existing portfolio untouched.
 */
export function getCertifiedStraightIntraNodeRoutes(
  params: Params,
): HighDensityIntraNodeRoute[] | null {
  if (!hasPlainDataProperties(params) || !hasNativeConnectivityMap(params.connMap)) return null
  const connMap = params.connMap
  const node = params.nodeWithPortPoints
  if (!hasPlainDataProperties(node) || !hasPlainDataProperties(node.center)) {
    return null
  }
  if (!hasPlainArrayItems(node.portPoints) || node.portPoints.length === 0) {
    return null
  }
  if (![node.center.x, node.center.y, node.width, node.height].every(isSupportedNumber)) {
    return null
  }
  if (node.width <= 0 || node.height <= 0) return null
  if (node.availableZ && !hasPlainArrayItems(node.availableZ)) return null
  const board = params.boardGeometry
  if (!board) return null
  const boardCertificate = getSupportedBoard(board)
  if (!boardCertificate) return null
  const boardBounds = boardCertificate.bounds
  const traceWidth = params.traceWidth ?? 0.15
  const viaDiameter = params.viaDiameter ?? 0.3
  const obstacleMargin = params.obstacleMargin ?? 0.15
  const boardMargin = board.minBoardEdgeClearance ?? 0.2
  const layerCount = params.layerCount ?? 2
  if (!Number.isInteger(layerCount) || layerCount < 1 || layerCount > 32) return null
  if (![traceWidth, viaDiameter, obstacleMargin, boardMargin].every(isSupportedNumber)) {
    return null
  }
  if (traceWidth <= 0 || viaDiameter <= 0 || obstacleMargin < 0 || boardMargin < 0) {
    return null
  }
  const numericMargin = 1e-6
  const traceClearance = traceWidth + obstacleMargin + numericMargin
  const boardReach = traceWidth / 2 + Math.max(boardMargin, obstacleMargin) + numericMargin
  const bounds: Bounds = {
    minX: node.center.x - node.width / 2,
    maxX: node.center.x + node.width / 2,
    minY: node.center.y - node.height / 2,
    maxY: node.center.y + node.height / 2,
  }
  const context = params.straightRoutePreflightContext
  if (!context || !nativePreloadFreeContexts.has(context)) return null
  const holeMargin = context.minTraceToHoleEdgeClearance ?? 0.2
  const padMargin = context.minTraceToPadEdgeClearance ?? 0.15
  if (![holeMargin, padMargin].every(isSupportedNumber) || holeMargin < 0 || padMargin < 0) return null
  const original = context.originalBounds
  if (bounds.minX !== original.minX || bounds.maxX !== original.maxX || bounds.minY !== original.minY || bounds.maxY !== original.maxY) {
    return null
  }
  const inset = traceWidth / 2 + obstacleMargin
  if (node.width <= inset * 2 || node.height <= inset * 2) return null
  const innerBounds: Bounds = {
    minX: bounds.minX + inset,
    maxX: bounds.maxX - inset,
    minY: bounds.minY + inset,
    maxY: bounds.maxY - inset,
  }
  const projected = new Map<PortPoint, Point>()
  const projectedOriginals = new Map<string, PortPoint>()
  const groups = new Map<string, PortPoint[]>()
  for (const point of node.portPoints) {
    if (!hasPlainDataProperties(point)) return null
    if (![point.x, point.y, point.z].every(isSupportedNumber)) return null
    if (!Number.isInteger(point.z) || point.z < 0 || point.z >= layerCount) return null
    if (typeof point.connectionName !== "string" || point.connectionName.length === 0) return null
    for (const label of [point.rootConnectionName, point.portPointId, point.prevPortPointId, point.nextPortPointId, point.pcb_port_id]) {
      if (label !== undefined && typeof label !== "string") return null
    }
    if (!isPointWithinBounds(point, bounds, 0)) return null
    if (!isPointWithinBounds(point, boardBounds, boardReach)) return null
    if (node.availableZ && !node.availableZ.includes(point.z)) return null
    const inner: Point = {
      x: Math.max(innerBounds.minX, Math.min(innerBounds.maxX, point.x)),
      y: Math.max(innerBounds.minY, Math.min(innerBounds.maxY, point.y)),
      z: point.z,
    }
    if (!isPointWithinBounds(inner, boardBounds, boardReach)) return null
    const key = `${inner.x}:${inner.y}:${inner.z}`
    const previous = projectedOriginals.get(key)
    if (previous && (previous.x !== point.x || previous.y !== point.y)) return null
    projectedOriginals.set(key, point)
    projected.set(point, inner)
    const group = groups.get(point.connectionName)
    if (group) group.push(point)
    else groups.set(point.connectionName, [point])
  }
  const tasks: Task[] = []
  for (const [connectionName, points] of groups) {
    const rootConnectionName = points[0]!.rootConnectionName
    if (points.some((point) => point.rootConnectionName !== rootConnectionName)) return null
    for (const [A, B] of getConnectionPortPointPairs(points)) {
      if (A.z !== B.z || pointsShareEdge(A, B, bounds)) return null
      if (A.x === B.x && A.y === B.y) return null
      const path = [A, projected.get(A)!, projected.get(B)!, B].filter((point, index, points) => index === 0 || point.x !== points[index - 1]!.x || point.y !== points[index - 1]!.y)
      tasks.push({ A, B, connectionName, rootConnectionName, path })
    }
  }
  if (tasks.length === 0 || !tasksConnectAllPorts(tasks, groups)) return null
  if (node.portPointsInPairs !== undefined) {
    if (!hasPlainArrayItems(node.portPointsInPairs)) return null
    for (const pair of node.portPointsInPairs) {
      if (!hasPlainArrayItems(pair) || pair.length !== 2) return null
      for (const point of pair) {
        if (!hasPlainDataProperties(point)) return null
        if (!node.portPoints.some((port) => port.x === point.x && port.y === point.y && port.z === point.z && port.connectionName === point.connectionName)) return null
      }
      if (pair[0]!.connectionName !== pair[1]!.connectionName) return null
    }
  }
  const physicalSegments: Segment[] = tasks.flatMap((task) => task.path.slice(0, -1).map((point, index) => ({
    A: point,
    B: task.path[index + 1]!,
    connectionName: task.connectionName,
    rootConnectionName: task.rootConnectionName,
  })))
  if (!segmentsInsideBoard(physicalSegments, boardCertificate, boardReach)) return null
  for (let index = 0; index < physicalSegments.length; index++) {
    const task = physicalSegments[index]!
    for (const port of node.portPoints) {
      if (port.z !== task.A.z || routesShareNet(task, port, connMap)) continue
      if (!(pointToSegmentDistance(port, task.A, task.B) >= traceClearance)) return null
    }
    for (const other of physicalSegments.slice(index + 1)) {
      if (routesShareNet(task, other, connMap)) continue
      if (!segmentsAreSeparated(task, other, traceClearance)) return null
    }
  }
  const obstacles = params.obstacles ?? []
  if (!hasPlainArrayItems(obstacles)) return null
  for (const obstacle of obstacles) {
    if (!hasPlainDataProperties(obstacle) || !hasPlainDataProperties(obstacle.center)) return null
    if (![obstacle.center.x, obstacle.center.y, obstacle.width, obstacle.height].every(isSupportedNumber)) return null
    if (obstacle.width <= 0 || obstacle.height <= 0) return null
    if (obstacle.type !== "rect" || (obstacle.shape !== undefined && obstacle.shape !== "circle")) return null
    if (obstacle.isCopperPour) return null
    if (obstacle.isNonPlatedHole !== undefined && typeof obstacle.isNonPlatedHole !== "boolean") return null
    if (obstacle.ccwRotationDegrees !== undefined && !isSupportedNumber(obstacle.ccwRotationDegrees)) return null
    if (obstacle.circuitJsonMetadata !== undefined) {
      if (!hasPlainDataProperties(obstacle.circuitJsonMetadata)) return null
      if (Object.values(obstacle.circuitJsonMetadata).some((label) => label !== undefined && typeof label !== "string")) return null
    }
    if (!hasPlainArrayItems(obstacle.connectedTo) || obstacle.connectedTo.some((id) => typeof id !== "string")) return null
    const zLayers = getSupportedObstacleLayers(obstacle, layerCount)
    if (!zLayers) return null
    const hole = Boolean(obstacle.isNonPlatedHole || obstacle.circuitJsonMetadata?.pcb_plated_hole_id || obstacle.circuitJsonMetadata?.pcb_via_id)
    const physicalMargin = Math.max(obstacleMargin, padMargin, hole ? holeMargin : 0)
    const reach = traceWidth / 2 + physicalMargin + numericMargin
    for (const task of physicalSegments) {
      if (!hole && (!zLayers.includes(task.A.z) || isObstacleConnectedToRoute(obstacle, task, connMap))) continue
      if (!(getSegmentObstacleDistance(task, obstacle) >= reach)) return null
    }
  }
  if (!tasksClearSurroundingCopper(physicalSegments, context, layerCount, traceWidth, obstacleMargin, connMap)) return null
  const preservePortIds = params.preserveTerminalPcbPortIds === true
  const routes: HighDensityIntraNodeRoute[] = tasks.map(({ A, B, path, connectionName, rootConnectionName }) => ({
    connectionName,
    rootConnectionName,
    regionId: node.capacityMeshNodeId,
    traceThickness: traceWidth,
    viaDiameter,
    route: path.map((point, index) => ({
      x: point.x,
      y: point.y,
      z: point.z,
      ...(preservePortIds && index === 0 && A.pcb_port_id ? { pcb_port_id: A.pcb_port_id } : {}),
      ...(preservePortIds && index === path.length - 1 && B.pcb_port_id ? { pcb_port_id: B.pcb_port_id } : {}),
    })),
    ...(preservePortIds && A.pcb_port_id ? { startPcbPortId: A.pcb_port_id } : {}),
    ...(preservePortIds && B.pcb_port_id ? { endPcbPortId: B.pcb_port_id } : {}),
    vias: [],
  }))
  if (!areNodePortPointPairsConnectedByRoutes(routes, node)) return null
  return routes
}

const nativeConnectivityDispatch: Array<[string, unknown]> = [
  ["areIdsConnected", ConnectivityMap.prototype.areIdsConnected],
  ["getIdsConnectedToNet", ConnectivityMap.prototype.getIdsConnectedToNet],
  ["getNetConnectedToId", ConnectivityMap.prototype.getNetConnectedToId],
]
