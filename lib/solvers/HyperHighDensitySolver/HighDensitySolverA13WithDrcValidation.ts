import type { HighDensitySolverA13 } from "@tscircuit/high-density-a13"
import { getFixedObstacleViolations } from "@tscircuit/repair04"
import {
  getFullConnectivityMapFromCircuitJson,
  type ConnectivityMap,
} from "circuit-json-to-connectivity-map"
import {
  convertToCircuitJson,
  createPcbBoardElement,
} from "lib/testing/utils/convertToCircuitJson"
import type { Obstacle, SimpleRouteJson } from "lib/types"
import type { HighDensityBoardGeometry } from "lib/types/high-density-board-geometry"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"
import { mapZToLayerName } from "lib/utils/mapZToLayerName"
import { annotateTraceEndpointPorts } from "lib/utils/autorouting-drc/annotateTraceEndpointPorts"
import { checkBoardTraceClearance } from "lib/utils/autorouting-drc/checkBoardTraceClearance"
import { checkViaPairClearance } from "lib/utils/autorouting-drc/checkViaPairClearance"
import { createTraceObstacleClearanceEvaluator } from "lib/utils/autorouting-drc/createTraceObstacleClearanceEvaluator"
import { createViaPadClearanceEvaluator } from "lib/utils/autorouting-drc/createViaPadClearanceEvaluator"
import { HighDensitySolverA13WithBoundaryClearance } from "./HighDensitySolverA13WithBoundaryClearance"
import { getObstacleRouteConnectivity } from "./getObstacleRouteConnectivity"

type A13Params = ConstructorParameters<typeof HighDensitySolverA13>[0]
type ValidatedA13Params = A13Params & {
  obstacles: Obstacle[]
  connMap?: ConnectivityMap
  layerCount: number
  boardGeometry?: HighDensityBoardGeometry
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
      getObstacleRouteConnectivity({ obstacles, routes, connMap })
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
    const drcConnectivity = getFullConnectivityMapFromCircuitJson(circuitJson)
    drcConnectivity.addConnections(
      circuitJson.flatMap((element) =>
        element.type === "pcb_via" && typeof element.pcb_trace_id === "string"
          ? [[element.pcb_via_id, element.pcb_trace_id]]
          : [],
      ),
    )
    annotateTraceEndpointPorts(circuitJson)
    const clearanceErrors = createTraceObstacleClearanceEvaluator(circuitJson, {
      traceClearance: this.traceMargin,
    })(circuitJson, drcConnectivity)
    const errors = [
      ...clearanceErrors.traceErrors,
      ...checkBoardTraceClearance(circuitJson),
      ...clearanceErrors.viaErrors,
      ...clearanceErrors.padErrors,
      ...clearanceErrors.holeErrors,
      ...createViaPadClearanceEvaluator(circuitJson)(
        circuitJson,
        drcConnectivity,
      ),
      ...checkViaPairClearance(circuitJson, drcConnectivity, {
        viaClearance: this.traceMargin,
      }),
    ]
    const fixedViolations = getFixedObstacleViolations({
      srj: { ...srj, traces: undefined },
      routes,
    })
    this.stats.boardDrcIssueCount = errors.length + fixedViolations.length
    if (errors.length > 0 || fixedViolations.length > 0) {
      this.solved = false
      this.failed = true
      this.error = `A13 candidate fails board copper validation: ${errors[0]?.message ?? "fixed obstacle clearance violation"}`
    }
  }
}
