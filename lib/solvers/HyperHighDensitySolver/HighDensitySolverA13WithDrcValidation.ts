import { getFixedObstacleViolationsWithOwnership } from "./getFixedObstacleViolationsWithOwnership"
import type { HighDensitySolverA13 } from "@tscircuit/high-density-a13"
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
import { HighDensitySolverA13WithBoundaryClearance } from "./HighDensitySolverA13WithBoundaryClearance"
import { getObstacleRouteConnectivity, type ObstacleRouteOwnershipPredicate } from "./getObstacleRouteConnectivity"

type A13Params = ConstructorParameters<typeof HighDensitySolverA13>[0]
type ValidatedA13Params = A13Params & {
  obstacles: Obstacle[]
  connMap?: ConnectivityMap
  layerCount: number
  boardGeometry?: HighDensityBoardGeometry
  isObstacleOwnedByRoute?: ObstacleRouteOwnershipPredicate
}

/** A node-local search is provisional until it also clears fixed board copper. */
export class HighDensitySolverA13WithDrcValidation extends HighDensitySolverA13WithBoundaryClearance {
  constructor(readonly validationParams: ValidatedA13Params) {
    super(validationParams)
  }

  override _step(): void {
    super._step()
    if (!this.solved) return
    const routes = this.getOutput()
    const { connMap, layerCount } = this.validationParams
    const node = this.nodeWithPortPoints
    const points = routes.flatMap((route) => route.route)
    const clearance =
      Math.max(this.traceThickness, this.viaDiameter) / 2 +
      Math.max(this.traceMargin, 0.1) +
      1e-6
    const minX = Math.min(...points.map((point) => point.x)) - clearance
    const maxX = Math.max(...points.map((point) => point.x)) + clearance
    const minY = Math.min(...points.map((point) => point.y)) - clearance
    const maxY = Math.max(...points.map((point) => point.y)) + clearance
    // A circumscribed disk encloses both rotated and axis-aligned obstacle
    // interpretations. Copper outside this envelope cannot touch any segment.
    const obstacles = this.validationParams.obstacles.filter((obstacle) => {
      const radius = Math.hypot(obstacle.width, obstacle.height) / 2
      return (
        obstacle.center.x + radius >= minX &&
        obstacle.center.x - radius <= maxX &&
        obstacle.center.y + radius >= minY &&
        obstacle.center.y - radius <= maxY
      )
    })
    this.stats.boardObstaclesChecked = obstacles.length
    const { connectedRouteNamesByObstacle, connectedObstaclesByRoute } =
      getObstacleRouteConnectivity({ obstacles, routes, connMap, isObstacleOwnedByRoute: this.validationParams.isObstacleOwnedByRoute })
    const srj: SimpleRouteJson = {
      layerCount,
      minTraceWidth: this.traceThickness,
      minViaDiameter: this.viaDiameter,
      bounds: {
        minX: node.center.x - node.width / 2,
        maxX: node.center.x + node.width / 2,
        minY: node.center.y - node.height / 2,
        maxY: node.center.y + node.height / 2,
      },
      ...this.validationParams.boardGeometry,
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
    if (this.validationParams.boardGeometry) {
      circuitJson.push(createPcbBoardElement(srj))
    }
    const { errors } = getDrcErrors(circuitJson, {
      traceClearance: this.traceMargin,
      viaClearance: this.traceMargin,
      includeTraceContinuity: false,
    })
    // Explicit physical ownership must survive the fixed kernel's alias
    // union. Query each route separately; recognized-pad IDs also cannot skip
    // this guard after the callback certified that a pad belongs to a foreign net.
    const ownedObstaclesByRoute = this.validationParams.isObstacleOwnedByRoute
      ? connectedObstaclesByRoute.map((entries) => new Set(entries))
      : undefined
    const fixedViolations = ownedObstaclesByRoute
      ? getFixedObstacleViolationsWithOwnership({ srj: { ...srj, traces: undefined }, routes,
          traceClearance: this.traceMargin, viaClearance: this.traceMargin,
          isObstacleOwnedByRouteIndex: (routeIndex, obstacleIndex): boolean => ownedObstaclesByRoute[routeIndex]!.has(obstacles[obstacleIndex]!),
        })
      : getFixedObstacleViolations({ srj: { ...srj, traces: undefined }, routes })
    this.stats.boardPhysicalOwnershipQueryCount = ownedObstaclesByRoute ? routes.length : 1
    this.stats.boardPhysicalOwnershipObstacleSetupCount = obstacles.length * (ownedObstaclesByRoute ? routes.length : 1)
    this.stats.boardDrcIssueCount = errors.length + fixedViolations.length
    if (errors.length > 0 || fixedViolations.length > 0) {
      this.solved = false
      this.failed = true
      this.error = `A13 candidate fails board copper validation: ${errors[0]?.message ?? "fixed obstacle clearance violation"}`
    }
  }
}
