import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import {
  GlobalDrcForceImproveSolver,
  type DrcEvaluator,
} from "high-density-repair03/lib"
import type {
  Obstacle,
  SimpleRouteConnection,
  SimpleRouteJson,
} from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { generateApproximatingRects } from "lib/utils/addApproximatingRectsToSrj"
import { mapZToLayerName } from "lib/utils/mapZToLayerName"
import { minimumDistanceBetweenSegments } from "lib/utils/minimumDistanceBetweenSegments"
import type { PreloadedHighDensityRoute } from "./convert-preloaded-traces-to-hd-routes"
import {
  createRegionalFallbackProblem,
  spliceFixedRouteSection,
} from "./pipeline9-regional-fallback"
import { Pipeline9HighDensitySolver } from "./pipeline9-high-density-solver"
import { Pipeline9RegionalFallbackSolver } from "./pipeline9-regional-fallback-solver"
import {
  getPipeline9DrcErrors,
  getPipeline9RouteIndexByTraceId,
  isPipeline9DrcCandidateBetter,
  type Pipeline9DrcError,
} from "./pipeline9-joint-drc-repair-utils"

type RegionalB01RepairResult = {
  routes: HighDensityRoute[]
  attemptedCandidateCount: number
  acceptedCandidateCount: number
  fallbackCandidateCount: number
}

type RouteWireSegment = {
  start: HighDensityRoute["route"][number]
  end: HighDensityRoute["route"][number]
  z: number
  width: number
}

type RouteViaSpan = {
  center: { x: number; y: number }
  minZ: number
  maxZ: number
  diameter: number
}

type RouteCopperGeometry = {
  wireSegments: RouteWireSegment[]
  viaSpans: RouteViaSpan[]
}

