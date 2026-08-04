import { expect, test } from "bun:test"
import type { DrcEvaluator } from "high-density-repair03/lib"
import { FinalViaOptimizationSolver } from "lib/solvers/FinalViaOptimizationSolver/FinalViaOptimizationSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

test("final via optimization rejects DRC and converted-output regressions", () => {
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
  const route: HighDensityRoute = {
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
  }
  const getSolver = ({
    productionDrcEvaluator,
    convertKeepsVias = false,
  }: {
    productionDrcEvaluator: DrcEvaluator
    convertKeepsVias?: boolean
  }) =>
    new FinalViaOptimizationSolver({
      hdRoutes: [structuredClone(route)],
      originalSrj: srj,
      obstacles: [],
      layerCount: 2,
      connMap: getConnectivityMapFromSimpleRouteJson(srj),
      productionDrcEvaluator,
      relaxedDrcEvaluator: (() => ({ errors: [] })) as DrcEvaluator,
      convert: (routes) => {
        const vias = convertKeepsVias
          ? route.vias
          : routes.flatMap((candidateRoute) => candidateRoute.vias)
        return [
          {
            type: "pcb_trace" as const,
            pcb_trace_id: "trace",
            connection_name: "trace",
            route: vias.map((via) => ({
              route_type: "via" as const,
              x: via.x,
              y: via.y,
              from_layer: "top",
              to_layer: "bottom",
            })),
          },
        ]
      },
    })
  const countRegression = getSolver({
    productionDrcEvaluator: (({ routes }) => ({
      errors: routes?.[0]?.vias.length === 0 ? [{ message: "new error" }] : [],
    })) as DrcEvaluator,
  })
  const severityRegression = getSolver({
    productionDrcEvaluator: (({ routes }) => ({
      errors: [
        {
          message:
            routes?.[0]?.vias.length === 0
              ? "gap: 0mm required: 0.1mm"
              : "gap: 0.09mm required: 0.1mm",
        },
      ],
    })) as DrcEvaluator,
  })
  const noConvertedViaReduction = getSolver({
    productionDrcEvaluator: (() => ({ errors: [] })) as DrcEvaluator,
    convertKeepsVias: true,
  })

  countRegression.solve()
  severityRegression.solve()
  noConvertedViaReduction.solve()

  expect(countRegression.stats.rejectedByProductionDrcCount).toBeGreaterThan(0)
  expect(severityRegression.stats.rejectedByProductionDrcCount).toBeGreaterThan(
    0,
  )
  expect(noConvertedViaReduction.stats.rejectedByMetadataCount).toBeGreaterThan(
    0,
  )
  expect(countRegression.getOutput()[0]?.vias).toHaveLength(2)
})
