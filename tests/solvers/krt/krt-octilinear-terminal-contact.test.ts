import { expect, test } from "bun:test"
import { acceptKrtBranches } from "lib/testing/acceptKrtBranches"
import { prepareKrtBranches } from "lib/testing/prepareKrtBranches"
import { runTraceLinting } from "lib/testing/runTraceLinting"
import { krtTestBoard } from "./krtTestBoard"

test("direct KRT joins exact off-grid terminals without odd angles", (): void => {
  const original = krtTestBoard()
  original.connections[0].pointsToConnect.pop()
  original.connections[0].pointsToConnect[0].x = 0.03
  original.connections[0].pointsToConnect[0].y = 0.02
  original.connections[0].pointsToConnect[1].x = 2.02
  original.connections[0].pointsToConnect[1].y = 0.03
  const before = structuredClone(original)
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
    gridStep: 0.1,
  })
  expect(traces[0].route[0]).toMatchObject({
    x: 0.03,
    y: 0.02,
    width: 0.1,
    layer: "top",
    start_pcb_port_id: "a",
  })
  expect(traces[0].route.at(-1)).toMatchObject({
    x: 2.02,
    y: 0.03,
    width: 0.1,
    layer: "top",
    end_pcb_port_id: "b",
  })
  expect(traces[0].route).toHaveLength(6)
  expect(runTraceLinting({ ...original, traces }).getOutput()).toEqual([])
  expect(original).toEqual(before)
})