type Bounds = {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

type AxisAlignedRect = {
  center: { x: number; y: number }
  width: number
  height: number
}

type FixedRouteCopperSpatialIndex = {
  getRoutesOverlappingBounds: (bounds: Bounds) => PreloadedHighDensityRoute[]
}

const REGION_SIZES = [3, 4, 5, 6, 8]
const FIXED_ROUTE_INDEX_CELL_SIZE = 4
const FIXED_WIRE_MAX_APPROXIMATION_LENGTH = 0.75
const routeCopperGeometryCache = new WeakMap<
  HighDensityRoute,
  RouteCopperGeometry
>()

const getErrorCenter = (error: Pipeline9DrcError) => {
  const center = error.center
  return center &&
    typeof center === "object" &&
    "x" in center &&
    "y" in center &&
    typeof center.x === "number" &&
    typeof center.y === "number"
    ? { x: center.x, y: center.y }
    : undefined
}

const getRepairCenter = (error: Pipeline9DrcError, srj: SimpleRouteJson) => {
  const obstacleId =
    typeof error.pcb_pad_id === "string"
      ? error.pcb_pad_id
      : typeof error.pcb_trace_error_id === "string"
        ? error.pcb_trace_error_id.match(
            /(pcb_(?:smtpad|plated_hole|hole|keepout)_\d+)$/,
          )?.[1]
        : undefined
  if (obstacleId) {
    const obstacle = srj.obstacles.find(
      (candidate) =>
        candidate.obstacleId === obstacleId ||
        candidate.connectedTo[0] === obstacleId,
    )
    if (obstacle) return obstacle.center
  }
  return getErrorCenter(error)
}

export const getPipeline9RegionalRepairTraceIds = ({
  error,
  routeIndexByTraceId,
}: {
  error: Pipeline9DrcError
  routeIndexByTraceId: ReadonlyMap<string, number>
}): string[] => {
  const primaryTraceId =
    typeof error.pcb_trace_id === "string" ? error.pcb_trace_id : undefined
  const viaIds = [
    ...(typeof error.pcb_via_id === "string" ? [error.pcb_via_id] : []),
    ...(Array.isArray(error.pcb_via_ids)
      ? error.pcb_via_ids.filter(
          (viaId): viaId is string => typeof viaId === "string",
        )
      : []),
  ]
  const pairPrefix = primaryTraceId ? `overlap_${primaryTraceId}_` : undefined
  const encodedOtherTraceId =
    pairPrefix &&
    typeof error.pcb_trace_error_id === "string" &&
    error.pcb_trace_error_id.startsWith(pairPrefix)
      ? error.pcb_trace_error_id.slice(pairPrefix.length)
      : undefined
  const encodedIdentityIsVia =
    encodedOtherTraceId !== undefined && viaIds.includes(encodedOtherTraceId)

  return [
    primaryTraceId,
    ...(Array.isArray(error.pcb_trace_ids) ? error.pcb_trace_ids : []),
    encodedIdentityIsVia ? undefined : encodedOtherTraceId,
  ]
    .filter(
      (traceId): traceId is string =>
        typeof traceId === "string" && routeIndexByTraceId.has(traceId),
    )
    .filter(
      (traceId, traceIndex, allTraceIds) =>
        allTraceIds.indexOf(traceId) === traceIndex,
    )
}

const asRegionalRoutes = (
  routes: HighDensityRoute[],
): PreloadedHighDensityRoute[] =>
  routes.map((route, routeIndex) => ({
    ...route,
    preloadedTraceId: `pipeline9_joint_candidate_${routeIndex}`,
    preloadedTraceIndex: routeIndex,
    preloadedRouteIndex: 0,
  }))

const getRouteCopperGeometry = (
  route: HighDensityRoute,
): RouteCopperGeometry => {
  const cachedGeometry = routeCopperGeometryCache.get(route)
  if (cachedGeometry) return cachedGeometry
  const wireSegments: RouteWireSegment[] = []
  const viaSpans: RouteViaSpan[] = []
  for (
    let routePointIndex = 1;
    routePointIndex < route.route.length;
    routePointIndex++
  ) {
    const start = route.route[routePointIndex - 1]!
    const end = route.route[routePointIndex]!
    const xyDistance = Math.hypot(end.x - start.x, end.y - start.y)
    const segmentWidth = Math.max(
      start.traceThickness ?? route.traceThickness,
      end.traceThickness ?? route.traceThickness,
    )
    if (start.z !== end.z && start.toNextSegmentType === "through_obstacle") {
      const minZ = Math.min(start.z, end.z)
      const maxZ = Math.max(start.z, end.z)
      if (xyDistance <= 1e-9) {
        const hasExplicitVia = route.vias.some(
          (via) => Math.hypot(via.x - end.x, via.y - end.y) <= 1e-9,
        )
        viaSpans.push({
          center: { x: end.x, y: end.y },
          minZ,
          maxZ,
          diameter: hasExplicitVia ? route.viaDiameter : segmentWidth,
        })
        continue
      }
      for (let z = minZ; z <= maxZ; z++) {
        wireSegments.push({
          start: { ...start, z },
          end: { ...end, z },
          z,
          width: segmentWidth,
        })
      }
      continue
    }
    if (xyDistance > 1e-9) {
      wireSegments.push({
        start,
        end: start.z === end.z ? end : { ...end, z: start.z },
        z: start.z,
        width: segmentWidth,
      })
    }
    if (start.z === end.z) continue
    viaSpans.push({
      center: { x: end.x, y: end.y },
      minZ: Math.min(start.z, end.z),
      maxZ: Math.max(start.z, end.z),
      diameter: route.viaDiameter,
    })
  }
  const geometry = { wireSegments, viaSpans }
  routeCopperGeometryCache.set(route, geometry)
  return geometry
}

const boundsOverlap = (left: Bounds, right: Bounds): boolean => {
  return (
    left.minX <= right.maxX &&
    left.maxX >= right.minX &&
    left.minY <= right.maxY &&
    left.maxY >= right.minY
  )
}

const wireSegmentBounds = (segment: RouteWireSegment): Bounds => ({
  minX: Math.min(segment.start.x, segment.end.x) - segment.width / 2,
  maxX: Math.max(segment.start.x, segment.end.x) + segment.width / 2,
  minY: Math.min(segment.start.y, segment.end.y) - segment.width / 2,
  maxY: Math.max(segment.start.y, segment.end.y) + segment.width / 2,
})

const viaSpanBounds = (via: RouteViaSpan): Bounds => ({
  minX: via.center.x - via.diameter / 2,
  maxX: via.center.x + via.diameter / 2,
  minY: via.center.y - via.diameter / 2,
  maxY: via.center.y + via.diameter / 2,
})

const rectBounds = (rect: AxisAlignedRect): Bounds => ({
  minX: rect.center.x - rect.width / 2,
  maxX: rect.center.x + rect.width / 2,
  minY: rect.center.y - rect.height / 2,
  maxY: rect.center.y + rect.height / 2,
})

const getAxisAlignedWireApproximations = (
  segment: RouteWireSegment,
  maxApproximationLength: number,
  minimumRectCount: number,
): AxisAlignedRect[] => {
  const dx = segment.end.x - segment.start.x
  const dy = segment.end.y - segment.start.y
  const segmentLength = Math.hypot(dx, dy)
  const center = {
    x: (segment.start.x + segment.end.x) / 2,
    y: (segment.start.y + segment.end.y) / 2,
  }
  if (Math.abs(dx) <= 1e-9 || Math.abs(dy) <= 1e-9) {
    return [
      {
        center,
        width: Math.abs(dx) > Math.abs(dy) ? segmentLength : segment.width,
        height: Math.abs(dx) > Math.abs(dy) ? segment.width : segmentLength,
      },
    ]
  }
  return generateApproximatingRects(
    {
      center,
      width: segmentLength,
      height: segment.width,
      rotation: (Math.atan2(dy, dx) * 180) / Math.PI,
    },
    Math.max(
      minimumRectCount,
      Math.ceil(segmentLength / maxApproximationLength),
    ),
  )
}

const routeCopperOverlapsBounds = (
  route: HighDensityRoute,
  bounds: Bounds,
): boolean => {
  const geometry = getRouteCopperGeometry(route)
  return (
    geometry.wireSegments.some((segment) =>
      boundsOverlap(wireSegmentBounds(segment), bounds),
    ) ||
    geometry.viaSpans.some((via) => boundsOverlap(viaSpanBounds(via), bounds))
  )
}

const createFixedRouteCopperSpatialIndex = (
  routes: PreloadedHighDensityRoute[],
): FixedRouteCopperSpatialIndex => {
  const routeIndexesByCell = new Map<string, Set<number>>()
  const addBounds = (routeIndex: number, bounds: Bounds): void => {
    const minCellX = Math.floor(bounds.minX / FIXED_ROUTE_INDEX_CELL_SIZE)
    const maxCellX = Math.floor(bounds.maxX / FIXED_ROUTE_INDEX_CELL_SIZE)
    const minCellY = Math.floor(bounds.minY / FIXED_ROUTE_INDEX_CELL_SIZE)
    const maxCellY = Math.floor(bounds.maxY / FIXED_ROUTE_INDEX_CELL_SIZE)
    for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
      for (let cellY = minCellY; cellY <= maxCellY; cellY++) {
        const cellKey = `${cellX}:${cellY}`
        const routeIndexes = routeIndexesByCell.get(cellKey) ?? new Set()
        routeIndexes.add(routeIndex)
        routeIndexesByCell.set(cellKey, routeIndexes)
      }
    }
  }

  for (let routeIndex = 0; routeIndex < routes.length; routeIndex++) {
    const geometry = getRouteCopperGeometry(routes[routeIndex]!)
    for (const wireSegment of geometry.wireSegments) {
      for (const rect of getAxisAlignedWireApproximations(
        wireSegment,
        FIXED_ROUTE_INDEX_CELL_SIZE,
        1,
      )) {
        addBounds(routeIndex, rectBounds(rect))
      }
    }
    for (const viaSpan of geometry.viaSpans) {
      addBounds(routeIndex, viaSpanBounds(viaSpan))
    }
  }

  return {
    getRoutesOverlappingBounds: (bounds) => {
      const routeIndexes = new Set<number>()
      const minCellX = Math.floor(bounds.minX / FIXED_ROUTE_INDEX_CELL_SIZE)
      const maxCellX = Math.floor(bounds.maxX / FIXED_ROUTE_INDEX_CELL_SIZE)
      const minCellY = Math.floor(bounds.minY / FIXED_ROUTE_INDEX_CELL_SIZE)
      const maxCellY = Math.floor(bounds.maxY / FIXED_ROUTE_INDEX_CELL_SIZE)
      for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
        for (let cellY = minCellY; cellY <= maxCellY; cellY++) {
          for (const routeIndex of routeIndexesByCell.get(
            `${cellX}:${cellY}`,
          ) ?? []) {
            routeIndexes.add(routeIndex)
          }
        }
      }
      return [...routeIndexes]
        .sort((left, right) => left - right)
        .map((routeIndex) => routes[routeIndex]!)
        .filter((route) => routeCopperOverlapsBounds(route, bounds))
    },
  }
}

