import { expect, test } from "bun:test"
import { createPipeline7AutoroutingDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/create-pipeline7-autorouting-drc-evaluator"
import { convertPipeline7HdRoutesToSimplifiedPcbTraces } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

test("Pipeline7 autorouting DRC finds every reference trace collision", () => {
  const srjWithPointPairs: SimpleRouteJson = {
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
  const connMap = getConnectivityMapFromSimpleRouteJson(srjWithPointPairs)
  const conversionOptions = {
    connections: srjWithPointPairs.connections,
    originalConnections: srjWithPointPairs.connections,
    layerCount: srjWithPointPairs.layerCount,
    obstacles: srjWithPointPairs.obstacles,
    defaultViaHoleDiameter: 0.15,
    connMap,
    srjWithPointPairs,
    originalSrj: srjWithPointPairs,
  }
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
  const traces = convertPipeline7HdRoutesToSimplifiedPcbTraces({
    ...conversionOptions,
    hdRoutes: routes,
  })
  const referenceResult = evaluateRelaxedDrc({
    inputSrj: srjWithPointPairs,
    srjWithPointPairs,
    routedTraces: traces,
  })
  const evaluator = createPipeline7AutoroutingDrcEvaluator(conversionOptions)
  const optimizedResult = evaluator({ traces: [], routes })

  if (Array.isArray(optimizedResult)) {
    throw new Error("Autorouting DRC evaluator returned errors without centers")
  }

  const referenceTraceCollisions = referenceResult.errors.filter(
    (error) =>
      error.type === "pcb_trace_error" &&
      "pcb_trace_error_id" in error &&
      error.pcb_trace_error_id.startsWith("overlap_"),
  )

  expect(referenceTraceCollisions.length).toBe(1)
  expect(optimizedResult.errors.length).toBe(1)
  expect(optimizedResult.errors[0]?.error_type).toBe(
    referenceTraceCollisions[0]?.error_type,
  )
  expect(optimizedResult.errorsWithCenters?.[0]?.center).toEqual({
    x: 0,
    y: 0,
  })
})
