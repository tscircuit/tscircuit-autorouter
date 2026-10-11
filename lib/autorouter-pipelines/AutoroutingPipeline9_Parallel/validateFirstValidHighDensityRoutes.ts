import { getFixedObstacleViolations } from "@tscircuit/repair04"
import { pointToSegmentDistance, segmentToSegmentMinDistance } from "@tscircuit/math-utils"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { isObstacleConnectedToRoute } from "../../solvers/TraceWidthSolver/isObstacleConnectedToRoute"
import { areNodePortPointPairsConnectedByRoutes } from "../../solvers/HyperHighDensitySolver/repairDisconnectedSameRootPortPoints"
import { getDrcErrors } from "../../testing/getDrcErrors"
import { convertToCircuitJson, createPcbBoardElement } from "../../testing/utils/convertToCircuitJson"
import type { HighDensityBoardGeometry } from "../../types/high-density-board-geometry"
import type { HighDensityIntraNodeRoute, NodeWithPortPoints } from "../../types/high-density-types"
import type { Obstacle, SimpleRouteJson } from "../../types/srj-types"
import { convertHdRouteToSimplifiedRoute } from "../../utils/convertHdRouteToSimplifiedRoute"
import { mapZToLayerName } from "../../utils/mapZToLayerName"

export type FirstValidRouteValidationParams = {
  routes: HighDensityIntraNodeRoute[]
  node: NodeWithPortPoints
  traceWidth: number
  viaDiameter: number
  obstacleMargin: number
  layerCount: number
  obstacles: Obstacle[]
  connMap?: ConnectivityMap
  boardGeometry?: HighDensityBoardGeometry
}

export type FirstValidRouteValidationResult =
  | { valid: true }
  | { valid: false; reason: string }

type CopperSegment = {
  start: HighDensityIntraNodeRoute["route"][number]
  end: HighDensityIntraNodeRoute["route"][number]
  radius: number
}

function getCopperSegments(route: HighDensityIntraNodeRoute): CopperSegment[] {
  const segments: CopperSegment[] = []
  for (let index = 0; index < route.route.length - 1; index++) {
    const start = route.route[index]!
    const end = route.route[index + 1]!
    if (start.z === end.z) segments.push({ start, end,
      radius: Math.max(start.traceThickness ?? route.traceThickness, end.traceThickness ?? route.traceThickness) / 2 })
  }
  return segments
}

function hasCopperClearanceViolation(params: FirstValidRouteValidationParams): boolean {
  const { routes, connMap, obstacleMargin } = params
  const segments = routes.map(getCopperSegments)
  for (let first = 0; first < routes.length; first++) {
    const a = routes[first]!
    for (let second = first + 1; second < routes.length; second++) {
      const b = routes[second]!
      if ((a.rootConnectionName ?? a.connectionName) === (b.rootConnectionName ?? b.connectionName) ||
          connMap?.areIdsConnected(a.connectionName, b.connectionName)) continue
      for (const left of segments[first]!) {
        for (const right of segments[second]!) {
          if (left.start.z === right.start.z &&
              segmentToSegmentMinDistance(left.start, left.end, right.start, right.end) <
              left.radius + right.radius + obstacleMargin - 1e-6) return true
        }
        for (const via of b.vias) {
          if (pointToSegmentDistance(via, left.start, left.end) < left.radius + b.viaDiameter / 2 + obstacleMargin - 1e-6) return true
        }
      }
      for (const via of a.vias) {
        for (const right of segments[second]!) {
          if (pointToSegmentDistance(via, right.start, right.end) < right.radius + a.viaDiameter / 2 + obstacleMargin - 1e-6) return true
        }
        for (const otherVia of b.vias) {
          if (Math.hypot(via.x - otherVia.x, via.y - otherVia.y) <
              (a.viaDiameter + b.viaDiameter) / 2 + obstacleMargin - 1e-6) return true
        }
      }
    }
  }
  return false
}

