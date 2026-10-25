import { getConnectionPortPointPairs } from "./ownerCutKernel/getConnectionPortPointPairs"
import { getFixedObstacleViolations } from "@tscircuit/repair04"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { getDrcErrors } from "lib/testing/getDrcErrors"
import {
  convertToCircuitJson,
  createPcbBoardElement,
} from "lib/testing/utils/convertToCircuitJson"
import type { Obstacle, SimpleRouteJson } from "lib/types"
import type { HighDensityBoardGeometry } from "lib/types/high-density-board-geometry"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"
import { mapZToLayerName } from "lib/utils/mapZToLayerName"
import { getObstacleRouteConnectivity } from "../HyperHighDensitySolver/getObstacleRouteConnectivity"

import { doPipeline9RoutesHaveCopperConflict } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"
import type { HighDensityIntraNodeRoute, NodeWithPortPoints } from "lib/types/high-density-types"

export type OwnerCutValidationContext = {
  viaToPadClearance?: number
  viaHoleDiameter: number
  minViaHoleEdgeToViaHoleEdgeClearance: number
  allowBlindAndBuriedVias?: boolean
  obstacles: Obstacle[]
  connMap?: ConnectivityMap
  layerCount: number
  boardGeometry?: HighDensityBoardGeometry
}

/** Final acceptance checks continuous copper, fixed obstacles, outline and drills.
 * The reachability graph relaxes the new route's self geometry. A rejected
 * witness is UNKNOWN, never a proof that its owner permission set is infeasible.
 */
