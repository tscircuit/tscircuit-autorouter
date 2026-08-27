import {
  pointToSegmentClosestPoint,
  segmentToSegmentMinDistance,
} from "@tscircuit/math-utils"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"
import type {
  SimpleRouteJson,
  SimplifiedPcbTrace,
  SimplifiedPcbTraces,
} from "lib/types"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"
import { getViaDimensions } from "lib/utils/getViaDimensions"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import { mapZToLayerName } from "lib/utils/mapZToLayerName"
import { convertPreloadedTraceToHdRoutes } from "../AutoroutingPipeline9_PreloadedTraceGraph/convert-preloaded-traces-to-hd-routes"

type Point = { x: number; y: number }
type RoutePoint = SimplifiedPcbTrace["route"][number]
type WirePoint = Extract<RoutePoint, { route_type: "wire" }>
type ViaPoint = Extract<RoutePoint, { route_type: "via" }>
type Bounds = { minX: number; minY: number; maxX: number; maxY: number }
type RouteIndexRange = { startIndex: number; endIndex: number }
type RuntimeObstacle = Omit<SimpleRouteJson["obstacles"][number], "type"> & {
  type: "rect" | "oval"
}
type PreparedObstacle = {
  obstacle: RuntimeObstacle
  bounds: Bounds
  zLayers: Set<number>
  connectedToCurrentConnection: boolean
}

export type ContactSpanDrcConflict = {
  identity: string
  center: Point
  ownerTraceIds: string[]
}

export type ContactSpanDrcRepairPassStats = {
  searchCount: number
  searchIterationCount: number
  accepted: boolean
  runtimeBudgetExhausted: boolean
}

export type ContactSpanDrcRepairOptions = {
  srj: SimpleRouteJson
  traces: SimplifiedPcbTraces
  fixedTraces: SimplifiedPcbTraces
  connectivityMap: ConnectivityMap
  conflicts: ContactSpanDrcConflict[]
  getAllowedLayers: (trace: SimplifiedPcbTrace) => string[]
  acceptCandidate: (candidate: SimplifiedPcbTrace) => boolean
  maxSearches?: number
  maxIterationsPerSearch?: number
  deadlineMs?: number
}

type ContactSpanCandidateResult = {
  candidate?: SimplifiedPcbTrace
  iterations: number
  runtimeBudgetExhausted: boolean
}

const EPSILON = 1e-6
const MIN_ROUTE_DIMENSION = 1e-9
const CONTACT_WINDOW_MARGIN = 3
const MAX_CONTACT_WINDOW_SIZE = 15

const getRuntimeObstacle = (
  obstacle: SimpleRouteJson["obstacles"][number],
): RuntimeObstacle => {
  const runtimeType = (obstacle as { type?: unknown }).type
  if (runtimeType !== "rect" && runtimeType !== "oval") {
    throw new Error(
      `Contact-span DRC repair cannot model obstacle type ${String(runtimeType)}`,
    )
  }
  if (
    !Number.isFinite(obstacle.width) ||
    !Number.isFinite(obstacle.height) ||
    obstacle.width <= 0 ||
    obstacle.height <= 0
  ) {
    throw new Error(
      "Contact-span DRC repair requires positive obstacle geometry",
    )
  }
  return obstacle as RuntimeObstacle
}

const getPointToSegmentDistance = (
  point: Point,
  start: Point,
  end: Point,
): number => {
  const closestPoint = pointToSegmentClosestPoint(point, start, end)
  return Math.hypot(point.x - closestPoint.x, point.y - closestPoint.y)
}

const getWireSegments = (
  trace: SimplifiedPcbTrace,
): Array<{
  startIndex: number
  endIndex: number
  start: WirePoint
  end: WirePoint
}> => {
  const segments: Array<{
    startIndex: number
    endIndex: number
    start: WirePoint
    end: WirePoint
  }> = []
  for (let index = 0; index < trace.route.length - 1; index++) {
    const start = trace.route[index]
    const end = trace.route[index + 1]
    if (
      start?.route_type === "wire" &&
      end?.route_type === "wire" &&
      start.layer === end.layer
    ) {
      segments.push({ startIndex: index, endIndex: index + 1, start, end })
    }
  }
  return segments
}