function getStructuralRejection(params: FirstValidRouteValidationParams): string | undefined {
  const { routes, node, traceWidth, viaDiameter, layerCount } = params
  const connectionNames = new Set(node.portPoints.map((port) => port.connectionName))
  const minX = node.center.x - node.width / 2 - 1e-6
  const maxX = node.center.x + node.width / 2 + 1e-6
  const minY = node.center.y - node.height / 2 - 1e-6
  const maxY = node.center.y + node.height / 2 + 1e-6
  for (const route of routes) {
    if (!connectionNames.has(route.connectionName)) return "unknown-connection"
    if (route.route.length < 2 || route.jumpers?.length) return "unsupported-route"
    if (!Number.isFinite(route.traceThickness) || route.traceThickness < traceWidth - 1e-9) return "trace-width"
    if (!Number.isFinite(route.viaDiameter) || route.viaDiameter < viaDiameter - 1e-9) return "via-diameter"
    const usedVias = new Set<number>()
    for (const [index, point] of route.route.entries()) {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return "nonfinite-geometry"
      if (!Number.isInteger(point.z) || point.z < 0 || point.z >= layerCount ||
          (node.availableZ && !node.availableZ.includes(point.z))) return "unavailable-layer"
      if (point.x < minX || point.x > maxX || point.y < minY || point.y > maxY) return "node-bounds"
      if (point.traceThickness !== undefined &&
          (!Number.isFinite(point.traceThickness) || point.traceThickness < traceWidth - 1e-9)) return "trace-width"
      if (point.toNextSegmentType !== undefined || point.toNextSegmentCircuitJsonMetadata !== undefined) return "unsupported-transition"
      const next = route.route[index + 1]
      if (!next || point.z === next.z) continue
      if (Math.hypot(point.x - next.x, point.y - next.y) > 1e-6) return "noncolocated-via"
      let foundVia = false
      for (const [viaIndex, via] of route.vias.entries()) {
        if (Math.hypot(via.x - point.x, via.y - point.y) <= 1e-6) {
          usedVias.add(viaIndex)
          foundVia = true
        }
      }
      if (!foundVia) return "missing-via"
    }
    for (const [index, via] of route.vias.entries()) {
      if (!Number.isFinite(via.x) || !Number.isFinite(via.y)) return "nonfinite-geometry"
      if (!usedVias.has(index)) return "unused-via"
    }
    for (const endpoint of [route.route[0]!, route.route.at(-1)!]) {
      const matchesPort = node.portPoints.some((port) => port.connectionName === route.connectionName &&
        port.z === endpoint.z && Math.hypot(port.x - endpoint.x, port.y - endpoint.y) <= 1e-6)
      if (!matchesPort) return "missing-terminal"
    }
  }
  if (!areNodePortPointPairsConnectedByRoutes(routes, node)) return "missing-port-pair"
  return undefined
}

/** Competitive candidates are provisional until full-width physical copper is valid. */
export function validateFirstValidHighDensityRoutes(params: FirstValidRouteValidationParams): FirstValidRouteValidationResult {
  const rejection = getStructuralRejection(params)
  if (rejection) return { valid: false, reason: rejection }
  if (hasCopperClearanceViolation(params)) return { valid: false, reason: "copper-drc" }
  const { routes, node, obstacleMargin, layerCount, connMap } = params
  const points = routes.flatMap((route) => route.route)
  const maximumCopperWidth = Math.max(params.traceWidth, params.viaDiameter,
    ...routes.flatMap((route) => [route.traceThickness, route.viaDiameter,
      ...route.route.map((point) => point.traceThickness ?? route.traceThickness)]))
  const clearance = maximumCopperWidth / 2 + Math.max(obstacleMargin, 0.1) + 1e-6
  const minX = Math.min(...points.map((point) => point.x)) - clearance
  const maxX = Math.max(...points.map((point) => point.x)) + clearance
  const minY = Math.min(...points.map((point) => point.y)) - clearance
  const maxY = Math.max(...points.map((point) => point.y)) + clearance
  const obstacles = params.obstacles.filter((obstacle) => {
    const radius = Math.hypot(obstacle.width, obstacle.height) / 2
    return obstacle.center.x + radius >= minX && obstacle.center.x - radius <= maxX &&
      obstacle.center.y + radius >= minY && obstacle.center.y - radius <= maxY
  })
  const srj: SimpleRouteJson = {
    layerCount, minTraceWidth: params.traceWidth, minViaDiameter: params.viaDiameter,
    bounds: { minX: node.center.x - node.width / 2, maxX: node.center.x + node.width / 2,
      minY: node.center.y - node.height / 2, maxY: node.center.y + node.height / 2 },
    ...params.boardGeometry,
    obstacles: obstacles.map((obstacle) => ({ ...obstacle, connectedTo: [
      ...obstacle.connectedTo,
      ...routes.filter((route) => isObstacleConnectedToRoute(obstacle, route, connMap)).map((route) => route.connectionName),
    ] })),
    connections: routes.map((route) => ({
      name: route.connectionName, rootConnectionName: route.rootConnectionName,
      __netConnectionName: route.rootConnectionName ?? route.connectionName,
      pointsToConnect: [
        ...[route.route[0]!, route.route.at(-1)!].map((point) => ({
          x: point.x, y: point.y, layer: mapZToLayerName(point.z, layerCount),
        })),
        ...obstacles.filter((obstacle) => isObstacleConnectedToRoute(obstacle, route, connMap)).flatMap((obstacle) => {
          const pcbPortId = obstacle.circuitJsonMetadata?.pcb_port_id
          return pcbPortId ? [{ ...obstacle.center, layer: mapZToLayerName(0, layerCount), pcb_port_id: pcbPortId }] : []
        }),
      ],
    })),
  }
  const traces = routes.map((route, index) => ({ type: "pcb_trace" as const,
    pcb_trace_id: `${route.connectionName}_${index}`, connection_name: route.connectionName,
    route: convertHdRouteToSimplifiedRoute(route, layerCount) }))
  const circuitJson = convertToCircuitJson(srj, traces)
  if (params.boardGeometry) circuitJson.push(createPcbBoardElement(srj))
  const { errors } = getDrcErrors(circuitJson, { traceClearance: obstacleMargin,
    viaClearance: obstacleMargin, includeTraceContinuity: false })
  if (errors.length > 0) return { valid: false, reason: "copper-drc" }
  const fixedViolations = getFixedObstacleViolations({ srj: { ...srj, traces: undefined }, routes,
    traceClearance: obstacleMargin, viaClearance: obstacleMargin })
  return fixedViolations.length > 0 ? { valid: false, reason: "fixed-obstacle" } : { valid: true }
}
