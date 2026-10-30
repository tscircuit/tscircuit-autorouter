import { expect, test } from "bun:test"
import { getPipeline9ForceWarmupIterations } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9ForceWarmupIterations"
import type { SimpleRouteJson } from "lib/types"

test("short force warm-up is limited to unpreloaded two-layer boards with default clearances", () => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    obstacles: [],
    connections: [],
    bounds: { minX: 0, maxX: 10, minY: 0, maxY: 10 },
  }
  expect(getPipeline9ForceWarmupIterations(srj)).toBe(2)
  expect(getPipeline9ForceWarmupIterations({ ...srj, layerCount: 4 })).toBe(16)
  expect(
    getPipeline9ForceWarmupIterations({
      ...srj,
      traces: [
        {
          type: "pcb_trace",
          pcb_trace_id: "preloaded",
          connection_name: "net",
          route: [],
        },
      ],
    }),
  ).toBe(16)
  for (const field of [
    "minTraceToPadEdgeClearance",
    "minTraceToHoleEdgeClearance",
    "minBoardEdgeClearance",
    "minViaEdgeToPadEdgeClearance",
    "minViaHoleEdgeToViaHoleEdgeClearance",
    "minPlatedHoleDrillEdgeToDrillEdgeClearance",
    "minPadEdgeToPadEdgeClearance",
  ] as const) {
    for (const clearance of [0, 0.2]) {
      expect(
        getPipeline9ForceWarmupIterations({ ...srj, [field]: clearance }),
      ).toBe(16)
    }
  }
})
