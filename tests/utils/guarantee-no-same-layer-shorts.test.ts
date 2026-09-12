import { expect, test } from "bun:test"
import {
  guaranteeNoSameLayerShorts,
  hasSameLayerShort,
} from "lib/utils/guaranteeNoSameLayerShorts"

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
  ] as const

  expect(hasSameLayerShort(traces as any)).toBe(true)
  const fixed = guaranteeNoSameLayerShorts(traces as any)
  expect(hasSameLayerShort(fixed)).toBe(false)
  const c = fixed.find((t) => t.pcb_trace_id === "C")
  expect(c?.route).toHaveLength(2)
})