export const getPipeline9FixedRouteObstacles = ({
  fixedObstacleRoutes,
  srj,
}: {
  fixedObstacleRoutes: PreloadedHighDensityRoute[]
  srj: SimpleRouteJson
}): Obstacle[] => {
  return fixedObstacleRoutes.flatMap((route, routeIndex) => {
    const connectedTo = [route.connectionName, route.rootConnectionName].filter(
      (connectedId): connectedId is string => typeof connectedId === "string",
    )
    const geometry = getRouteCopperGeometry(route)
    return [
      ...geometry.wireSegments.flatMap((segment, segmentIndex): Obstacle[] => {
        const approximatingRects = getAxisAlignedWireApproximations(
          segment,
          FIXED_WIRE_MAX_APPROXIMATION_LENGTH,
          2,
        )
        return approximatingRects.map((rect, approximationIndex) => ({
          obstacleId: `pipeline9_fixed_obstacle_${routeIndex}_wire_${segmentIndex}_${approximationIndex}`,
          type: "rect",
          layers: [mapZToLayerName(segment.z, srj.layerCount)],
          center: rect.center,
          width: rect.width,
          height: rect.height,
          connectedTo,
        }))
      }),
      ...geometry.viaSpans.map(
        (via, viaIndex): Obstacle => ({
          obstacleId: `pipeline9_fixed_obstacle_${routeIndex}_via_${viaIndex}`,
          type: "rect",
          layers: Array.from(
            { length: via.maxZ - via.minZ + 1 },
            (_, layerOffset) =>
              mapZToLayerName(via.minZ + layerOffset, srj.layerCount),
          ),
          center: via.center,
          width: via.diameter,
          height: via.diameter,
          connectedTo,
        }),
      ),
    ]
  })
}

