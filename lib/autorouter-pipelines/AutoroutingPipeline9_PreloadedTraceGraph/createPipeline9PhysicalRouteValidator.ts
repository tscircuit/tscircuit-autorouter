import { getFixedObstacleViolations } from "@tscircuit/repair04"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { AutoroutingDrcEngine } from "high-density-repair03/lib"
import Flatbush from "flatbush"
import { PhysicalPortClearance } from "lib/solvers/AvailableSegmentPointSolver/PhysicalPortClearance"
import { getObstacleRouteConnectivity } from "lib/solvers/HyperHighDensitySolver/getObstacleRouteConnectivity"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"
import { doesSegmentCrossPolygonBoundary } from "lib/utils/polygonContainment"
import { getPipeline9RouteCopperGeometry } from "./pipeline9FixedRouteCopper"
import { createSrjWithBoardValidObstacleLayers } from "lib/utils/create-srj-with-board-valid-obstacle-layers"
import { getViaDimensions } from "lib/utils/getViaDimensions"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import { arePipeline9RoutesOnSameNet } from "./pipeline9FixedRouteCopper"

type PhysicalRouteValidationParams = {
  physicalSrj: SimpleRouteJson
  connMap: ConnectivityMap
  obstacleMargin: number
  viaHoleDiameter?: number
}
type RouteValidator = (routes: HighDensityRoute[]) => boolean

const validatorCache = new WeakMap<SimpleRouteJson, WeakMap<ConnectivityMap, Map<string, RouteValidator>>>()

