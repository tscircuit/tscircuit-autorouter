import { NetToPointPairsSolver } from "lib/solvers/NetToPointPairsSolver/NetToPointPairsSolver"
import { getInitiallyConnectedMapFromSimpleRouteJson } from "lib/utils/get-initially-connected-map-from-simple-route-json"
import { resolveDifferentialPairSegments } from "lib/utils/resolveDifferentialPairSegments"
import type { HighDensityRoute } from "lib/types/high-density-types"
import type { SimpleRouteJson } from "lib/types"

export function createDifferentialPairSegmentInput(
  srj: SimpleRouteJson,
): Parameters<typeof resolveDifferentialPairSegments>[0] {
  const solver = new NetToPointPairsSolver(
    srj,
    {},
    getInitiallyConnectedMapFromSimpleRouteJson(srj),
  )
  solver.solve()
  return {
    differentialPairs: srj.differentialPairs!,
    connections: solver.newConnections,
    hdRoutes: solver.newConnections.map(
      (connection): HighDensityRoute => ({
        connectionName: connection.name,
        traceThickness: 0.15,
        viaDiameter: 0.3,
        vias: [],
        route: connection.pointsToConnect.map(
          (point): HighDensityRoute["route"][number] => ({
            x: point.x,
            y: point.y,
            z: 0,
          }),
        ),
      }),
    ),
    pipelineName: "Test",
  }
}