const routesAreOnSameNet = (
  left: HighDensityRoute,
  right: HighDensityRoute,
  connMap: ConnectivityMap,
): boolean => {
  const leftIds = [left.connectionName, left.rootConnectionName].filter(
    (id): id is string => typeof id === "string",
  )
  const rightIds = [right.connectionName, right.rootConnectionName].filter(
    (id): id is string => typeof id === "string",
  )
  return leftIds.some((leftId) =>
    rightIds.some(
      (rightId) =>
        leftId === rightId || connMap.areIdsConnected(leftId, rightId),
    ),
  )
}

const routesHaveCopperConflict = ({
  left,
  right,
  clearance,
  leftBounds,
}: {
  left: HighDensityRoute
  right: HighDensityRoute
  clearance: number
  leftBounds?: Bounds
}): boolean => {
  const leftGeometry = getRouteCopperGeometry(left)
  const rightGeometry = getRouteCopperGeometry(right)
  const leftWires = leftBounds
    ? leftGeometry.wireSegments.filter((segment) =>
        boundsOverlap(wireSegmentBounds(segment), leftBounds),
      )
    : leftGeometry.wireSegments
  const leftVias = leftBounds
    ? leftGeometry.viaSpans.filter((via) =>
        boundsOverlap(viaSpanBounds(via), leftBounds),
      )
    : leftGeometry.viaSpans
  for (const leftWire of leftWires) {
    for (const rightWire of rightGeometry.wireSegments) {
      if (leftWire.z !== rightWire.z) continue
      const requiredClearance =
        leftWire.width / 2 + rightWire.width / 2 + clearance
      if (
        minimumDistanceBetweenSegments(
          leftWire.start,
          leftWire.end,
          rightWire.start,
          rightWire.end,
        ) < requiredClearance
      ) {
        return true
      }
    }
    for (const rightVia of rightGeometry.viaSpans) {
      if (leftWire.z < rightVia.minZ || leftWire.z > rightVia.maxZ) continue
      const requiredClearance =
        leftWire.width / 2 + rightVia.diameter / 2 + clearance
      if (
        minimumDistanceBetweenSegments(
          leftWire.start,
          leftWire.end,
          rightVia.center,
          rightVia.center,
        ) < requiredClearance
      ) {
        return true
      }
    }
  }
  for (const leftVia of leftVias) {
    for (const rightWire of rightGeometry.wireSegments) {
      if (rightWire.z < leftVia.minZ || rightWire.z > leftVia.maxZ) continue
      const requiredClearance =
        leftVia.diameter / 2 + rightWire.width / 2 + clearance
      if (
        minimumDistanceBetweenSegments(
          leftVia.center,
          leftVia.center,
          rightWire.start,
          rightWire.end,
        ) < requiredClearance
      ) {
        return true
      }
    }
    for (const rightVia of rightGeometry.viaSpans) {
      if (leftVia.minZ > rightVia.maxZ || rightVia.minZ > leftVia.maxZ) continue
      const requiredClearance =
        leftVia.diameter / 2 + rightVia.diameter / 2 + clearance
      if (
        Math.hypot(
          leftVia.center.x - rightVia.center.x,
          leftVia.center.y - rightVia.center.y,
        ) < requiredClearance
      ) {
        return true
      }
    }
  }
  return false
}

