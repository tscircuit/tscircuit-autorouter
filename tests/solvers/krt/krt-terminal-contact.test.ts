import { expect, test } from "bun:test"
import { acceptKrtBranches } from "lib/testing/acceptKrtBranches"
import { prepareKrtBranches } from "lib/testing/prepareKrtBranches"
import { krtTestBoard } from "./krtTestBoard"

test("direct KRT preserves the grid path and validates exact original terminal connectors", (): void => {
  const original = krtTestBoard()
  original.connections[0].pointsToConnect.pop()
  original.connections[0].pointsToConnect[0].x = 0.03
  original.connections[0].pointsToConnect[1].x = 2.02
  const { branches } = prepareKrtBranches(original)
  const proposed = [
    {
      type: "pcb_trace",
      pcb_trace_id: "proposed",
      connection_name: branches[0].name,
      route: [
        { route_type: "wire", x: 0, y: 0, layer: "top", width: 0.1 },
        { route_type: "wire", x: 2, y: 0, layer: "top", width: 0.1 },
      ],
    },
  ]
  const traces = acceptKrtBranches({
    original,
    branches,
    proposed,
    gridStep: 0.25,
  })
  expect(traces[0].route.map((point) => ("x" in point ? point.x : 0))).toEqual([
    0.03, 0, 2, 2.02,
  ])
  expect(traces[0].route[0]).toMatchObject({ start_pcb_port_id: "a" })
  expect(traces[0].route.at(-1)).toMatchObject({ end_pcb_port_id: "b" })
})
