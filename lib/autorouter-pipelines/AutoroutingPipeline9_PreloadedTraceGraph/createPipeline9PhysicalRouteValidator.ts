import { getFixedObstacleViolations } from "@tscircuit/repair04"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { AutoroutingDrcEngine } from "high-density-repair03/lib"
import Flatbush from "flatbush"
import { pointToSegmentDistance } from "@tscircuit/math-utils"
import { getObstacleRouteConnectivity } from "lib/solvers/HyperHighDensitySolver/getObstacleRouteConnectivity"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"
import { doesSegmentCrossPolygonBoundary, isPointInOrOnPolygon } from "lib/utils/polygonContainment"
import { getPipeline9RouteCopperGeometry } from "./pipeline9FixedRouteCopper"
import { createSrjWithBoardValidObstacleLayers } from "lib/utils/create-srj-with-board-valid-obstacle-layers"
import { getViaDimensions } from "lib/utils/getViaDimensions"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { isOpaqueUnownedObstacle } from "lib/utils/isOpaqueUnownedObstacle"
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
  const physicalConnMap = getConnectivityMapFromSimpleRouteJson(normalized, { includeGeometricPointConnections: false })
  const rawObstacles = [...normalized.obstacles, ...(normalized.jumpers?.flatMap((jumper) => jumper.pads) ?? [])]
  const obstacleIndex = rawObstacles.length > 0 ? new Flatbush(rawObstacles.length) : undefined
  for (const obstacle of rawObstacles) {
    const reach = Math.hypot(obstacle.width, obstacle.height) / 2
    if (![obstacle.center.x, obstacle.center.y, reach].every(Number.isFinite) || obstacle.width < 0 || obstacle.height < 0) throw new Error("Physical route validation requires finite obstacle geometry")
    obstacleIndex!.add(obstacle.center.x - reach, obstacle.center.y - reach, obstacle.center.x + reach, obstacle.center.y + reach)
  }
  obstacleIndex?.finish()
  const boardEdgeClearance = physicalSrj.minBoardEdgeClearance ?? 0
  const isPointInsideBoard = (point: { x: number; y: number }, copperRadius: number): boolean => {
    const radius = copperRadius + boardEdgeClearance
    const { bounds, outline } = physicalSrj
    if (![point.x, point.y, radius].every(Number.isFinite) || point.x - radius < bounds.minX || point.x + radius > bounds.maxX || point.y - radius < bounds.minY || point.y + radius > bounds.maxY) return false
    if (!outline) return true
    if (!isPointInOrOnPolygon(point, outline)) return false
    return outline.every((start, index) => pointToSegmentDistance(point, start, outline[(index + 1) % outline.length]!) >= radius - 1e-6)
  }
  // Planning margins guide the search; acceptance uses the same declared
  // physical rules as Pipeline9's final DRC evaluator.
  const traceClearance = physicalSrj.minTraceToPadEdgeClearance ?? 0.1
  const viaClearance = physicalSrj.minViaEdgeToPadEdgeClearance ?? physicalSrj.minPadEdgeToPadEdgeClearance ?? 0.1
  const viaHoleClearance = physicalSrj.minViaHoleEdgeToViaHoleEdgeClearance ?? 0.1
  const viaCopperClearance = physicalSrj.minPadEdgeToPadEdgeClearance ?? 0.1
  const defaultViaHoleDiameter = viaHoleDiameter ?? getViaDimensions(physicalSrj).holeDiameter
  const validator = (inputRoutes: HighDensityRoute[]): boolean => {
    const routes = inputRoutes.map((route) => ({
      ...route,
      traceThickness: Math.max(route.traceThickness, physicalSrj.minTraceWidth),
      route: route.route.map((point) => point.traceThickness === undefined ? point : { ...point, traceThickness: Math.max(point.traceThickness, physicalSrj.minTraceWidth) }),
    }))
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
    const ownership = getObstacleRouteConnectivity({ obstacles: nearby, routes, connMap: physicalConnMap })
    const srj: SimpleRouteJson = {
      ...physicalSrj, traces: undefined, defaultObstacleMargin: undefined,
      obstacles: nearby.map((obstacle, index) => ({ ...obstacle, connectedTo: [...obstacle.connectedTo, ...ownership.connectedRouteNamesByObstacle[index]!] })),
      connections: routes.map((route) => ({ name: route.connectionName, rootConnectionName: route.rootConnectionName, __rootConnectionNames: [route.rootConnectionName ?? route.connectionName], pointsToConnect: [] })),
    }
    const traces = routes.map((route, index) => ({
      type: "pcb_trace" as const,
      pcb_trace_id: `physical-node-candidate-${index}`,
      connection_name: route.connectionName,
      route: convertHdRouteToSimplifiedRoute(route, srj.layerCount, { defaultViaHoleDiameter, obstacles: srj.obstacles, connMap: physicalConnMap }),
    }))
    const engine = new AutoroutingDrcEngine(srj as any, { connMap: physicalConnMap, traceClearance, viaClearance: viaCopperClearance, viaToPadClearance: viaClearance, queryResultCacheBudget: 0 })
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
        const sameNet = arePipeline9RoutesOnSameNet(routes[first.routeIndex]!, routes[second.routeIndex]!, physicalConnMap)
        if (sameNet && distance <= 1e-9) continue
        const drillDistance = (first.segment.via_hole_diameter ?? defaultViaHoleDiameter) / 2 + (second.segment.via_hole_diameter ?? defaultViaHoleDiameter) / 2 + viaHoleClearance
        const copperDistance = !sameNet ? (first.segment.via_diameter ?? routes[first.routeIndex]!.viaDiameter) / 2 + (second.segment.via_diameter ?? routes[second.routeIndex]!.viaDiameter) / 2 + viaCopperClearance : 0
        if (distance + 1e-6 < Math.max(drillDistance, copperDistance)) return false
      }
    }
    // Opaque unowned barriers have no declared copper role. Check overlap
    // without inventing pad clearance; typed pads and holes retain their rules.
    const unownedObstacles = srj.obstacles.filter(isOpaqueUnownedObstacle)
    const otherObstacleSrj = { ...srj, obstacles: srj.obstacles.filter((obstacle) => !isOpaqueUnownedObstacle(obstacle)) }
    if (getFixedObstacleViolations({ srj: otherObstacleSrj as any, routes: routes as any, traceClearance, viaClearance }).length > 0) return false
    if (unownedObstacles.length > 0 && getFixedObstacleViolations({ srj: { ...srj, obstacles: unownedObstacles, defaultObstacleMargin: 0, minTraceToPadEdgeClearance: 0, minViaEdgeToPadEdgeClearance: 0 } as any, routes: routes as any, traceClearance: 0, viaClearance: 0 }).length > 0) return false
    for (const route of routes) {
      const geometry = getPipeline9RouteCopperGeometry(route, srj)
      for (const segment of geometry.wireSegments) {
        if (!isPointInsideBoard(segment.start, segment.width / 2) || !isPointInsideBoard(segment.end, segment.width / 2)) return false
        if (srj.outline && doesSegmentCrossPolygonBoundary({ start: segment.start, end: segment.end, polygon: srj.outline, margin: segment.width / 2 + boardEdgeClearance })) return false
      }
      for (const via of geometry.viaSpans) {
        if (!isPointInsideBoard(via.center, via.diameter / 2)) return false
      }
    }
    return true
  }
  mapCache.set(cacheKey, validator)
  return validator
}