const candidateConflictsWithFixedRoutes = ({
  candidateRoutes,
  fixedObstacleRoutes,
  obstacleMargin,
  connMap,
  candidateBounds,
}: {
  candidateRoutes: HighDensityRoute[]
  fixedObstacleRoutes: PreloadedHighDensityRoute[]
  obstacleMargin: number
  connMap: ConnectivityMap
  candidateBounds?: Bounds
}): boolean => {
  for (const candidateRoute of candidateRoutes) {
    for (const fixedRoute of fixedObstacleRoutes) {
      if (routesAreOnSameNet(candidateRoute, fixedRoute, connMap)) continue
      if (
        routesHaveCopperConflict({
          left: candidateRoute,
          right: fixedRoute,
          clearance: obstacleMargin,
          leftBounds: candidateBounds,
        })
      ) {
        return true
      }
    }
  }
  return false
}

const getRegionalCandidate = ({
  routes,
  fixedObstacleRoutes,
  routeIndex,
  center,
  regionSize,
  srj,
  connMap,
  colorMap,
  viaDiameter,
  traceWidth,
  obstacleMargin,
  effort,
}: {
  routes: HighDensityRoute[]
  fixedObstacleRoutes: PreloadedHighDensityRoute[]
  routeIndex: number
  center: { x: number; y: number }
  regionSize: number
  srj: SimpleRouteJson
  connMap: ConnectivityMap
  colorMap: Record<string, string>
  viaDiameter: number
  traceWidth: number
  obstacleMargin: number
  effort: number
}):
  | {
      routes: HighDensityRoute[]
      usedFallback: boolean
    }
  | undefined => {
  const regionalRoutes = asRegionalRoutes(routes)
  const movableRoute = regionalRoutes[routeIndex]
  if (!movableRoute) return undefined
  const node = {
    capacityMeshNodeId: `pipeline9_joint_drc_${routeIndex}_${regionSize}`,
    center,
    width: regionSize,
    height: regionSize,
    availableZ: Array.from({ length: srj.layerCount }, (_, z) => z),
    portPoints: [],
    portPointsInPairs: [],
  }
  const movableProblem = createRegionalFallbackProblem(node, [movableRoute])
  const movableSection = movableProblem.fixedRouteSectionsByConnectionName.get(
    movableRoute.connectionName,
  )
  if (!movableSection) return undefined

  const fixedRoutes = regionalRoutes.filter(
    (_, candidateRouteIndex) => candidateRouteIndex !== routeIndex,
  )
  const solver = new Pipeline9HighDensitySolver({
    nodePortPoints: [movableProblem.nodeWithPortPoints],
    fixedHdRoutes: [...fixedRoutes, ...fixedObstacleRoutes],
    connMap,
    colorMap,
    obstacles: srj.obstacles,
    layerCount: srj.layerCount,
    viaDiameter,
    traceWidth,
    obstacleMargin,
    effort,
    preserveTerminalPcbPortIds: true,
    includeBoardObstacles: true,
    enableRegionalFallback: false,
    maxB01Rips: 120,
  })
  solver.solve()
  if (!solver.solved || solver.failed) return undefined
  const replacement = solver.routes.find(
    (route) => route.connectionName === movableRoute.connectionName,
  )
  if (!replacement) return undefined

  return {
    routes: routes.map((route, candidateRouteIndex) =>
      candidateRouteIndex === routeIndex
        ? spliceFixedRouteSection(movableSection, replacement)
        : route,
    ),
    usedFallback: Number(solver.stats.fallbackNodeCount ?? 0) > 0,
  }
}

