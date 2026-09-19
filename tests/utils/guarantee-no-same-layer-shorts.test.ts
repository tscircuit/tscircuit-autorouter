import { expect, test } from "bun:test"
import {
  guaranteeNoSameLayerShorts,
  hasSameLayerShort,
} from "lib/utils/guaranteeNoSameLayerShorts"

const wire = (x: number, y: number, layer = "top") =>
  ({ route_type: "wire", x, y, width: 0.15, layer }) as const

const crossing = (extra: unknown[] = []) =>
  [
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
    ...extra,
  ] as const

test("guaranteeNoSameLayerShorts relocates a crossing onto a free layer", () => {
  const traces = crossing([
    {
      type: "pcb_trace",
      pcb_trace_id: "C",
      connection_name: "netC",
      route: [wire(0, 20, "bottom"), wire(10, 20, "bottom")],
    },
  ])

  expect(hasSameLayerShort(traces as any)).toBe(true)
  const fixed = guaranteeNoSameLayerShorts(traces as any)

  expect(hasSameLayerShort(fixed)).toBe(false)
  // The relocated connection keeps both of its terminals, with a via at each end
  const a = fixed.find((t) => t.pcb_trace_id === "A")!
  expect(a.route[0]).toMatchObject({ x: 0, y: 0 })
  expect(a.route[a.route.length - 1]).toMatchObject({ x: 10, y: 10 })
  expect(a.route.filter((point) => point.route_type === "via")).toHaveLength(2)
})

test("guaranteeNoSameLayerShorts leaves a crossing it cannot resolve", () => {
  const traces = crossing()

  expect(hasSameLayerShort(traces as any)).toBe(true)
  const fixed = guaranteeNoSameLayerShorts(traces as any)

  // No alternative layer exists, so resolving would require cutting the trace
  // and creating a missing connection; the crossing is left untouched.
  expect(hasSameLayerShort(fixed)).toBe(true)
  expect(fixed.find((t) => t.pcb_trace_id === "A")?.route).toEqual(
    traces[0].route as any,
  )
})

test("guaranteeNoSameLayerShorts respects a forbidden via region", () => {
  const traces = crossing([
    {
      type: "pcb_trace",
      pcb_trace_id: "C",
      connection_name: "netC",
      route: [wire(0, 20, "bottom"), wire(10, 20, "bottom")],
    },
  ])

  const fixed = guaranteeNoSameLayerShorts(traces as any, 0, {
    canPlaceVia: () => false,
  })

  expect(hasSameLayerShort(fixed)).toBe(true)
})
