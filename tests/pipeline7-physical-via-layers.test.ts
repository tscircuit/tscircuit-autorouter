import { expect, test } from "bun:test"
import { createPipeline7AutoroutingDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/create-pipeline7-autorouting-drc-evaluator"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

test("Pipeline7 repair and reference checks preserve the original via policy", () => {
  const routes: HighDensityRoute[] = [
    {
      connectionName: "power",
      traceThickness: 0.12,
      viaDiameter: 0.2,
      vias: [{ x: 0, y: 0 }],
      route: [
        { x: -1, y: 0, z: 0 },
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 1 },
        { x: 1, y: 0, z: 1 },
      ],
    },
    {
      connectionName: "signal",
      traceThickness: 0.12,
      viaDiameter: 0.2,
      vias: [],
      route: [
        { x: 0, y: -1, z: 3 },
        { x: 0, y: 1, z: 3 },
      ],
    },
  ]
  const srj: SimpleRouteJson = {
    layerCount: 4,
    minTraceWidth: 0.12,
    minViaDiameter: 0.2,
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    obstacles: [],
    connections: [
      {
        name: "power",
        pointsToConnect: [
          { x: -1, y: 0, layer: "top" },
          { x: 1, y: 0, layer: "inner1" },
        ],
      },
      {
        name: "signal",
        pointsToConnect: [
          { x: 0, y: -1, layer: "bottom" },
          { x: 0, y: 1, layer: "bottom" },
        ],
      },
    ],
  }
  for (const allowBlindAndBuriedVias of [false, true]) {
    const originalSrj = { ...srj, allowBlindAndBuriedVias }
    const evaluator = createPipeline7AutoroutingDrcEvaluator({
      connections: srj.connections,
      originalConnections: srj.connections,
      layerCount: srj.layerCount,
      obstacles: [],
      defaultViaHoleDiameter: 0.1,
      connMap: getConnectivityMapFromSimpleRouteJson(srj),
      srjWithPointPairs: srj,
      originalSrj,
    })
    const result = evaluator({ traces: [], routes })
    if (Array.isArray(result)) throw new Error("Expected centered DRC result")
    expect(result.errors.length > 0).toBe(!allowBlindAndBuriedVias)
    const json = convertToCircuitJson(srj, routes, { originalSrj })
    const via = json.find((element) => element.type === "pcb_via")
    expect(via?.layers).toEqual(
      allowBlindAndBuriedVias
        ? ["top", "inner1"]
        : ["top", "inner1", "inner2", "bottom"],
    )
  }
})
