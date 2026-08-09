import { expect, test } from "bun:test"
import { isDeepStrictEqual } from "node:util"
import { createPipeline7RelaxedDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/create-pipeline7-relaxed-drc-evaluator"
import { convertPipeline7HdRoutesToSimplifiedPcbTraces } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

test("Pipeline7 repair uses the benchmark relaxed DRC path", () => {
  const srjWithPointPairs: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    obstacles: [],
    connections: [
      {
        name: "trace",
        pointsToConnect: [
          { x: -1, y: 0.2, layer: "top", pointId: "start" },
          { x: 1, y: 0.2, layer: "top", pointId: "end" },
        ],
      },
    ],
  }
  const inputSrj: SimpleRouteJson = {
    ...srjWithPointPairs,
    obstacles: [
      {
        type: "rect",
        layers: ["top"],
        center: { x: 0, y: 0 },
        width: 0.2,
        height: 0.2,
        connectedTo: ["pcb_smtpad_foreign"],
        circuitJsonMetadata: { pcb_smtpad_id: "pcb_smtpad_foreign" },
      },
    ],
  }
  const connMap = getConnectivityMapFromSimpleRouteJson(srjWithPointPairs)
  const conversionOptions = {
    connections: srjWithPointPairs.connections,
    originalConnections: inputSrj.connections,
    layerCount: srjWithPointPairs.layerCount,
    obstacles: srjWithPointPairs.obstacles,
    defaultViaHoleDiameter: 0.15,
    connMap,
    srjWithPointPairs,
    originalSrj: inputSrj,
  }
  const route: HighDensityRoute = {
    connectionName: "trace",
    route: [
      { x: -1, y: 0.2, z: 0 },
      { x: 1, y: 0.2, z: 0 },
    ],
    vias: [],
    traceThickness: 0.1,
    viaDiameter: 0.3,
  }
  const traces = convertPipeline7HdRoutesToSimplifiedPcbTraces({
    ...conversionOptions,
    hdRoutes: [route],
  })
  const benchmarkResult = evaluateRelaxedDrc({
    inputSrj,
    srjWithPointPairs,
    routedTraces: traces,
  })
  const exactEvaluator = createPipeline7RelaxedDrcEvaluator({
    ...conversionOptions,
  })
  const exactResult = exactEvaluator({ traces: [], routes: [route] })

  if (Array.isArray(exactResult)) {
    throw new Error("Exact DRC evaluator returned errors without centers")
  }

  expect(isDeepStrictEqual(exactResult.errors, benchmarkResult.errors)).toBe(
    true,
  )
  expect(
    isDeepStrictEqual(
      exactResult.errorsWithCenters,
      benchmarkResult.errorsWithCenters,
    ),
  ).toBe(true)
  expect(
    benchmarkResult.errors.some(
      (error) => error.type === "pcb_pad_trace_clearance_error",
    ),
  ).toBe(true)
  expect(
    benchmarkResult.errors.some(
      (error) =>
        "error_type" in error && error.error_type === "pcb_trace_error",
    ),
  ).toBe(true)
})
