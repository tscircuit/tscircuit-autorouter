import { expect, test } from "bun:test"
import { PreprocessSimpleRouteJsonSolver } from "lib/autorouter-pipelines/AutoroutingPipeline4_TinyHypergraph/PreprocessSimpleRouteJsonSolver"
import type { SimpleRouteJson } from "lib"

test("preserves SimpleRouteJson bus metadata during preprocessing", () => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    allowBlindAndBuriedVias: true,
    minTraceWidth: 0.1,
    minViaHoleEdgeToViaHoleEdgeClearance: 0.2,
    minPlatedHoleDrillEdgeToDrillEdgeClearance: 0.25,
    minPadEdgeToPadEdgeClearance: 0.1,
    obstacles: [],
    connections: [
      {
        name: "data0",
        routingPcbGroupId: "pcb_group_1",
        source_trace_id: "source_trace_1",
        width: 0.12,
        pointsToConnect: [
          {
            x: -1,
            y: 0,
            layer: "top",
            port_selector: "U1.DATA0",
          },
          { x: 1, y: 0, layer: "top" },
        ],
      },
      {
        name: "data1",
        pointsToConnect: [
          { x: -1, y: 1, layer: "top" },
          { x: 1, y: 1, layer: "top" },
        ],
      },
    ],
    buses: [
      {
        busId: "data",
        name: "Data bus",
        connectionNames: ["data0", "data1"],
        connectionExitTargets: {
          data0: { x: 1, y: 0, layer: "top" },
          data1: { x: 1, y: 1 },
        },
        maxLengthSkew: 0.1,
        traceWidth: 0.12,
        allowedLayers: ["top"],
        preferredLayer: "top",
        preferredLayers: ["bottom"],
        termination: { type: "plane", layer: "bottom" },
      },
    ],
    differentialPairs: [
      {
        connectionNames: ["data0", "data1"],
        lengthTolerance: 0.05,
        traceGap: 0.1,
        maxUncoupledLength: 0.5,
      },
    ],
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
  }
  const solver = new PreprocessSimpleRouteJsonSolver(srj)

  solver.solve()

  const output = solver.getOutputSimpleRouteJson()
  expect(output.allowBlindAndBuriedVias).toBe(true)
  expect(output.minViaHoleEdgeToViaHoleEdgeClearance).toBe(0.2)
  expect(output.minPlatedHoleDrillEdgeToDrillEdgeClearance).toBe(0.25)
  expect(output.minPadEdgeToPadEdgeClearance).toBe(0.1)
  expect(output.connections).toEqual(srj.connections)
  expect(solver.getOutputSimpleRouteJson().buses).toEqual(srj.buses)
  expect(solver.getOutputSimpleRouteJson().differentialPairs).toEqual(
    srj.differentialPairs,
  )
})
