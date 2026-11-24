import { expect, test } from "bun:test"
import type { AnyCircuitElement, PcbVia } from "circuit-json"
import type { SimpleRouteJson } from "lib/types"
import { getViasConnectedByCopperPour } from "lib/utils/autorouting-drc/getViasConnectedByCopperPour"

test("a pour connects emitted via barrels only across continuous copper on their layer", () => {
  const srj: SimpleRouteJson = {
    layerCount: 4,
    bounds: { minX: -4, minY: -4, maxX: 4, maxY: 4 },
    minTraceWidth: 0.15,
    obstacles: [],
    connections: [
      {
        name: "ground",
        externallyConnectedPointIds: [["a", "b"]],
        pointsToConnect: [
          {
            pointId: "a",
            x: 0,
            y: 0,
            layer: "top",
            terminalVia: { toLayer: "inner2" },
          },
          {
            pointId: "b",
            x: 2,
            y: 0,
            layer: "top",
            terminalVia: { toLayer: "inner2" },
          },
        ],
      },
    ],
  }
  const traces: AnyCircuitElement[] = ["ground", "signal"].map((name) => ({
    type: "pcb_trace",
    pcb_trace_id: `${name}-wire`,
    source_trace_id: name,
    route: [],
  }))
  const a: PcbVia = {
    type: "pcb_via",
    pcb_via_id: "via-a",
    pcb_trace_id: "ground-wire",
    x: 0,
    y: 0,
    layers: ["top", "inner1", "inner2", "bottom"],
    outer_diameter: 0.6,
    hole_diameter: 0.3,
  }
  const b = { ...a, pcb_via_id: "via-b", x: 2 }
  // The input still declares both sites externally connected.
  expect(getViasConnectedByCopperPour(srj)([...traces, a, b])).toEqual([])
  const tile = (x: number, width: number) => ({
    type: "rect" as const,
    center: { x, y: 0 },
    width,
    height: 1,
    connectedTo: ["ground"],
    isCopperPour: true,
    layers: ["inner2"],
  })
  srj.obstacles = [tile(0, 1), tile(2, 1)]
  expect(getViasConnectedByCopperPour(srj)([...traces, a, b])).toEqual([])
  srj.obstacles.push(tile(1, 1))
  srj.connections[0]!.externallyConnectedPointIds = []
  const groups = getViasConnectedByCopperPour(srj)
  expect(groups([...traces, a, b])).toEqual([["via-a", "via-b"]])
  expect(
    groups(
      [a, b].map((via) => ({
        ...via,
        pcb_trace_id: undefined,
        source_net_id: "ground",
      })),
    ),
  ).toEqual([["via-a", "via-b"]])
  expect(groups([...traces, a])).toEqual([])
  expect(groups([...traces, a, { ...b, x: 2.1 }])).toEqual([["via-a", "via-b"]])
  expect(groups([...traces, a, { ...b, x: 3 }])).toEqual([])
  expect(groups([...traces, a, { ...b, hole_diameter: 0 }])).toEqual([])
  expect(groups([...traces, a, { ...b, layers: ["top", "inner1"] }])).toEqual(
    [],
  )
  expect(groups([...traces, a, { ...b, pcb_trace_id: "signal-wire" }])).toEqual(
    [],
  )
})
