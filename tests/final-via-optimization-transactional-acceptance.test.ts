import { expect, test } from "bun:test"
import { createPipeline7AutoroutingDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/create-pipeline7-autorouting-drc-evaluator"
import { createPipeline7RelaxedDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/create-pipeline7-relaxed-drc-evaluator"
import { convertPipeline7HdRoutesToSimplifiedPcbTraces } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import { FinalViaOptimizationSolver } from "lib/solvers/FinalViaOptimizationSolver/FinalViaOptimizationSolver"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("final via optimization accepts only a DRC-safe converted via reduction", () => {
  const srj = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    obstacles: [],
    connections: [
      {
        name: "trace",
        pointsToConnect: [
          { x: -1, y: 0, layer: "top", pointId: "start" },
          { x: 1, y: 0, layer: "top", pointId: "end" },
        ],
      },
    ],
  }
  const hdRoutes: HighDensityRoute[] = [
    {
      connectionName: "trace",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      vias: [
        { x: -0.5, y: 0 },
        { x: 0.5, y: 0 },
      ],
      route: [
        { x: -1, y: 0, z: 0 },
        { x: -0.5, y: 0, z: 0 },
        { x: -0.5, y: 0, z: 1 },
        { x: 0.5, y: 0, z: 1 },
        { x: 0.5, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
      ],
    },
  ]
  const connMap = getConnectivityMapFromSimpleRouteJson(srj)
  const conversionOptions = {
    connections: srj.connections,
    originalConnections: srj.connections,
    layerCount: srj.layerCount,
    obstacles: srj.obstacles,
    defaultViaHoleDiameter: 0.15,
    connMap,
    srjWithPointPairs: srj,
    originalSrj: srj,
  }
  const solver = new FinalViaOptimizationSolver({
    hdRoutes,
    originalSrj: srj,
    obstacles: [],
    layerCount: 2,
    connMap,
    productionDrcEvaluator:
      createPipeline7AutoroutingDrcEvaluator(conversionOptions),
    relaxedDrcEvaluator: createPipeline7RelaxedDrcEvaluator(conversionOptions),
    convert: (routes) =>
      convertPipeline7HdRoutesToSimplifiedPcbTraces({
        ...conversionOptions,
        hdRoutes: routes,
      }),
  })

  solver.solve()

  expect(solver.getOutput()[0]?.vias).toEqual([])
  expect(solver.stats.removedViaCount).toBe(2)
  expect(hdRoutes[0]?.vias).toHaveLength(2)
})
