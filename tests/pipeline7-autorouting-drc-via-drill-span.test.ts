import { expect, test } from "bun:test"
import { convertPipeline7HdRoutesToSimplifiedPcbTraces } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import { createPipeline7AutoroutingDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/create-pipeline7-autorouting-drc-evaluator"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

test("Pipeline7 repair agrees with reference DRC on physical through-via spans", (): void => {
  const routes: HighDensityRoute[] = [
    {
      connectionName: "signal",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: -1, y: 0, z: 0 },
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 2 },
        { x: 1, y: 0, z: 2 },
      ],
      vias: [{ x: 0, y: 0 }],
    },
    {
      connectionName: "foreign",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: 0, y: -1, z: 3 },
        { x: 0, y: 1, z: 3 },
      ],
      vias: [],
    },
  ]
  const originalRoutes = structuredClone(routes)
  for (const allowBlindAndBuriedVias of [undefined, false, true]) {
    const srj: SimpleRouteJson = {
      layerCount: 4,
      minTraceWidth: 0.1,
      minViaDiameter: 0.3,
      allowBlindAndBuriedVias,
      bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
      obstacles: [],
      connections: [
        {
          name: "signal",
          pointsToConnect: [
            { x: -1, y: 0, layer: "top", pointId: "signal_start" },
            { x: 1, y: 0, layer: "inner2", pointId: "signal_end" },
          ],
        },
        {
          name: "foreign",
          pointsToConnect: [
            { x: 0, y: -1, layer: "bottom", pointId: "foreign_start" },
            { x: 0, y: 1, layer: "bottom", pointId: "foreign_end" },
          ],
        },
      ],
    }
    const options = {
      connections: srj.connections,
      originalConnections: srj.connections,
      layerCount: srj.layerCount,
      obstacles: srj.obstacles,
      defaultViaHoleDiameter: 0.15,
      connMap: getConnectivityMapFromSimpleRouteJson(srj),
      srjWithPointPairs: srj,
      originalSrj: srj,
    }
    const reference = evaluateRelaxedDrc({
      inputSrj: srj,
      srjWithPointPairs: srj,
      routedTraces: convertPipeline7HdRoutesToSimplifiedPcbTraces({
        ...options,
        hdRoutes: routes,
      }),
    })
    const result = createPipeline7AutoroutingDrcEvaluator(options)({
      traces: [],
      routes,
    })
    if (Array.isArray(result)) throw new Error("Expected indexed DRC result")
    // Isolate copper contacts: these synthetic routes have no terminal pads.
    const referenceContacts = reference.errors.filter(
      (error) =>
        error.type === "pcb_trace_error" &&
        error.pcb_trace_error_id?.startsWith("overlap_"),
    )
    expect(referenceContacts).toHaveLength(allowBlindAndBuriedVias ? 0 : 1)
    expect(result.errors).toHaveLength(allowBlindAndBuriedVias ? 0 : 1)

    const preloadedTraces = convertPipeline7HdRoutesToSimplifiedPcbTraces({
      ...options,
      hdRoutes: [routes[0]!],
    })
    for (const point of preloadedTraces[0]!.route) {
      if (point.route_type === "via") {
        point.layers = ["top", "inner1", "inner2"]
      }
    }
    const preloadedResult = createPipeline7AutoroutingDrcEvaluator({
      ...options,
      originalSrj: { ...srj, traces: preloadedTraces },
    })({ traces: [], routes: [routes[1]!] })
    if (Array.isArray(preloadedResult)) {
      throw new Error("Expected indexed DRC result")
    }
    expect(preloadedResult.errors).toHaveLength(allowBlindAndBuriedVias ? 0 : 1)
  }
  expect(routes).toEqual(originalRoutes)
})
