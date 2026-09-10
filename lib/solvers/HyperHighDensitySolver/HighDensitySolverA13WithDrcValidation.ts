import { getFixedObstacleViolations } from "@tscircuit/repair04"
import { HighDensitySolverA13 } from "@tscircuit/high-density-a13"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { isObstacleConnectedToRoute } from "lib/solvers/TraceWidthSolver/isObstacleConnectedToRoute"
import { getDrcErrors } from "lib/testing/getDrcErrors"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import type { Obstacle, SimpleRouteJson } from "lib/types"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"
import { mapZToLayerName } from "lib/utils/mapZToLayerName"

type A13Params = ConstructorParameters<typeof HighDensitySolverA13>[0]
type ValidatedA13Params = A13Params & {
  obstacles: Obstacle[]
  connMap?: ConnectivityMap
  layerCount: number
}

/** A node-local search is provisional until it also clears fixed board copper. */
export class HighDensitySolverA13WithDrcValidation extends HighDensitySolverA13 {
  constructor(readonly validationParams: ValidatedA13Params) {
    super(validationParams)
  }

  override _step(): void {
    super._step()
    if (!this.solved) return
    const routes = this.getOutput()
    const { obstacles, connMap, layerCount } = this.validationParams
    const node = this.nodeWithPortPoints
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
      obstacles: obstacles.map((obstacle) => ({
        ...obstacle,
        connectedTo: [
          ...obstacle.connectedTo,
          ...routes
            .filter((route) =>
              isObstacleConnectedToRoute(obstacle, route, connMap),
            )
            .map((route) => route.connectionName),
        ],
      })),
      connections: routes.map((route) => ({
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
          ...obstacles
            .filter((obstacle) =>
              isObstacleConnectedToRoute(obstacle, route, connMap),
            )
            .flatMap((obstacle) =>
              [
                ...new Set([
                  obstacle.circuitJsonMetadata?.pcb_port_id,
                  ...obstacle.connectedTo.filter((id) =>
                    id.startsWith("pcb_port_"),
                  ),
                ]),
              ]
                .filter((id): id is string => typeof id === "string")
                .map((pcb_port_id) => ({
                  ...obstacle.center,
                  layer: mapZToLayerName(0, layerCount),
                  pcb_port_id,
                })),
            ),
        ],
      })),
    }
    const traces = routes.map((route, index) => ({
      type: "pcb_trace" as const,
      pcb_trace_id: `${route.connectionName}_${index}`,
      connection_name: route.connectionName,
      route: convertHdRouteToSimplifiedRoute(route, layerCount),
    }))
    // Node boundaries are shared routing interfaces, not physical board edges;
    // partial routes also intentionally stop before their complete net ends.
    const circuitJson = convertToCircuitJson(srj, traces).filter(
      (element) => element.type !== "pcb_board",
    )
    const { errors } = getDrcErrors(circuitJson, {
      traceClearance: this.traceMargin,
      viaClearance: this.traceMargin,
      includeTraceContinuity: false,
    })
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
