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

test("joint DRC only replaces preloaded traces with explicit metadata", () => {
  const original = createTrace("existing", 0)
  const replacement = {
    ...createTrace("replacement", 1),
    __replaces_pcb_trace_id: original.pcb_trace_id,
  }
  const collidingOriginal = createTrace("collision", 2)
  const unmarkedCollision = createTrace("collision", 3)
  const newTrace = createTrace("new", 2)

  const jointTraces = combinePreloadedAndRoutedTraces(
    [original, collidingOriginal],
    [replacement, unmarkedCollision, newTrace],
  )

  expect(jointTraces).toEqual([
    collidingOriginal,
    replacement,
    unmarkedCollision,
    newTrace,
  ])
})