const getRegularRegionalCandidate = ({
  routes,
  fixedRouteCopperSpatialIndex,
  center,
  regionSize,
  srj,
  connMap,
  colorMap,
  viaDiameter,
  traceWidth,
  obstacleMargin,
  effort,
}: {
  routes: HighDensityRoute[]
  fixedRouteCopperSpatialIndex: FixedRouteCopperSpatialIndex
  center: { x: number; y: number }
  regionSize: number
  srj: SimpleRouteJson
  connMap: ConnectivityMap
  colorMap: Record<string, string>
  viaDiameter: number
  traceWidth: number
  obstacleMargin: number
  effort: number
}): HighDensityRoute[] | undefined => {
  const regionalRoutes = asRegionalRoutes(routes)
  const node = {
    capacityMeshNodeId: "pipeline9_joint_drc_regular_fallback",
    center,
    width: regionSize,
    height: regionSize,
    availableZ: Array.from({ length: srj.layerCount }, (_, z) => z),
    portPoints: [],
    portPointsInPairs: [],
  }
  const problem = createRegionalFallbackProblem(node, regionalRoutes)
  if (problem.fixedRouteSectionsByConnectionName.size === 0) return undefined
  const regionalSourceRoutes = [
    ...problem.fixedRouteSectionsByConnectionName.values(),
  ].flatMap((section) => section.sourceRoutes)
  const maxRegionalCopperRadius = regionalSourceRoutes.reduce(
    (maxRadius, route) => {
      const geometry = getRouteCopperGeometry(route)
      return Math.max(
        maxRadius,
        route.viaDiameter / 2,
        ...geometry.wireSegments.map((segment) => segment.width / 2),
        ...geometry.viaSpans.map((via) => via.diameter / 2),
      )
    },
    Math.max(traceWidth / 2, viaDiameter / 2),
  )
  const candidateBounds: Bounds = {
    minX: center.x - regionSize / 2 - obstacleMargin - maxRegionalCopperRadius,
    maxX: center.x + regionSize / 2 + obstacleMargin + maxRegionalCopperRadius,
    minY: center.y - regionSize / 2 - obstacleMargin - maxRegionalCopperRadius,
    maxY: center.y + regionSize / 2 + obstacleMargin + maxRegionalCopperRadius,
  }
  const localFixedObstacleRoutes =
    fixedRouteCopperSpatialIndex.getRoutesOverlappingBounds(candidateBounds)
  const fixedRouteObstacles = getPipeline9FixedRouteObstacles({
    fixedObstacleRoutes: localFixedObstacleRoutes,
    srj,
  })
  const solver = new Pipeline9RegionalFallbackSolver({
    nodeWithPortPoints: problem.nodeWithPortPoints,
    colorMap,
    connMap,
    viaDiameter,
    traceWidth,
    obstacleMargin,
    effort,
    obstacles: [...srj.obstacles, ...fixedRouteObstacles],
    layerCount: srj.layerCount,
  })
  solver.solve()
  if (!solver.solved || solver.failed) return undefined
  const solverOutput = solver.getOutput()
  const replacementByConnectionName = new Map(
    solverOutput.map((route) => [route.connectionName, route]),
  )
  const replacedRouteByOriginalIndex = new Map<number, HighDensityRoute>()
  const removedOriginalIndexes = new Set<number>()
  for (const [
    connectionName,
    section,
  ] of problem.fixedRouteSectionsByConnectionName) {
    const replacement = replacementByConnectionName.get(connectionName)
    if (!replacement) return undefined
    replacedRouteByOriginalIndex.set(
      section.sourceRoutes[0]!.preloadedTraceIndex,
      spliceFixedRouteSection(section, replacement),
    )
    for (const sourceRoute of section.sourceRoutes.slice(1)) {
      removedOriginalIndexes.add(sourceRoute.preloadedTraceIndex)
    }
  }
  const candidateRoutes = regionalRoutes.flatMap((route, routeIndex) => {
    if (removedOriginalIndexes.has(routeIndex)) return []
    return [replacedRouteByOriginalIndex.get(routeIndex) ?? route]
  })
  if (
    candidateConflictsWithFixedRoutes({
      candidateRoutes,
      fixedObstacleRoutes: localFixedObstacleRoutes,
      obstacleMargin,
      connMap,
      candidateBounds,
    })
  ) {
    return undefined
  }
  return candidateRoutes
}