const getViaLayers = (
  via: ViaPoint,
  layerCount: number,
  allowBlindAndBuriedVias: boolean,
): Set<string> => {
  if (!allowBlindAndBuriedVias) {
    return new Set(
      Array.from({ length: layerCount }, (_, z) =>
        mapZToLayerName(z, layerCount),
      ),
    )
  }
  const fromZ = mapLayerNameToZ(via.from_layer, layerCount)
  const toZ = mapLayerNameToZ(via.to_layer, layerCount)
  return new Set(
    Array.from({ length: Math.abs(toZ - fromZ) + 1 }, (_, index) =>
      mapZToLayerName(Math.min(fromZ, toZ) + index, layerCount),
    ),
  )
}

const getNearestPrimitiveRange = (
  trace: SimplifiedPcbTrace,
  center: Point,
): RouteIndexRange | undefined => {
  const exactVias = trace.route.flatMap((point, index) =>
    point.route_type === "via" &&
    Math.hypot(center.x - point.x, center.y - point.y) <= EPSILON
      ? [index]
      : [],
  )
  if (exactVias.length > 0) {
    return {
      startIndex: Math.min(...exactVias),
      endIndex: Math.max(...exactVias),
    }
  }
  const candidates: Array<RouteIndexRange & { distance: number }> = []
  for (const segment of getWireSegments(trace)) {
    candidates.push({
      startIndex: segment.startIndex,
      endIndex: segment.endIndex,
      distance: getPointToSegmentDistance(center, segment.start, segment.end),
    })
  }
  for (let index = 0; index < trace.route.length; index++) {
    const point = trace.route[index]
    if (point?.route_type !== "via") continue
    candidates.push({
      startIndex: index,
      endIndex: index,
      distance: Math.hypot(center.x - point.x, center.y - point.y),
    })
  }
  if (candidates.length === 0) return undefined
  const minimumDistance = Math.min(
    ...candidates.map(({ distance }) => distance),
  )
  const nearest = candidates.filter(
    ({ distance }) => distance <= minimumDistance + EPSILON,
  )
  return {
    startIndex: Math.min(...nearest.map(({ startIndex }) => startIndex)),
    endIndex: Math.max(...nearest.map(({ endIndex }) => endIndex)),
  }
}

const getTraceContactRanges = ({
  trace,
  otherTraces,
  layerCount,
  defaultViaDiameter,
  clearance,
  allowBlindAndBuriedVias,
}: {
  trace: SimplifiedPcbTrace
  otherTraces: SimplifiedPcbTraces
  layerCount: number
  defaultViaDiameter: number
  clearance: number
  allowBlindAndBuriedVias: boolean
}): RouteIndexRange[] => {
  const ranges: RouteIndexRange[] = []
  const ownerSegments = getWireSegments(trace)
  const ownerVias = trace.route.flatMap((point, index) =>
    point.route_type === "via" ? [{ point, index }] : [],
  )
  for (const otherTrace of otherTraces) {
    const otherSegments = getWireSegments(otherTrace)
    const otherVias = otherTrace.route.flatMap((point) =>
      point.route_type === "via" ? [point] : [],
    )
    for (const ownerSegment of ownerSegments) {
      for (const otherSegment of otherSegments) {
        if (ownerSegment.start.layer !== otherSegment.start.layer) continue
        const requiredDistance =
          ownerSegment.start.width / 2 +
          otherSegment.start.width / 2 +
          clearance
        if (
          segmentToSegmentMinDistance(
            ownerSegment.start,
            ownerSegment.end,
            otherSegment.start,
            otherSegment.end,
          ) <=
          requiredDistance + EPSILON
        ) {
          ranges.push({
            startIndex: ownerSegment.startIndex,
            endIndex: ownerSegment.endIndex,
          })
        }
      }
      for (const otherVia of otherVias) {
        const viaLayers = getViaLayers(
          otherVia,
          layerCount,
          allowBlindAndBuriedVias,
        )
        if (!viaLayers.has(ownerSegment.start.layer)) continue
        const requiredDistance =
          ownerSegment.start.width / 2 +
          (otherVia.via_diameter ?? defaultViaDiameter) / 2 +
          clearance
        if (
          getPointToSegmentDistance(
            otherVia,
            ownerSegment.start,
            ownerSegment.end,
          ) <=
          requiredDistance + EPSILON
        ) {
          ranges.push({
            startIndex: ownerSegment.startIndex,
            endIndex: ownerSegment.endIndex,
          })
        }
      }
    }
    for (const ownerVia of ownerVias) {
      const ownerLayers = getViaLayers(
        ownerVia.point,
        layerCount,
        allowBlindAndBuriedVias,
      )
      for (const otherSegment of otherSegments) {
        if (!ownerLayers.has(otherSegment.start.layer)) continue
        const requiredDistance =
          (ownerVia.point.via_diameter ?? defaultViaDiameter) / 2 +
          otherSegment.start.width / 2 +
          clearance
        if (
          getPointToSegmentDistance(
            ownerVia.point,
            otherSegment.start,
            otherSegment.end,
          ) <=
          requiredDistance + EPSILON
        ) {
          ranges.push({
            startIndex: ownerVia.index,
            endIndex: ownerVia.index,
          })
        }
      }
      for (const otherVia of otherVias) {
        const otherLayers = getViaLayers(
          otherVia,
          layerCount,
          allowBlindAndBuriedVias,
        )
        if (![...ownerLayers].some((layer) => otherLayers.has(layer))) continue
        const requiredDistance =
          (ownerVia.point.via_diameter ?? defaultViaDiameter) / 2 +
          (otherVia.via_diameter ?? defaultViaDiameter) / 2 +
          clearance
        if (
          Math.hypot(
            ownerVia.point.x - otherVia.x,
            ownerVia.point.y - otherVia.y,
          ) <=
          requiredDistance + EPSILON
        ) {
          ranges.push({
            startIndex: ownerVia.index,
            endIndex: ownerVia.index,
          })
        }
      }
    }
  }
  return ranges
}

