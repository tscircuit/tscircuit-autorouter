import { expect, test } from "bun:test"
import { combinePreloadedAndRoutedTraces } from "lib/testing/evaluate-relaxed-drc"
import type { SimplifiedPcbTrace } from "lib/types"

const createTrace = (pcbTraceId: string, y: number): SimplifiedPcbTrace => ({
  type: "pcb_trace",
  pcb_trace_id: pcbTraceId,
  connection_name: pcbTraceId,
  route: [
    {
      route_type: "wire",
      x: 0,
      y,
      width: 0.1,
      layer: "top",
    },
    {
      route_type: "wire",
      x: 1,
      y,
      width: 0.1,
      layer: "top",
    },
  ],
})

test("joint DRC treats matching PCB trace ids as mutations", () => {
  const original = createTrace("existing", 0)
  const replacement = createTrace("existing", 1)
  const newTrace = createTrace("new", 2)

  const jointTraces = combinePreloadedAndRoutedTraces(
    [original],
    [replacement, newTrace],
  )

  expect(jointTraces).toEqual([replacement, newTrace])
})
