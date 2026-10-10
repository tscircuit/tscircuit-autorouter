import { expect, test } from "bun:test"
import { isWithinTraceCleanupCorridor } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/isWithinTraceCleanupCorridor"
import type { SimplifiedPcbTrace } from "lib/types"

test("cleanup rejects a shortcut whose endpoints fit but middle leaves the corridor", (): void => {
  const start = {
    route_type: "wire" as const,
    x: 0,
    y: 0,
    layer: "top",
    width: 0.3,
  }
  const end = { ...start, x: 4, y: 4 }
  const original: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "power-trace",
    connection_name: "power",
    route: [start, { ...start, x: 4 }, end],
  }
  expect(isWithinTraceCleanupCorridor([start, end], original)).toBe(false)
})