export function validateOwnerCutRoutes(
  routes: HighDensityIntraNodeRoute[],
  params: OwnerCutValidationContext & {
    nodeWithPortPoints: NodeWithPortPoints
    traceThickness: number
    traceMargin: number
    viaDiameter: number
  },
): string | undefined {
  // The native grid may collapse distinct terminals into one cell or dedupe
  // root aliases by cell identity. Acceptance requires each exact requested
  // pair to survive as a complete route, regardless of provisional grid reach.
  const pointsByConnection = new Map<string, typeof params.nodeWithPortPoints.portPoints>()
  for (const point of params.nodeWithPortPoints.portPoints) {
    const points = pointsByConnection.get(point.connectionName)
    if (points) points.push(point)
    else pointsByConnection.set(point.connectionName, [point])
  }
  const samePoint = (a: { x: number; y: number; z: number },
    b: { x: number; y: number; z: number }): boolean =>
    a.z === b.z && Math.hypot(a.x - b.x, a.y - b.y) < 1e-8
  for (const points of pointsByConnection.values()) {
    for (const [start, end] of getConnectionPortPointPairs(points)) {
      const root = start.rootConnectionName ?? start.connectionName.replace(/_mst\d+$/, "")
      const covered = routes.some((route) => {
        if ((route.rootConnectionName ?? route.connectionName) !== root ||
          route.route.length < 2) return false
        const first = route.route[0]!, last = route.route.at(-1)!
        return samePoint(start, first) && samePoint(end, last) ||
          samePoint(start, last) && samePoint(end, first)
      })
      if (!covered) return "Exact required terminal pair missing from graph witness"
    }
  }
  const drills = routes.flatMap((route) => route.vias.map((via) => ({
    ...via, owner: route.rootConnectionName ?? route.connectionName,
  })))
  for (let i = 0; i < drills.length; i++) {
    for (let j = i + 1; j < drills.length; j++) {
      const a = drills[i]!, b = drills[j]!
      const distance = Math.hypot(a.x - b.x, a.y - b.y)
      if (distance < 1e-9 && a.owner === b.owner) continue
      if (distance < params.viaHoleDiameter +
        params.minViaHoleEdgeToViaHoleEdgeClearance - 1e-9)
        return "Distinct physical via drills violate clearance"
    }
  }
  for (let i = 0; i < routes.length; i++) {
    for (let j = i + 1; j < routes.length; j++) {
      const left = routes[i]!, right = routes[j]!
      if ((left.rootConnectionName ?? left.connectionName) ===
        (right.rootConnectionName ?? right.connectionName)) continue
      if (doPipeline9RoutesHaveCopperConflict({ left, right,
        clearance: params.traceMargin, layerCount: params.layerCount,
        allowBlindAndBuriedVias: false }))
        return "Continuous route copper violates clearance"
    }
  }
    const { connMap, layerCount } = params
    const node = params.nodeWithPortPoints
    const points = routes.flatMap((route) => route.route)
    const clearance =
      Math.max(params.traceThickness, params.viaDiameter) / 2 +
      Math.max(params.traceMargin, params.viaToPadClearance ?? 0, 0.1) +
      1e-6
    const minX = Math.min(...points.map((point) => point.x)) - clearance
    const maxX = Math.max(...points.map((point) => point.x)) + clearance
    const minY = Math.min(...points.map((point) => point.y)) - clearance
    const maxY = Math.max(...points.map((point) => point.y)) + clearance
    // A circumscribed disk encloses both rotated and axis-aligned obstacle
    // interpretations. Copper outside this envelope cannot touch any segment.
    const obstacles = params.obstacles.filter((obstacle) => {
      const radius = Math.hypot(obstacle.width, obstacle.height) / 2
      return (
        obstacle.center.x + radius >= minX &&
        obstacle.center.x - radius <= maxX &&
        obstacle.center.y + radius >= minY &&
        obstacle.center.y - radius <= maxY
      )
    })
    const { connectedRouteNamesByObstacle, connectedObstaclesByRoute } =
      getObstacleRouteConnectivity({ obstacles, routes, connMap })
    const srj: SimpleRouteJson = {
      layerCount,
      minTraceWidth: params.traceThickness,
      minViaDiameter: params.viaDiameter,
      minViaEdgeToPadEdgeClearance: params.viaToPadClearance,
      minViaHoleDiameter: params.viaHoleDiameter,
      minViaHoleEdgeToViaHoleEdgeClearance: params.minViaHoleEdgeToViaHoleEdgeClearance,
      allowBlindAndBuriedVias: false,
      bounds: {
        minX: node.center.x - node.width / 2,
        maxX: node.center.x + node.width / 2,
        minY: node.center.y - node.height / 2,
        maxY: node.center.y + node.height / 2,
      },
      ...params.boardGeometry,
      obstacles: obstacles.map((obstacle, obstacleIndex) => ({
        ...obstacle,
        connectedTo: [
          ...obstacle.connectedTo,
          ...connectedRouteNamesByObstacle[obstacleIndex]!,
        ],
      })),
      connections: routes.map((route, routeIndex) => ({
        name: route.connectionName,
        rootConnectionName: route.rootConnectionName,
        __netConnectionName: route.rootConnectionName ?? route.connectionName,
        pointsToConnect: [
          ...[route.route[0]!, route.route.at(-1)!].map((point) => ({
            x: point.x,
            y: point.y,
            layer: mapZToLayerName(point.z, layerCount),
          })),
          // Register ownership independently of whether this partial route
          // reaches its pad in the current node.
          ...connectedObstaclesByRoute[routeIndex]!.flatMap((obstacle) => {
            const pcbPortId = obstacle.circuitJsonMetadata?.pcb_port_id
            return pcbPortId
              ? [
                  {
                    ...obstacle.center,
                    layer: mapZToLayerName(0, layerCount),
                    pcb_port_id: pcbPortId,
                  },
                ]
              : []
          }),
        ],
      })),
    }
    const traces = routes.map((route, index) => ({
      type: "pcb_trace" as const,
      pcb_trace_id: `${route.connectionName}_${index}`,
      connection_name: route.connectionName,
      route: convertHdRouteToSimplifiedRoute(route, layerCount),
    }))
    // Check the real board outline when available. The node rectangle is a
    // shared routing interface and cannot stand in for the physical board.
    const circuitJson = convertToCircuitJson(srj, traces)
    if (params.boardGeometry) {
      circuitJson.push(createPcbBoardElement(srj))
    }
    const { errors } = getDrcErrors(circuitJson, {
      traceClearance: params.traceMargin,
      viaClearance: params.traceMargin,
      includeTraceContinuity: false,
    })
    const fixedViolations = getFixedObstacleViolations({
      srj: { ...srj, traces: undefined },
      routes,
    })
    if (errors.length || fixedViolations.length)
      return errors[0]?.message ?? "Fixed obstacle clearance violation"
    return undefined
}
