import { expect, test } from "bun:test"
import { acceptKrtBranches } from "lib/testing/acceptKrtBranches"
import { prepareKrtBranches } from "lib/testing/prepareKrtBranches"
import { krtTestBoard } from "./krtTestBoard"

test("direct KRT rejects a backend silently ignoring the width it was asked to route", (): void => {
  const original = krtTestBoard()
  original.connections[0].pointsToConnect.pop()
  original.connections[0].nominalTraceWidth = 0.2
  const { branches } = prepareKrtBranches(original)
  const proposed = [{
    type: "pcb_trace",
    pcb_trace_id: "proposed",
    connection_name: branches[0].name,
    route: [
      { route_type: "wire", x: 0, y: 0, layer: "top", width: 0.1 },
      { route_type: "wire", x: 2, y: 0, layer: "top", width: 0.1 },
    ],
  }]
  expect(() => acceptKrtBranches({ original, branches, proposed, gridStep: 0.25 })).toThrow("requested width")
})
