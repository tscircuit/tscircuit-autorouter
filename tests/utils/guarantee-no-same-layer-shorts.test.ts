import { test, expect } from "bun:test"
import { readFileSync } from "node:fs"
import { CapacityMeshSolver } from "lib"
import {
  guaranteeNoSameLayerShorts,
  hasSameLayerShort,
} from "lib/utils/guaranteeNoSameLayerShorts"
import type { SimpleRouteJson } from "lib/types"

// bugreport01 is a real board the current solver routes with same-layer shorts.
// Prove the guarantee pass removes every different-net same-layer crossing.
test("guaranteeNoSameLayerShorts removes all same-layer shorts from routed output", () => {
  const raw = JSON.parse(
    readFileSync(
      "fixtures/bug-reports/bugreport01-be84eb/bugreport01-be84eb.json",
      "utf8",
    ),
  )
  const srj: SimpleRouteJson = raw.simple_route_json ?? raw
  const clearance = srj.defaultObstacleMargin ?? srj.minTraceWidth ?? 0.15
  const solver = new CapacityMeshSolver(srj as any)
  solver.solve()
  expect((solver as any).solved).toBe(true)
  const traces = (solver as any).getOutputSimplifiedPcbTraces()
  // raw router output carries a different-net same-layer violation on this board
  expect(hasSameLayerShort(traces, clearance)).toBe(true)
  // the guarantee pass removes every different-net same-layer violation
  const fixed = guaranteeNoSameLayerShorts(traces, clearance)
  expect(hasSameLayerShort(fixed, clearance)).toBe(false)
}, 120_000)

// Unit: two different-net traces crossing on the same layer -> one truncated.
test("guaranteeNoSameLayerShorts truncates a crossing, keeps a non-crossing", () => {
  const wire = (x: number, y: number) =>
    ({ route_type: "wire", x, y, width: 0.15, layer: "top" }) as const
  const traces = [
    {
      type: "pcb_trace",
      pcb_trace_id: "A",
      connection_name: "netA",
      route: [wire(0, 0), wire(10, 10)],
    },
    {
      type: "pcb_trace",
      pcb_trace_id: "B",
      connection_name: "netB",
      route: [wire(0, 10), wire(10, 0)],
    },
    {
      type: "pcb_trace",
      pcb_trace_id: "C",
      connection_name: "netC",
      route: [wire(0, 20), wire(10, 20)],
    },
  ] as any
  expect(hasSameLayerShort(traces)).toBe(true)
  const fixed = guaranteeNoSameLayerShorts(traces)
  expect(hasSameLayerShort(fixed)).toBe(false)
  // the non-crossing net C is untouched
  const c = fixed.find((t: any) => t.pcb_trace_id === "C")
  expect(c?.route).toHaveLength(2)
})
