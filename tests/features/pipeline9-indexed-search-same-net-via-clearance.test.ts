import { expect, test } from "bun:test"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

test("indexed repair does not apply the different-net copper rule to connected vias", (): void => {
  const routes: HighDensityRoute[] = [
    {
      connectionName: "horizontal",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: -1, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
      ],
      vias: [],
    },
    {
      connectionName: "vertical",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: 0, y: -1, z: 0 },
        { x: 0, y: 1, z: 0 },
      ],
      vias: [],
    },
    ...[3, 3.45].map(
      (x, index): HighDensityRoute => ({
        connectionName: `connected_${index}`,
        rootConnectionName: "shared_net",
        traceThickness: 0.1,
        viaDiameter: 0.3,
        route: [
          { x, y: -2, z: 0 },
          { x, y: -1, z: 0 },
          { x, y: -1, z: 1 },
          { x, y: -2, z: 1 },
        ],
        vias: [{ x, y: -1 }],
      }),
    ),
  ]
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    minViaPadDiameter: 0.3,
    minViaHoleDiameter: 0.15,
    minPadEdgeToPadEdgeClearance: 0.25,
    minViaHoleEdgeToViaHoleEdgeClearance: 0.25,
    bounds: { minX: -5, minY: -5, maxX: 5, maxY: 5 },
    obstacles: [],
    connections: routes.map((route) => ({
      name: route.connectionName,
      __netConnectionName: route.rootConnectionName,
      pointsToConnect: [route.route[0]!, route.route.at(-1)!].map(
        (point, index) => ({
          x: point.x,
          y: point.y,
          layer: point.z === 0 ? "top" : "bottom",
          pointId: `${route.connectionName}_${index}`,
        }),
      ),
    })),
  }
  const solver = new Pipeline9JointDrcRepairSolver({
    srj,
    srjWithPointPairs: srj,
    originalSrj: srj,
    newConnections: srj.connections,
    newHdRoutes: routes,
    updatedPreloadedTraces: [],
    mutatedPreloadedTraceIds: new Set(),
    connMap: getConnectivityMapFromSimpleRouteJson(srj),
    obstacles: srj.obstacles,
    layerCount: 2,
    defaultViaDiameter: 0.3,
    defaultViaHoleDiameter: 0.15,
    effort: 1,
    colorMap: {},
  })
  const evaluate = solver.exactRepairSolver!.params.drcEvaluator!
  const validation = evaluate({ traces: [], routes })
  const errors = Array.isArray(validation) ? validation : validation.errors
  // The crossing requires repair. The connected vias' 0.30 mm drill gap is
  // legal, even though their copper gap is below the different-net pad rule.
  expect(errors).toHaveLength(1)
  expect(errors[0]!.type).toBe("pcb_trace_error")
})
