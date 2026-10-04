import { expect, test } from "bun:test"
import { PcbConnectivityGeometryCache } from "@tscircuit/checks"
import type { AnyCircuitElement } from "circuit-json"
import { getDrcErrors } from "lib/testing/getDrcErrors"

test("shared DRC geometry observes edited copper without changing ordered errors", () => {
  const cache = new PcbConnectivityGeometryCache()
  const circuit: AnyCircuitElement[] = [
    {
      type: "pcb_via", pcb_via_id: "via", pcb_trace_id: "trace_a",
      x: 0, y: 0, outer_diameter: 0.3, hole_diameter: 0.1,
      layers: ["top", "bottom"],
    },
    {
      type: "pcb_trace", pcb_trace_id: "trace_a", source_trace_id: "source_a",
      route: [
        { route_type: "wire", x: -1, y: 0, layer: "top", width: 0.1 },
        { route_type: "wire", x: 1, y: 0, layer: "top", width: 0.1 },
      ],
    },
    {
      type: "pcb_trace", pcb_trace_id: "trace_b", source_trace_id: "source_b",
      route: [
        { route_type: "wire", x: 0, y: -1, layer: "bottom", width: 0.1 },
        { route_type: "wire", x: 0, y: 1, layer: "bottom", width: 0.1 },
      ],
    },
  ]
  const compare = (): void => {
    const before = JSON.stringify(circuit)
    expect(getDrcErrors(circuit, { connectivityGeometryCache: cache })).toEqual(
      getDrcErrors(circuit),
    )
    expect(JSON.stringify(circuit)).toBe(before)
  }
  compare()
  compare()
  expect(cache.getStats().hits).toBeGreaterThan(0)
  for (let step = 0; step < 12; step++) {
    for (const element of circuit) {
      if (element.type === "pcb_via") {
        element.x = step % 3
        element.outer_diameter = 0.3 + step * 0.01
        element.layers = step % 2 === 0 ? ["top"] : ["top", "bottom"]
      }
      if (element.type === "pcb_trace") {
        for (const point of element.route) {
          if (point.route_type !== "wire") continue
          point.width = 0.1 + step * 0.01
          point.x += step * 0.001
        }
      }
    }
    compare()
  }
})