const expandRangeAcrossContacts = (
  seed: RouteIndexRange,
  contacts: RouteIndexRange[],
): RouteIndexRange => {
  const expanded = { ...seed }
  let changed = true
  while (changed) {
    changed = false
    for (const contact of contacts) {
      const touchesExpandedRange =
        contact.startIndex <= expanded.endIndex + 1 &&
        contact.endIndex >= expanded.startIndex - 1
      if (!touchesExpandedRange) continue
      const nextStart = Math.min(expanded.startIndex, contact.startIndex)
      const nextEnd = Math.max(expanded.endIndex, contact.endIndex)
      if (nextStart === expanded.startIndex && nextEnd === expanded.endIndex)
        continue
      expanded.startIndex = nextStart
      expanded.endIndex = nextEnd
      changed = true
    }
  }
  return expanded
}

const getStableWireAnchors = (
  trace: SimplifiedPcbTrace,
  affected: RouteIndexRange,
): RouteIndexRange | undefined => {
  let startIndex = affected.startIndex - 1
  while (startIndex >= 0 && trace.route[startIndex]?.route_type !== "wire")
    startIndex--
  if (startIndex < 0) {
    startIndex = trace.route.findIndex((point) => point.route_type === "wire")
  }
  let endIndex = affected.endIndex + 1
  while (
    endIndex < trace.route.length &&
    trace.route[endIndex]?.route_type !== "wire"
  ) {
    endIndex++
  }
  if (endIndex >= trace.route.length) {
    endIndex = trace.route.findLastIndex((point) => point.route_type === "wire")
  }
  if (startIndex < 0 || endIndex <= startIndex) return undefined
  return { startIndex, endIndex }
}

const getSpanWidth = (
  trace: SimplifiedPcbTrace,
  anchors: RouteIndexRange,
): number | undefined => {
  const widths = new Set(
    trace.route
      .slice(anchors.startIndex, anchors.endIndex + 1)
      .flatMap((point) => (point.route_type === "wire" ? [point.width] : [])),
  )
  if (widths.size !== 1) return undefined
  const width = [...widths][0]
  return typeof width === "number" && Number.isFinite(width) && width > 0
    ? width
    : undefined
}

