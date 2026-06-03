import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import { NetToPointPairsSolver } from "lib/solvers/NetToPointPairsSolver/NetToPointPairsSolver"
import type { SimpleRouteConnection, SimpleRouteJson } from "lib/types"
import bugReport from "../../fixtures/bug-reports/bugreport51-7db9f8/bugreport51-7db9f8.json" with {
  type: "json",
}

const srj = bugReport.simple_route_json as SimpleRouteJson

test("bugreport51 merged connections output one geometry-matched source trace id", () => {
  const netToPointPairsSolver = new NetToPointPairsSolver(srj)
  netToPointPairsSolver.solve()

  const mergedConnections = netToPointPairsSolver
    .getNewSimpleRouteJson()
    .connections.filter(
      (
        connection,
      ): connection is SimpleRouteConnection & {
        mergedConnectionNames: string[]
      } => (connection.mergedConnectionNames?.length ?? 0) > 0,
    )

  const fakeMultiGraphSolver = {
    solved: true,
    highDensityRouteSolver: {},
    netToPointPairsSolver: { newConnections: mergedConnections },
    originalSrj: srj,
    srj,
    viaHoleDiameter: undefined,
    connMap: undefined,
    _getOutputHdRoutes: () =>
      mergedConnections.map((connection) => ({
        connectionName: connection.name,
        traceThickness: srj.minTraceWidth,
        viaDiameter: 0.6,
        route: connection.pointsToConnect.map((point) => ({
          x: point.x,
          y: point.y,
          z:
            ("layer" in point ? point.layer : point.layers[0]) === "top"
              ? 0
              : srj.layerCount - 1,
        })),
        vias: [],
      })),
  }

  const outputTraces =
    AutoroutingPipelineSolver7_MultiGraph.prototype.getOutputSimplifiedPcbTraces.call(
      fakeMultiGraphSolver,
    )

  const tracesMissingSingularSourceTraceId = outputTraces.filter(
    (trace) => !trace.source_trace_id || "source_trace_ids" in trace,
  )

  expect({
    mergedConnectionCount: mergedConnections.length,
    tracesMissingSingularSourceTraceIdCount:
      tracesMissingSingularSourceTraceId.length,
  }).toEqual({
    mergedConnectionCount: 10,
    tracesMissingSingularSourceTraceIdCount: 0,
  })
})
