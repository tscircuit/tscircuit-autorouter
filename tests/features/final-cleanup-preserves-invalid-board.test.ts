import { expect, test } from "bun:test"
import { Pipeline9FinalTraceCleanupSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9FinalTraceCleanupSolver"
import type { SimpleRouteJson, SimplifiedPcbTraces } from "lib/types"

test("cosmetic cleanup leaves DRC repair to upstream stages", () => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.3,
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
    obstacles: [],
    connections: [],
  }
  const traces: SimplifiedPcbTraces = [
    {
      type: "pcb_trace",
      pcb_trace_id: "horizontal",
      connection_name: "power",
      route: [
        { route_type: "wire", x: -3, y: 0, width: 0.3, layer: "top" },
        { route_type: "wire", x: 3, y: 0, width: 0.3, layer: "top" },
      ],
    },
    {
      type: "pcb_trace",
      pcb_trace_id: "vertical",
      connection_name: "signal",
      route: [
        { route_type: "wire", x: 0, y: -3, width: 0.3, layer: "top" },
        { route_type: "wire", x: 0, y: 3, width: 0.3, layer: "top" },
      ],
    },
  ]
  const solver = new Pipeline9FinalTraceCleanupSolver({
    srj,
    srjWithPointPairs: srj,
    traces,
    fixedTraces: [],
    connectionNames: ["power"],
  })

  expect(solver.solved).toBeTrue()
  expect(solver.getOutput()).toEqual(traces)
})