const getSpanBounds = ({
  trace,
  anchors,
  boardBounds,
}: {
  trace: SimplifiedPcbTrace
  anchors: RouteIndexRange
  boardBounds: Bounds
}): Bounds | undefined => {
  const points = trace.route
    .slice(anchors.startIndex, anchors.endIndex + 1)
    .filter(
      (point): point is WirePoint | ViaPoint =>
        point.route_type === "wire" || point.route_type === "via",
    )
  if (points.length < 2) return undefined
  const bounds = {
    minX: Math.max(
      boardBounds.minX,
      Math.min(...points.map((point) => point.x)) - CONTACT_WINDOW_MARGIN,
    ),
    minY: Math.max(
      boardBounds.minY,
      Math.min(...points.map((point) => point.y)) - CONTACT_WINDOW_MARGIN,
    ),
    maxX: Math.min(
      boardBounds.maxX,
      Math.max(...points.map((point) => point.x)) + CONTACT_WINDOW_MARGIN,
    ),
    maxY: Math.min(
      boardBounds.maxY,
      Math.max(...points.map((point) => point.y)) + CONTACT_WINDOW_MARGIN,
    ),
  }
  if (
    bounds.maxX - bounds.minX > MAX_CONTACT_WINDOW_SIZE ||
    bounds.maxY - bounds.minY > MAX_CONTACT_WINDOW_SIZE
  ) {
    return undefined
  }
  return bounds
}

const rotateLocalPoint = (point: Point, obstacle: RuntimeObstacle): Point => {
  const radians = (-(obstacle.ccwRotationDegrees ?? 0) * Math.PI) / 180
  const dx = point.x - obstacle.center.x
  const dy = point.y - obstacle.center.y
  return {
    x: dx * Math.cos(radians) - dy * Math.sin(radians),
    y: dx * Math.sin(radians) + dy * Math.cos(radians),
  }
}

const getPointToEllipseDistance = (
  point: Point,
  obstacle: RuntimeObstacle,
): number => {
  const local = rotateLocalPoint(point, obstacle)
  const x = Math.abs(local.x)
  const y = Math.abs(local.y)
  const radiusX = obstacle.width / 2
  const radiusY = obstacle.height / 2
  if (radiusX <= EPSILON || radiusY <= EPSILON) return 0
  if ((x / radiusX) ** 2 + (y / radiusY) ** 2 <= 1 + EPSILON) return 0
  if (Math.abs(radiusX - radiusY) <= EPSILON) {
    return Math.max(0, Math.hypot(x, y) - radiusX)
  }
  const radiusXSquared = radiusX * radiusX
  const radiusYSquared = radiusY * radiusY
  const equationAt = (parameter: number): number => {
    const normalizedX = (radiusX * x) / (parameter + radiusXSquared)
    const normalizedY = (radiusY * y) / (parameter + radiusYSquared)
    return normalizedX ** 2 + normalizedY ** 2 - 1
  }
  let low = 0
  let high = Math.max(radiusX * x, radiusY * y, 1)
  while (equationAt(high) > 0) high *= 2
  for (let iteration = 0; iteration < 32; iteration++) {
    const middle = (low + high) / 2
    if (equationAt(middle) > 0) low = middle
    else high = middle
  }
  const closestX = (radiusXSquared * x) / (high + radiusXSquared)
  const closestY = (radiusYSquared * y) / (high + radiusYSquared)
  return Math.hypot(x - closestX, y - closestY)
}

const getPointToObstacleDistance = (
  point: Point,
  obstacle: RuntimeObstacle,
): number => {
  if (obstacle.type === "oval") {
    return getPointToEllipseDistance(point, obstacle)
  }
  const local = rotateLocalPoint(point, obstacle)
  const outsideX = Math.max(Math.abs(local.x) - obstacle.width / 2, 0)
  const outsideY = Math.max(Math.abs(local.y) - obstacle.height / 2, 0)
  return Math.hypot(outsideX, outsideY)
}