/**
 * Reroutes one exact DRC participant with B01 in a sub-15mm window. B01 sees
 * every other route plus board copper as obstacles. If no B01 candidate helps,
 * one regular high-density candidate jointly reroutes all traces in the region.
 */
export const applyPipeline9RegionalB01Repairs = ({
  srj,
  routes,
  fixedObstacleRoutes,
  newConnections,
  syntheticConnectionNames,
  drcEvaluator,
  connMap,
  colorMap,
  viaDiameter,
  traceWidth,
  obstacleMargin,
  effort,
}: {
  srj: SimpleRouteJson
  routes: HighDensityRoute[]
  fixedObstacleRoutes: PreloadedHighDensityRoute[]
  newConnections: SimpleRouteConnection[]
  syntheticConnectionNames: ReadonlySet<string>
  drcEvaluator: DrcEvaluator
  connMap: ConnectivityMap
  colorMap: Record<string, string>
  viaDiameter: number
  traceWidth: number
  obstacleMargin: number
  effort: number
}): RegionalB01RepairResult => {
  let currentRoutes = routes
  let currentErrors = getPipeline9DrcErrors(drcEvaluator, currentRoutes)
  let attemptedCandidateCount = 0
  let acceptedCandidateCount = 0
  let fallbackCandidateCount = 0
  const fixedRouteCopperSpatialIndex =
    createFixedRouteCopperSpatialIndex(fixedObstacleRoutes)

  for (let pass = 0; pass < 2; pass++) {
    let acceptedOnPass = false
    const routeIndexByTraceId = getPipeline9RouteIndexByTraceId({
      routes: currentRoutes,
      newConnections,
      syntheticConnectionNames,
    })
    const repairableErrors = currentErrors.filter(
      (error) =>
        (error.type === "pcb_trace_error" ||
          error.type === "pcb_pad_trace_clearance_error" ||
          error.type === "pcb_via_trace_clearance_error" ||
          error.type === "pcb_via_clearance_error") &&
        typeof error.pcb_trace_id === "string",
    )
    for (const error of repairableErrors) {
      const center = getRepairCenter(error, srj)
      const traceIds = getPipeline9RegionalRepairTraceIds({
        error,
        routeIndexByTraceId,
      })
      if (!center) continue
      let bestRoutes = currentRoutes
      let bestErrors = currentErrors
      for (const traceId of traceIds.slice(0, 2)) {
        const routeIndex = routeIndexByTraceId.get(traceId)
        if (routeIndex === undefined) continue
        for (const regionSize of REGION_SIZES) {
          const candidate = getRegionalCandidate({
            routes: currentRoutes,
            fixedObstacleRoutes,
            routeIndex,
            center,
            regionSize,
            srj,
            connMap,
            colorMap,
            viaDiameter,
            traceWidth,
            obstacleMargin,
            effort,
          })
          if (!candidate) continue
          attemptedCandidateCount++
          if (candidate.usedFallback) fallbackCandidateCount++
          const candidateErrors = getPipeline9DrcErrors(
            drcEvaluator,
            candidate.routes,
          )
          if (isPipeline9DrcCandidateBetter(candidateErrors, bestErrors)) {
            bestRoutes = candidate.routes
            bestErrors = candidateErrors
          }
          if (bestErrors.length === 0) break
        }
        if (bestErrors.length === 0) break
      }
      if (bestRoutes === currentRoutes) {
        const fallbackRoutes = getRegularRegionalCandidate({
          routes: currentRoutes,
          fixedRouteCopperSpatialIndex,
          center,
          regionSize: 3,
          srj,
          connMap,
          colorMap,
          viaDiameter,
          traceWidth,
          obstacleMargin,
          effort,
        })
        if (fallbackRoutes) {
          attemptedCandidateCount++
          fallbackCandidateCount++
          const fallbackErrors = getPipeline9DrcErrors(
            drcEvaluator,
            fallbackRoutes,
          )
          if (isPipeline9DrcCandidateBetter(fallbackErrors, bestErrors)) {
            bestRoutes = fallbackRoutes
            bestErrors = fallbackErrors
          }
        }
      }
      if (bestRoutes !== currentRoutes) {
        currentRoutes = bestRoutes
        currentErrors = bestErrors
        acceptedCandidateCount++
        acceptedOnPass = true
      }
    }
    if (!acceptedOnPass || currentErrors.length === 0) break
  }

  const hasSafeLayerRepairableError = currentErrors.some(
    (error) =>
      error.type === "pcb_trace_error" ||
      error.type === "pcb_pad_trace_clearance_error",
  )
  if (hasSafeLayerRepairableError) {
    const safeTraceLayerSolver = new GlobalDrcForceImproveSolver({
      srj: { ...srj, traces: undefined },
      hdRoutes: currentRoutes,
      connMap,
      effort,
      drcEvaluator,
      maxIterations: 8,
      enableLargeBoardBroadFallback: false,
      enableTargetedErrorSweep: false,
      enablePostSolveClearanceRelaxation: false,
      enableSafeTraceLayerMoves: true,
      enableViaInPadLayerMoves: false,
    })
    safeTraceLayerSolver.solve()
    if (safeTraceLayerSolver.failed) {
      throw new Error(
        `Pipeline9 post-regional safe trace-layer repair failed: ${safeTraceLayerSolver.error ?? "unknown error"}`,
      )
    }
    const safeLayerRoutes = safeTraceLayerSolver.getOutput()
    const safeLayerErrors = getPipeline9DrcErrors(drcEvaluator, safeLayerRoutes)
    if (isPipeline9DrcCandidateBetter(safeLayerErrors, currentErrors)) {
      currentRoutes = safeLayerRoutes
      currentErrors = safeLayerErrors
    }
  }

  return {
    routes: currentRoutes,
    attemptedCandidateCount,
    acceptedCandidateCount,
    fallbackCandidateCount,
  }
}
