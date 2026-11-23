import { expect, test } from "bun:test"
import { createPipeline9AutoroutingDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9AutoroutingDrcEvaluator"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"

test("detects a four-micron clearance loss below the display tolerance", () => {
  const board: SimpleRouteJson = {
    bounds: { minX: -3, maxX: 3, minY: -2, maxY: 2 },
    layerCount: 4,
    minTraceWidth: 0.127,
    minTraceToPadEdgeClearance: 0.127,
    obstacles: [],
    connections: [],
  }
  const traces: SimplifiedPcbTrace[] = [0, 0.25].map((y, index) => ({
    type: "pcb_trace",
    pcb_trace_id: `pcb_trace_${index}`,
    connection_name: `signal_${index}`,
    route: [
      { route_type: "wire", x: -1, y, width: 0.127, layer: "top" },
      { route_type: "wire", x: 1, y, width: 0.127, layer: "top" },
    ],
  }))
  const boardRules = {
    inputSrj: board,
    srjWithPointPairs: board,
    drcOptions: { traceClearance: 0.127, includeTraceContinuity: false },
  }
  expect(
    createPipeline9AutoroutingDrcEvaluator(boardRules)(traces).errors,
  ).toEqual([])
  const checkPhysicalEdges = createPipeline9AutoroutingDrcEvaluator({
    ...boardRules,
    clearanceTolerance: 1e-9,
  })
  expect(checkPhysicalEdges(traces).errors).toHaveLength(1)
})