/** Validates final coordinates after the grow/shrink solver restores their scale. */
export function createPipeline9PhysicalRouteValidator({
  physicalSrj,
  connMap,
  obstacleMargin,
  viaHoleDiameter,
}: PhysicalRouteValidationParams): (routes: HighDensityRoute[]) => boolean {
  let boardCache = validatorCache.get(physicalSrj)
  if (!boardCache) {
    boardCache = new WeakMap()
    validatorCache.set(physicalSrj, boardCache)
  }
  let mapCache = boardCache.get(connMap)
  if (!mapCache) {
    mapCache = new Map()
    boardCache.set(connMap, mapCache)
  }
  const cacheKey = JSON.stringify([obstacleMargin, viaHoleDiameter])
  const cached = mapCache.get(cacheKey)
  if (cached) return cached
  const normalized = createSrjWithBoardValidObstacleLayers(physicalSrj)
  const rawObstacles = [...normalized.obstacles, ...(normalized.jumpers?.flatMap((jumper) => jumper.pads) ?? [])]
  const obstacleIndex = rawObstacles.length > 0 ? new Flatbush(rawObstacles.length) : undefined
  for (const obstacle of rawObstacles) {
    const reach = Math.hypot(obstacle.width, obstacle.height) / 2
    if (![obstacle.center.x, obstacle.center.y, reach].every(Number.isFinite) || obstacle.width < 0 || obstacle.height < 0) throw new Error("Physical route validation requires finite obstacle geometry")
    obstacleIndex!.add(obstacle.center.x - reach, obstacle.center.y - reach, obstacle.center.x + reach, obstacle.center.y + reach)
  }
  obstacleIndex?.finish()
  const boardEdgeClearance = physicalSrj.minBoardEdgeClearance ?? 0
  const boardOnlySrj: SimpleRouteJson = {
    ...physicalSrj, obstacles: [], connections: [], traces: undefined,
    jumpers: undefined, minBoardEdgeClearance: boardEdgeClearance,
  }
  const boardClearanceByWidth = new Map<number, PhysicalPortClearance>()
  // Planning margins guide the search; acceptance uses the same declared
  // physical rules as Pipeline9's final DRC evaluator.
  const traceClearance = physicalSrj.minTraceToPadEdgeClearance ?? 0.1
  const viaClearance = physicalSrj.minViaEdgeToPadEdgeClearance ?? 0.1
  const viaHoleClearance = physicalSrj.minViaHoleEdgeToViaHoleEdgeClearance ?? 0.1
  const defaultViaHoleDiameter = viaHoleDiameter ?? getViaDimensions(physicalSrj).holeDiameter
  const validator = (routes: HighDensityRoute[]): boolean => {
    if (routes.length === 0) return true
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    let copperDiameter = 0
    for (const route of routes) {
      copperDiameter = Math.max(copperDiameter, route.traceThickness, route.viaDiameter)
      for (const point of route.route) {
        minX = Math.min(minX, point.x)
        maxX = Math.max(maxX, point.x)
        minY = Math.min(minY, point.y)
        maxY = Math.max(maxY, point.y)
      }
    }
    const radius = copperDiameter / 2 +
      Math.max(traceClearance, viaClearance, physicalSrj.defaultObstacleMargin ?? 0, physicalSrj.minTraceToHoleEdgeClearance ?? 0) + 1e-6
    // Circumscribed obstacle bounds also enclose rotated rectangles and ovals.
    // Filter only by physical separation, without requiring electrical ids.
    const nearby = obstacleIndex
      ? obstacleIndex.search(minX - radius, minY - radius, maxX + radius, maxY + radius).map((index) => rawObstacles[index]!)
      : []
    const ownership = getObstacleRouteConnectivity({ obstacles: nearby, routes, connMap })
    const srj: SimpleRouteJson = {
      ...physicalSrj, traces: undefined,
      obstacles: nearby.map((obstacle, index) => ({ ...obstacle, connectedTo: [...obstacle.connectedTo, ...ownership.connectedRouteNamesByObstacle[index]!] })),
      connections: routes.map((route) => ({ name: route.connectionName, __rootConnectionNames: [route.rootConnectionName ?? route.connectionName], pointsToConnect: [] })),
    }
    const traces = routes.map((route, index) => ({
      type: "pcb_trace" as const,
      pcb_trace_id: `physical-node-candidate-${index}`,
      connection_name: route.connectionName,
      route: convertHdRouteToSimplifiedRoute(route, srj.layerCount, { defaultViaHoleDiameter, obstacles: srj.obstacles, connMap }),
    }))
    const engine = new AutoroutingDrcEngine(srj as any, { connMap, traceClearance, viaClearance: 0.1, viaToPadClearance: viaClearance })
    // The indexed engine's via-pair cost measures copper even on one net.
    // Same-net annuli may overlap; distinct drill holes still need clearance.
    if (engine.evaluate(traces as any).errors.some((error) => error.pcb_via_pair_net_relation === undefined)) return false
    const vias = traces.flatMap((trace, routeIndex) => trace.route.flatMap((segment) => segment.route_type === "via" ? [{ segment, routeIndex, minZ: srj.allowBlindAndBuriedVias ? Math.min(mapLayerNameToZ(segment.from_layer, srj.layerCount), mapLayerNameToZ(segment.to_layer, srj.layerCount)) : 0, maxZ: srj.allowBlindAndBuriedVias ? Math.max(mapLayerNameToZ(segment.from_layer, srj.layerCount), mapLayerNameToZ(segment.to_layer, srj.layerCount)) : srj.layerCount - 1 }] : []))
    for (let firstIndex = 0; firstIndex < vias.length; firstIndex++) {
      const first = vias[firstIndex]!
      for (let secondIndex = firstIndex + 1; secondIndex < vias.length; secondIndex++) {
        const second = vias[secondIndex]!
        const overlap = first.minZ <= second.maxZ && second.minZ <= first.maxZ
        if (!overlap) continue
        const distance = Math.hypot(first.segment.x - second.segment.x, first.segment.y - second.segment.y)
        const sameNet = arePipeline9RoutesOnSameNet(routes[first.routeIndex]!, routes[second.routeIndex]!, connMap)
        if (sameNet && distance <= 1e-9) continue
        const drillDistance = (first.segment.via_hole_diameter ?? defaultViaHoleDiameter) / 2 + (second.segment.via_hole_diameter ?? defaultViaHoleDiameter) / 2 + viaHoleClearance
        const copperDistance = !sameNet ? (first.segment.via_diameter ?? routes[first.routeIndex]!.viaDiameter) / 2 + (second.segment.via_diameter ?? routes[second.routeIndex]!.viaDiameter) / 2 + 0.1 : 0
        if (distance + 1e-6 < Math.max(drillDistance, copperDistance)) return false
      }
    }
    // The fast engine omits unidentified keepouts and unconnected pads. The
    // raw geometry validator supplies those checks, including full via spans.
    if (getFixedObstacleViolations({ srj: srj as any, routes: routes as any, traceClearance, viaClearance }).length > 0) return false
    for (const route of routes) {
      const geometry = getPipeline9RouteCopperGeometry(route, srj)
      for (const segment of geometry.wireSegments) {
        let board = boardClearanceByWidth.get(segment.width)
        if (!board) {
          board = new PhysicalPortClearance(boardOnlySrj, segment.width, 0)
          boardClearanceByWidth.set(segment.width, board)
        }
        if (!board.isPointClear({ ...segment.start, z: segment.z }) || !board.isPointClear({ ...segment.end, z: segment.z })) return false
        if (srj.outline && doesSegmentCrossPolygonBoundary({ start: segment.start, end: segment.end, polygon: srj.outline, margin: segment.width / 2 + boardEdgeClearance })) return false
      }
      for (const via of geometry.viaSpans) {
        let board = boardClearanceByWidth.get(via.diameter)
        if (!board) {
          board = new PhysicalPortClearance(boardOnlySrj, via.diameter, 0)
          boardClearanceByWidth.set(via.diameter, board)
        }
        if (!board.isPointClear({ ...via.center, z: via.minZ })) return false
      }
    }
    return true
  }
  mapCache.set(cacheKey, validator)
  return validator
}