const getObstacleBounds = (obstacle: RuntimeObstacle): Bounds => {
  const radians = ((obstacle.ccwRotationDegrees ?? 0) * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  const radiusX = obstacle.width / 2
  const radiusY = obstacle.height / 2
  const extentX =
    obstacle.type === "oval"
      ? Math.hypot(radiusX * cos, radiusY * sin)
      : Math.abs(radiusX * cos) + Math.abs(radiusY * sin)
  const extentY =
    obstacle.type === "oval"
      ? Math.hypot(radiusX * sin, radiusY * cos)
      : Math.abs(radiusX * sin) + Math.abs(radiusY * cos)
  return {
    minX: obstacle.center.x - extentX,
    minY: obstacle.center.y - extentY,
    maxX: obstacle.center.x + extentX,
    maxY: obstacle.center.y + extentY,
  }
}

const getObstaclePerimeter = (obstacle: RuntimeObstacle): Point[] => {
  const radians = ((obstacle.ccwRotationDegrees ?? 0) * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  const localPoints =
    obstacle.type === "oval"
      ? Array.from({ length: 49 }, (_, index) => {
          const angle = (index / 48) * Math.PI * 2
          return {
            x: (obstacle.width / 2) * Math.cos(angle),
            y: (obstacle.height / 2) * Math.sin(angle),
          }
        })
      : [
          { x: -obstacle.width / 2, y: -obstacle.height / 2 },
          { x: obstacle.width / 2, y: -obstacle.height / 2 },
          { x: obstacle.width / 2, y: obstacle.height / 2 },
          { x: -obstacle.width / 2, y: obstacle.height / 2 },
          { x: -obstacle.width / 2, y: -obstacle.height / 2 },
        ]
  return localPoints.map((point) => ({
    x: obstacle.center.x + point.x * cos - point.y * sin,
    y: obstacle.center.y + point.x * sin + point.y * cos,
  }))
}

const createObstacleRoutes = ({
  srj,
  connectivityMap,
}: {
  srj: SimpleRouteJson
  connectivityMap: ConnectivityMap
}): HighDensityIntraNodeRoute[] => {
  return srj.obstacles.flatMap((rawObstacle, obstacleIndex) => {
    if (rawObstacle.isCopperPour) return []
    const obstacle = getRuntimeObstacle(rawObstacle)
    const connectionName =
      obstacle.connectedTo[0] ?? `__contact_span_obstacle_${obstacleIndex}`
    const rootConnectionName =
      connectivityMap.getNetConnectedToId(connectionName) ?? connectionName
    const perimeter = getObstaclePerimeter(obstacle)
    return obstacle.layers.map((layer) => ({
      connectionName,
      rootConnectionName,
      traceThickness: MIN_ROUTE_DIMENSION,
      viaDiameter: MIN_ROUTE_DIMENSION,
      route: perimeter.map((point) => ({
        ...point,
        z: mapLayerNameToZ(layer, srj.layerCount),
      })),
      vias: [],
    }))
  })
}

const prepareObstacles = ({
  srj,
  connectionName,
  connectivityMap,
}: {
  srj: SimpleRouteJson
  connectionName: string
  connectivityMap: ConnectivityMap
}): PreparedObstacle[] => {
  return srj.obstacles.flatMap((rawObstacle) => {
    if (rawObstacle.isCopperPour) return []
    const obstacle = getRuntimeObstacle(rawObstacle)
    return [
      {
        obstacle,
        bounds: getObstacleBounds(obstacle),
        zLayers: new Set(
          obstacle.layers.map((layer) =>
            mapLayerNameToZ(layer, srj.layerCount),
          ),
        ),
        connectedToCurrentConnection: obstacle.connectedTo.some(
          (identifier) =>
            identifier === connectionName ||
            connectivityMap.areIdsConnected(connectionName, identifier),
        ),
      },
    ]
  })
}

class ContactSpanRouteSolver extends SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost {
  readonly preparedObstacles: PreparedObstacle[]
  readonly viaObstacleClearance: number
  readonly allowViaInPad: boolean
  readonly allowBlindAndBuriedVias: boolean

  constructor(
    options: ConstructorParameters<
      typeof SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost
    >[0] & {
      preparedObstacles: PreparedObstacle[]
      viaObstacleClearance: number
      allowViaInPad: boolean
      allowBlindAndBuriedVias: boolean
    },
  ) {
    super(options)
    this.preparedObstacles = options.preparedObstacles
    this.viaObstacleClearance = options.viaObstacleClearance
    this.allowViaInPad = options.allowViaInPad
    this.allowBlindAndBuriedVias = options.allowBlindAndBuriedVias
  }

  override isNodeTooCloseToObstacle(
    node: Parameters<
      SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost["isNodeTooCloseToObstacle"]
    >[0],
    margin?: number,
    isVia?: boolean,
    planarObstacleQuery?: Parameters<
      SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost["isNodeTooCloseToObstacle"]
    >[3],
  ): boolean {
    if (
      super.isNodeTooCloseToObstacle(node, margin, isVia, planarObstacleQuery)
    ) {
      return true
    }
    if (!isVia) return false
    const parentZ = node.parent?.z ?? node.z
    const viaZLayers = this.allowBlindAndBuriedVias
      ? new Set(
          Array.from(
            { length: Math.abs(node.z - parentZ) + 1 },
            (_, index) => Math.min(node.z, parentZ) + index,
          ),
        )
      : new Set(Array.from({ length: this.layerCount }, (_, z) => z))
    const requiredDistance = this.viaDiameter / 2 + this.viaObstacleClearance
    return this.preparedObstacles.some((prepared) => {
      if (
        this.allowViaInPad &&
        prepared.connectedToCurrentConnection &&
        prepared.obstacle.obstacleRole === "pad"
      ) {
        return false
      }
      if (![...viaZLayers].some((z) => prepared.zLayers.has(z))) return false
      if (
        node.x < prepared.bounds.minX - requiredDistance ||
        node.x > prepared.bounds.maxX + requiredDistance ||
        node.y < prepared.bounds.minY - requiredDistance ||
        node.y > prepared.bounds.maxY + requiredDistance
      ) {
        return false
      }
      return (
        getPointToObstacleDistance(node, prepared.obstacle) <
        requiredDistance - EPSILON
      )
    })
  }
}

const pointsEqual = (
  first: HighDensityIntraNodeRoute["route"][number],
  second: HighDensityIntraNodeRoute["route"][number],
): boolean => {
  if (Math.abs(first.x - second.x) > EPSILON) return false
  if (Math.abs(first.y - second.y) > EPSILON) return false
  if (first.z !== second.z) return false
  return true
}

const simplifyHdRoute = (
  route: HighDensityIntraNodeRoute,
): HighDensityIntraNodeRoute => {
  const points = route.route.filter((point, index, allPoints) => {
    if (index === 0 || index === allPoints.length - 1) return true
    const previous = allPoints[index - 1]!
    const next = allPoints[index + 1]!
    if (previous.z !== point.z || point.z !== next.z) return true
    const firstDx = point.x - previous.x
    const firstDy = point.y - previous.y
    const secondDx = next.x - point.x
    const secondDy = next.y - point.y
    return Math.abs(firstDx * secondDy - firstDy * secondDx) > EPSILON
  })
  return { ...route, route: points }
}

const ensureMinimumWireCount = ({
  route,
  width,
  minimumCount,
}: {
  route: SimplifiedPcbTrace["route"]
  width: number
  minimumCount: number
}): SimplifiedPcbTrace["route"] => {
  const output = structuredClone(route)
  const countMatchingWires = (): number => {
    let count = 0
    for (const point of output) {
      if (point.route_type === "wire" && point.width === width) count++
    }
    return count
  }
  while (countMatchingWires() < minimumCount) {
    let longestIndex = -1
    let longestLength = -1
    for (let index = 0; index < output.length - 1; index++) {
      const start = output[index]
      const end = output[index + 1]
      if (
        start?.route_type !== "wire" ||
        end?.route_type !== "wire" ||
        start.layer !== end.layer ||
        start.width !== width ||
        end.width !== width
      ) {
        continue
      }
      const length = Math.hypot(start.x - end.x, start.y - end.y)
      if (length > longestLength) {
        longestIndex = index
        longestLength = length
      }
    }
    if (longestIndex < 0 || longestLength <= EPSILON) break
    const start = output[longestIndex] as WirePoint
    const end = output[longestIndex + 1] as WirePoint
    output.splice(longestIndex + 1, 0, {
      route_type: "wire",
      x: (start.x + end.x) / 2,
      y: (start.y + end.y) / 2,
      width,
      layer: start.layer,
    })
  }
  return output
}

const createReplacement = ({
  trace,
  anchors,
  solvedRoute,
  srj,
  connectivityMap,
  width,
}: {
  trace: SimplifiedPcbTrace
  anchors: RouteIndexRange
  solvedRoute: HighDensityIntraNodeRoute
  srj: SimpleRouteJson
  connectivityMap: ConnectivityMap
  width: number
}): SimplifiedPcbTrace | undefined => {
  const startAnchor = trace.route[anchors.startIndex]
  const endAnchor = trace.route[anchors.endIndex]
  if (startAnchor?.route_type !== "wire" || endAnchor?.route_type !== "wire") {
    return undefined
  }
  const simplified = simplifyHdRoute(solvedRoute)
  const expectedStart = {
    x: startAnchor.x,
    y: startAnchor.y,
    z: mapLayerNameToZ(startAnchor.layer, srj.layerCount),
  }
  const expectedEnd = {
    x: endAnchor.x,
    y: endAnchor.y,
    z: mapLayerNameToZ(endAnchor.layer, srj.layerCount),
  }
  const orderedRoute =
    pointsEqual(simplified.route[0]!, expectedStart) &&
    pointsEqual(simplified.route.at(-1)!, expectedEnd)
      ? simplified
      : pointsEqual(simplified.route[0]!, expectedEnd) &&
          pointsEqual(simplified.route.at(-1)!, expectedStart)
        ? { ...simplified, route: [...simplified.route].reverse() }
        : undefined
  if (!orderedRoute) return undefined
  const converted = convertHdRouteToSimplifiedRoute(
    orderedRoute,
    srj.layerCount,
    {
      defaultViaHoleDiameter: getViaDimensions(srj).holeDiameter,
      connMap: connectivityMap,
    },
  )
  const firstWireIndex = converted.findIndex(
    (point) => point.route_type === "wire",
  )
  const lastWireIndex = converted.findLastIndex(
    (point) => point.route_type === "wire",
  )
  if (firstWireIndex < 0 || lastWireIndex < firstWireIndex) return undefined
  converted[firstWireIndex] = { ...converted[firstWireIndex]!, ...startAnchor }
  converted[lastWireIndex] = { ...converted[lastWireIndex]!, ...endAnchor }
  const mergedRoute = [
    ...trace.route.slice(0, anchors.startIndex),
    ...converted,
    ...trace.route.slice(anchors.endIndex + 1),
  ]
  const minimumWireCount = trace.route.filter(
    (point) => point.route_type === "wire" && point.width === width,
  ).length
  return {
    ...trace,
    route: ensureMinimumWireCount({
      route: mergedRoute,
      width,
      minimumCount: minimumWireCount,
    }),
  }
}

const createCandidateForConflictOwner = ({
  srj,
  traces,
  fixedTraces,
  connectivityMap,
  conflict,
  trace,
  allowedLayers,
  maxIterations,
  deadlineMs,
}: {
  srj: SimpleRouteJson
  traces: SimplifiedPcbTraces
  fixedTraces: SimplifiedPcbTraces
  connectivityMap: ConnectivityMap
  conflict: ContactSpanDrcConflict
  trace: SimplifiedPcbTrace
  allowedLayers: string[]
  maxIterations: number
  deadlineMs?: number
}): ContactSpanCandidateResult => {
  const seed = getNearestPrimitiveRange(trace, conflict.center)
  if (!seed) return { iterations: 0, runtimeBudgetExhausted: false }
  const otherTraces = [
    ...fixedTraces,
    ...traces.filter((other) => other !== trace),
  ]
  const viaDimensions = getViaDimensions(srj)
  const wireObstacleClearance = Math.max(
    srj.defaultObstacleMargin ?? 0,
    srj.minTraceToPadEdgeClearance ?? 0.1,
  )
  const contacts = getTraceContactRanges({
    trace,
    otherTraces,
    layerCount: srj.layerCount,
    defaultViaDiameter: viaDimensions.padDiameter,
    clearance: wireObstacleClearance,
    allowBlindAndBuriedVias: srj.allowBlindAndBuriedVias === true,
  })
  const affected = expandRangeAcrossContacts(seed, contacts)
  const anchors = getStableWireAnchors(trace, affected)
  if (!anchors) return { iterations: 0, runtimeBudgetExhausted: false }
  const width = getSpanWidth(trace, anchors)
  if (width === undefined)
    return { iterations: 0, runtimeBudgetExhausted: false }
  const bounds = getSpanBounds({ trace, anchors, boardBounds: srj.bounds })
  if (!bounds) return { iterations: 0, runtimeBudgetExhausted: false }
  const start = trace.route[anchors.startIndex]
  const end = trace.route[anchors.endIndex]
  if (start?.route_type !== "wire" || end?.route_type !== "wire") {
    return { iterations: 0, runtimeBudgetExhausted: false }
  }
  const availableZ = [...new Set(allowedLayers)].flatMap((layer) => {
    const z = mapLayerNameToZ(layer, srj.layerCount)
    return Number.isInteger(z) && z >= 0 && z < srj.layerCount ? [z] : []
  })
  const startZ = mapLayerNameToZ(start.layer, srj.layerCount)
  const endZ = mapLayerNameToZ(end.layer, srj.layerCount)
  if (!availableZ.includes(startZ) || !availableZ.includes(endZ)) {
    return { iterations: 0, runtimeBudgetExhausted: false }
  }
  const fixedRoutes = otherTraces.flatMap((other, traceIndex) =>
    convertPreloadedTraceToHdRoutes(
      other,
      traceIndex,
      srj.layerCount,
      viaDimensions.padDiameter,
      connectivityMap,
    ),
  )
  const connectionName = trace.connection_name ?? trace.pcb_trace_id
  const rootConnectionName =
    connectivityMap.getNetConnectedToId(connectionName) ?? connectionName
  const routeSolver = new ContactSpanRouteSolver({
    connectionName,
    rootConnectionName,
    obstacleRoutes: [
      ...fixedRoutes,
      ...createObstacleRoutes({ srj, connectivityMap }),
    ],
    minDistBetweenEnteringPoints: 0.2,
    bounds,
    A: { x: start.x, y: start.y, z: startZ },
    B: { x: end.x, y: end.y, z: endZ },
    viaDiameter: viaDimensions.padDiameter,
    traceThickness: width,
    obstacleMargin: wireObstacleClearance,
    nearbySegmentClearance: width + wireObstacleClearance,
    layerCount: srj.layerCount,
    allowBlindAndBuriedVias: srj.allowBlindAndBuriedVias === true,
    honorObstacleRouteDimensions: true,
    availableZ,
    futureConnections: [],
    hyperParameters: { CELL_SIZE_FACTOR: 0.5 },
    connMap: connectivityMap,
    captureSearchDebug: false,
    preparedObstacles: prepareObstacles({
      srj,
      connectionName,
      connectivityMap,
    }),
    viaObstacleClearance: Math.max(
      srj.defaultObstacleMargin ?? 0,
      srj.minViaEdgeToPadEdgeClearance ?? 0.1,
    ),
    allowViaInPad: srj.allowViaInPad === true,
  })
  routeSolver.GREEDY_MULTIPLER = 2
  routeSolver.VIA_PENALTY_FACTOR = 0.5
  routeSolver.MAX_ITERATIONS = maxIterations
  while (!routeSolver.solved && !routeSolver.failed) {
    if (deadlineMs !== undefined && performance.now() >= deadlineMs) {
      return {
        iterations: routeSolver.iterations,
        runtimeBudgetExhausted: true,
      }
    }
    routeSolver.step()
  }
  if (!routeSolver.solved || !routeSolver.solvedPath) {
    return {
      iterations: routeSolver.iterations,
      runtimeBudgetExhausted: false,
    }
  }
  return {
    candidate: createReplacement({
      trace,
      anchors,
      solvedRoute: routeSolver.solvedPath,
      srj,
      connectivityMap,
      width,
    }),
    iterations: routeSolver.iterations,
    runtimeBudgetExhausted: false,
  }
}

export const runContactSpanDrcRepairPass = (
  options: ContactSpanDrcRepairOptions,
): ContactSpanDrcRepairPassStats => {
  const maxSearches = options.maxSearches ?? 4
  const maxIterationsPerSearch = options.maxIterationsPerSearch ?? 50_000
  const stats: ContactSpanDrcRepairPassStats = {
    searchCount: 0,
    searchIterationCount: 0,
    accepted: false,
    runtimeBudgetExhausted: false,
  }
  const tracesById = new Map(
    options.traces.map((trace) => [trace.pcb_trace_id, trace]),
  )
  const conflicts = [...options.conflicts].sort((first, second) =>
    first.identity.localeCompare(second.identity),
  )
  for (const conflict of conflicts) {
    for (const ownerTraceId of [...conflict.ownerTraceIds].sort()) {
      if (stats.searchCount >= maxSearches) return stats
      const trace = tracesById.get(ownerTraceId)
      if (!trace) continue
      const allowedLayers = options.getAllowedLayers(trace)
      if (allowedLayers.length === 0) continue
      stats.searchCount++
      const result = createCandidateForConflictOwner({
        srj: options.srj,
        traces: options.traces,
        fixedTraces: options.fixedTraces,
        connectivityMap: options.connectivityMap,
        conflict,
        trace,
        allowedLayers,
        maxIterations: maxIterationsPerSearch,
        deadlineMs: options.deadlineMs,
      })
      stats.searchIterationCount += result.iterations
      if (result.runtimeBudgetExhausted) {
        stats.runtimeBudgetExhausted = true
        return stats
      }
      if (result.candidate && options.acceptCandidate(result.candidate)) {
        stats.accepted = true
        return stats
      }
    }
  }
  return stats
}
