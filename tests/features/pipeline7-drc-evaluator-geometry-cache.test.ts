import { expect, test } from "bun:test"
import { createPipeline7AutoroutingDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/create-pipeline7-autorouting-drc-evaluator"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

test("Pipeline7 DRC evaluation reuses equal geometry and invalidates changes", () => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    obstacles: [],
    connections: [
      {
        name: "horizontal",
        pointsToConnect: [
          { x: -1, y: 0, layer: "top", pointId: "horizontal_start" },
          { x: 1, y: 0, layer: "top", pointId: "horizontal_end" },
        ],
      },
      {
        name: "vertical",
        pointsToConnect: [
          { x: 0, y: -1, layer: "top", pointId: "vertical_start" },
          { x: 0, y: 1, layer: "top", pointId: "vertical_end" },
        ],
      },
    ],
  }
  const connMap = getConnectivityMapFromSimpleRouteJson(srj)
  const evaluator = createPipeline7AutoroutingDrcEvaluator({
    connections: srj.connections,
    originalConnections: srj.connections,
    layerCount: srj.layerCount,
    obstacles: srj.obstacles,
    defaultViaHoleDiameter: 0.15,
    connMap,
    srjWithPointPairs: srj,
    originalSrj: srj,
  })
  const routes: HighDensityRoute[] = [
    {
      connectionName: "horizontal",
      route: [
        { x: -1, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
      ],
      vias: [],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
    {
      connectionName: "vertical",
      route: [
        { x: 0, y: -1, z: 0 },
        { x: 0, y: 1, z: 0 },
      ],
      vias: [],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
  ]

  expect(evaluator.consumesHdRoutesDirectly).toBe(true)
  const crossingResult = evaluator({ traces: [], routes })
  const equivalentResult = evaluator({
    traces: [],
    routes: structuredClone(routes),
  })
  expect(
    Array.isArray(crossingResult) ? crossingResult : crossingResult.errors,
  ).toHaveLength(1)
  expect(equivalentResult).toBe(crossingResult)

  routes[1]!.route[0]!.x = 1.5
  routes[1]!.route[1]!.x = 1.5
  const separatedResult = evaluator({ traces: [], routes })
  expect(separatedResult).not.toBe(crossingResult)
  expect(
    Array.isArray(separatedResult) ? separatedResult : separatedResult.errors,
  ).toHaveLength(0)

  routes[1]!.route[0]!.x = 0
  routes[1]!.route[1]!.x = 0
  expect(evaluator({ traces: [], routes })).toBe(crossingResult)
})
