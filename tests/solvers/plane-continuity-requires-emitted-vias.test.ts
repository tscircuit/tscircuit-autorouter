import { expect, test } from "bun:test"
import type { AnyCircuitElement, PcbVia } from "circuit-json"
import type { SimpleRouteJson } from "lib/types"
import { getExternalViaGroups } from "lib/utils/autorouting-drc/getExternalViaGroups"

test("only emitted barrels of the declared net that reach the plane share continuity", () => {
  const srj: SimpleRouteJson = {
    layerCount: 4, bounds: { minX: -4, minY: -4, maxX: 4, maxY: 4 }, minTraceWidth: 0.15, obstacles: [],
    connections: [{ name: "ground", externallyConnectedPointIds: [["a", "b"]], pointsToConnect: [
      { pointId: "a", x: 0, y: 0, layer: "top", terminalVia: { toLayer: "inner2" } },
      { pointId: "b", x: 2, y: 0, layer: "top", terminalVia: { toLayer: "inner2" } },
    ] }],
  }
  const groups = getExternalViaGroups(srj)
  const traces: AnyCircuitElement[] = ["ground", "signal"].map((name) => ({ type: "pcb_trace", pcb_trace_id: `${name}-wire`, source_trace_id: name, route: [] }))
  const a: PcbVia = { type: "pcb_via", pcb_via_id: "via-a", pcb_trace_id: "ground-wire", x: 0, y: 0, layers: ["top", "inner1", "inner2", "bottom"], outer_diameter: 0.6, hole_diameter: 0.3 }
  const b = { ...a, pcb_via_id: "via-b", x: 2 }
  expect(groups([...traces, a, b])).toEqual([["via-a", "via-b"]])
  expect(groups([...traces, a])).toEqual([])
  expect(groups([...traces, a, { ...b, x: 2.1 }])).toEqual([])
  expect(groups([...traces, a, { ...b, layers: ["top", "inner1"] }])).toEqual([])
  expect(groups([...traces, a, { ...b, pcb_trace_id: "signal-wire" }])).toEqual([])
})
