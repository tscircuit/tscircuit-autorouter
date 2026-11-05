import { getFixedObstacleViolations } from "@tscircuit/repair04"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { getDrcErrors } from "lib/testing/getDrcErrors"
import { convertToCircuitJson, createPcbBoardElement } from "lib/testing/utils/convertToCircuitJson"
import type { HighDensityBoardGeometry } from "lib/types/high-density-board-geometry"
import type { HighDensityIntraNodeRoute, NodeWithPortPoints } from "lib/types/high-density-types"
import type { Obstacle, SimpleRouteJson } from "lib/types/srj-types"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"
import { mapZToLayerName } from "lib/utils/mapZToLayerName"
import { getObstacleRouteConnectivity } from "../HyperHighDensitySolver/getObstacleRouteConnectivity"

type Params = {
  routes: HighDensityIntraNodeRoute[]
  obstacles: Obstacle[]
  node: NodeWithPortPoints
  connMap?: ConnectivityMap
  layerCount: number
  traceWidth: number
  viaDiameter: number
  viaHoleDiameter: number
  minimumHoleGap: number
  traceHoleClearance?: number
  allowBlindAndBuriedVias?: boolean
  clearance: number
  boardGeometry?: HighDensityBoardGeometry
}

/** Independent board/fixed-copper acceptance, matching the A13 candidate guard. */
export function validateRouteWitnessBoardCopper(params: Params): { valid: boolean; issues: number; obstacles: number } {
  const { routes, node, layerCount, connMap } = params
  const padding = Math.max(params.traceWidth, params.viaDiameter) / 2 + params.clearance + 1e-6
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const route of routes) {
    for (const point of route.route) {
      minX = Math.min(minX, point.x - padding)
      maxX = Math.max(maxX, point.x + padding)
      minY = Math.min(minY, point.y - padding)
      maxY = Math.max(maxY, point.y + padding)
    }
  }
  if (!Number.isFinite(minX)) throw new Error("Empty route witness board proposal")
  const obstacles = params.obstacles.filter((obstacle) => {
    const radius = Math.hypot(obstacle.width, obstacle.height) / 2
    return obstacle.center.x + radius >= minX && obstacle.center.x - radius <= maxX &&
      obstacle.center.y + radius >= minY && obstacle.center.y - radius <= maxY
  })
  const { connectedRouteNamesByObstacle, connectedObstaclesByRoute } = getObstacleRouteConnectivity({ obstacles, routes, connMap })
  const srj: SimpleRouteJson = {
    layerCount,
    minTraceWidth: params.traceWidth,
    minViaDiameter: params.viaDiameter,
    minViaHoleDiameter: params.viaHoleDiameter,
    minViaHoleEdgeToViaHoleEdgeClearance: params.minimumHoleGap,
    minTraceToHoleEdgeClearance: params.traceHoleClearance,
    allowBlindAndBuriedVias: params.allowBlindAndBuriedVias,
    bounds: {
      minX: node.center.x - node.width / 2,
      maxX: node.center.x + node.width / 2,
      minY: node.center.y - node.height / 2,
      maxY: node.center.y + node.height / 2,
    },
    ...params.boardGeometry,
    obstacles: obstacles.map((obstacle, index) => ({
      ...obstacle,
      connectedTo: [...obstacle.connectedTo, ...connectedRouteNamesByObstacle[index]!],
    })),
    connections: routes.map((route, index) => ({
      name: route.connectionName,
      rootConnectionName: route.rootConnectionName,
      __netConnectionName: route.rootConnectionName ?? route.connectionName,
      pointsToConnect: [
        ...[route.route[0]!, route.route.at(-1)!].map((point) => ({
          x: point.x, y: point.y, layer: mapZToLayerName(point.z, layerCount),
        })),
        ...connectedObstaclesByRoute[index]!.flatMap((obstacle) => {
          const pcbPortId = obstacle.circuitJsonMetadata?.pcb_port_id
          return pcbPortId ? [{ ...obstacle.center, layer: mapZToLayerName(0, layerCount), pcb_port_id: pcbPortId }] : []
        }),
      ],
    })),
  }
  const traces = routes.map((route, index) => ({
    type: "pcb_trace" as const,
    pcb_trace_id: `witness_${index}_${route.connectionName}`,
    connection_name: route.connectionName,
    route: convertHdRouteToSimplifiedRoute(route, layerCount),
  }))
  const circuitJson = convertToCircuitJson(srj, traces)
  if (params.boardGeometry) circuitJson.push(createPcbBoardElement(srj))
  const { errors } = getDrcErrors(circuitJson, {
    traceClearance: params.clearance,
    viaClearance: params.clearance,
    holeClearance: params.traceHoleClearance,
    includeTraceContinuity: false,
  })
  const fixed = getFixedObstacleViolations({
    srj: { ...srj, traces: undefined }, routes,
    traceClearance: params.clearance, viaClearance: params.clearance,
  })
  return { valid: errors.length === 0 && fixed.length === 0, issues: errors.length + fixed.length, obstacles: obstacles.length }
}
