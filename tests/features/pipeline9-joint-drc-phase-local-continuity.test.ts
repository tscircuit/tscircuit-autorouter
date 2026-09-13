import { expect, test } from "bun:test"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

test("Pipeline9 reference DRC accepts copper-clean phase-local route sections", () => {
  const routes: HighDensityRoute[] = [
    {
      connectionName: "horizontal",
      traceThickness: 0.08,
      viaDiameter: 0.25,
      route: [
        { x: -2, y: 0, z: 0 },
        { x: 2, y: 0, z: 0 },
      ],
      vias: [],
    },
    {
      connectionName: "arched",
      traceThickness: 0.08,
      viaDiameter: 0.25,
      route: [
        { x: -2, y: 1, z: 0 },
        { x: 0, y: 0.1, z: 0 },
        { x: 2, y: 1, z: 0 },
      ],
      vias: [],
    },
  ]
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.08,
    minTraceToPadEdgeClearance: 0.08,
    minViaDiameter: 0.25,
    minViaHoleDiameter: 0.15,
    bounds: { minX: -3, minY: -2, maxX: 3, maxY: 2 },
    obstacles: [],
    connections: routes.map((route) => ({
      name: route.connectionName,
      pointsToConnect: route.route
        .filter((_, pointIndex) =>
          [0, route.route.length - 1].includes(pointIndex),
        )
        .map((point, endpointIndex) => ({
          x: point.x,
          y: point.y,
          layer: "top",
          pointId: `${route.connectionName}_breakout_${endpointIndex}`,
        })),
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
    obstacles: [],
    layerCount: 2,
    defaultViaDiameter: 0.25,
    defaultViaHoleDiameter: 0.15,
    effort: 1,
    colorMap: {},
  })
  const evaluate = solver.exactRepairSolver!.params.drcEvaluator!
  const initial = evaluate({ traces: [], routes })
  expect(Array.isArray(initial) ? initial : initial.errors).not.toHaveLength(0)

  const copperCleanCandidate = structuredClone(routes)
  copperCleanCandidate[1]!.route[1]!.y = 0.5
  const repaired = evaluate({ traces: [], routes: copperCleanCandidate })

  expect(Array.isArray(repaired) ? repaired : repaired.errors).toHaveLength(0)
})
