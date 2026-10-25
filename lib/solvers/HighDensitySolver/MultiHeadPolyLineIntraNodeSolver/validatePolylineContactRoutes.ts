import { getFixedObstacleViolations } from "@tscircuit/repair04"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { getDrcErrors } from "lib/testing/getDrcErrors"
import { convertToCircuitJson, createPcbBoardElement } from "lib/testing/utils/convertToCircuitJson"
import type { HighDensityBoardGeometry } from "lib/types/high-density-board-geometry"
import type { HighDensityIntraNodeRoute, NodeWithPortPoints } from "lib/types/high-density-types"
import type { Obstacle, SimpleRouteJson } from "lib/types/srj-types"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"
import { mapZToLayerName } from "lib/utils/mapZToLayerName"
import { getObstacleRouteConnectivity } from "../../HyperHighDensitySolver/getObstacleRouteConnectivity"

export type PolylineContactPhysicalContext = {
  nodeWithPortPoints: NodeWithPortPoints
  obstacles: Obstacle[]
  layerCount: number
  traceWidth: number
  viaDiameter: number
  obstacleMargin: number
  viaToPadClearance?: number
  connMap?: ConnectivityMap
  boardGeometry?: HighDensityBoardGeometry
  viaHoleDiameter?: number
  minViaHoleEdgeToViaHoleEdgeClearance?: number
  allowBlindAndBuriedVias?: boolean
}

/** Coordinates and dimensions here are physical board units, never grow/shrink units. */
export const validatePolylineContactRoutes = (
  routes: HighDensityIntraNodeRoute[],
  context: PolylineContactPhysicalContext,
  charge: (units: number) => void = (): void => {},
): string | null => {
  const holeDiameter = context.viaHoleDiameter ?? context.viaDiameter
  const drillSeparation = holeDiameter + (context.minViaHoleEdgeToViaHoleEdgeClearance ?? 0.1)
  const sites = routes.flatMap((route): { x: number; y: number; owner: string }[] =>
    route.vias.map((via): { x: number; y: number; owner: string } => ({
      ...via, owner: route.rootConnectionName ?? route.connectionName,
    })))
  for (let i = 0; i < sites.length; i++) for (let j = i + 1; j < sites.length; j++) {
    charge(1)
    const a = sites[i]!, b = sites[j]!
    const distance = Math.hypot(a.x - b.x, a.y - b.y)
    if (distance === 0 && (a.owner === b.owner || context.connMap?.areIdsConnected(a.owner, b.owner))) continue
    if (distance < drillSeparation) return "via drill edge clearance"
  }
  const points = routes.flatMap((route): HighDensityIntraNodeRoute["route"] => route.route)
  if (points.length === 0) throw new Error("Cannot validate an empty polyline route set")
  const envelope = Math.max(context.traceWidth, context.viaDiameter) / 2 +
    Math.max(context.obstacleMargin, context.viaToPadClearance ?? context.obstacleMargin, 0.1) + 1e-5
  const minX = Math.min(...points.map((p): number => p.x)) - envelope
  const maxX = Math.max(...points.map((p): number => p.x)) + envelope
  const minY = Math.min(...points.map((p): number => p.y)) - envelope
  const maxY = Math.max(...points.map((p): number => p.y)) + envelope
  const obstacles = context.obstacles.filter((obstacle): boolean => {
    charge(1)
    const radius = Math.hypot(obstacle.width, obstacle.height) / 2
    return obstacle.center.x + radius >= minX && obstacle.center.x - radius <= maxX &&
      obstacle.center.y + radius >= minY && obstacle.center.y - radius <= maxY
  })
  // Reserve a conservative quadratic primitive allowance before entering the
  // external physical checker. Its internal pair checks cannot escape the
  // local model's work cap merely because they execute in another package.
  const primitiveCount = points.length + sites.length + obstacles.length * 4 + 4
  charge(16 * primitiveCount * primitiveCount)
  const { connectedRouteNamesByObstacle, connectedObstaclesByRoute } =
    getObstacleRouteConnectivity({ obstacles, routes, connMap: context.connMap })
  const node = context.nodeWithPortPoints
  const srj: SimpleRouteJson = {
    layerCount: context.layerCount,
    minTraceWidth: context.traceWidth,
    minViaDiameter: context.viaDiameter,
    minViaHoleDiameter: holeDiameter,
    defaultObstacleMargin: context.obstacleMargin,
    minTraceToPadEdgeClearance: context.obstacleMargin,
    minViaEdgeToPadEdgeClearance: context.viaToPadClearance ?? context.obstacleMargin,
    minViaHoleEdgeToViaHoleEdgeClearance: context.minViaHoleEdgeToViaHoleEdgeClearance,
    allowBlindAndBuriedVias: context.allowBlindAndBuriedVias,
    bounds: {
      minX: node.center.x - node.width / 2, maxX: node.center.x + node.width / 2,
      minY: node.center.y - node.height / 2, maxY: node.center.y + node.height / 2,
    },
    ...context.boardGeometry,
    obstacles: obstacles.map((obstacle, index): Obstacle => ({
      ...obstacle,
      connectedTo: [...obstacle.connectedTo, ...connectedRouteNamesByObstacle[index]!],
    })),
    connections: routes.map((route, index): SimpleRouteJson["connections"][number] => ({
      name: route.connectionName,
      rootConnectionName: route.rootConnectionName,
      __netConnectionName: route.rootConnectionName ?? route.connectionName,
      pointsToConnect: [
        ...[route.route[0]!, route.route.at(-1)!].map((point): { x: number; y: number; layer: string } => ({
          x: point.x, y: point.y, layer: mapZToLayerName(point.z, context.layerCount),
        })),
        ...connectedObstaclesByRoute[index]!.flatMap((obstacle) => {
          const pcbPortId = obstacle.circuitJsonMetadata?.pcb_port_id
          return pcbPortId ? [{ ...obstacle.center, layer: "top", pcb_port_id: pcbPortId }] : []
        }),
      ],
    })),
  }
  const traces = routes.map((route, index) => ({
    type: "pcb_trace" as const,
    pcb_trace_id: `${route.connectionName}_${index}`,
    connection_name: route.connectionName,
    route: convertHdRouteToSimplifiedRoute(route, context.layerCount, { defaultViaHoleDiameter: holeDiameter }),
  }))
  const circuitJson = convertToCircuitJson(srj, traces)
  if (context.boardGeometry) circuitJson.push(createPcbBoardElement(srj))
  const { errors } = getDrcErrors(circuitJson, {
    traceClearance: context.obstacleMargin,
    viaClearance: Math.max(0.1, context.obstacleMargin),
    // Mesh ports are interfaces to other nodes, not pad terminations. The
    // fixed seed topology constructs one contiguous chain between each pair.
    includeTraceContinuity: false,
  })
  const fixedViolations = getFixedObstacleViolations({ srj, routes })
  if (errors.length > 0) return errors[0]!.message
  if (fixedViolations.length > 0) return "fixed board obstacle clearance"
  return null
}
