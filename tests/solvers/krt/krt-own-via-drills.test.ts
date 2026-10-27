import { expect, test } from "bun:test"
import { acceptKrtBranches } from "lib/testing/acceptKrtBranches"
import { prepareKrtBranches } from "lib/testing/prepareKrtBranches"
import { krtTestBoard } from "./krtTestBoard"

test("direct KRT rejects distinct overlapping drill holes inside its own path", (): void => {
  const original = krtTestBoard()
  original.connections[0].pointsToConnect.pop()
  const { branches } = prepareKrtBranches(original)
  const proposed = [
    {
      type: "pcb_trace",
      pcb_trace_id: "proposed",
      connection_name: branches[0].name,
      route: [
        { route_type: "wire", x: 0, y: 0, layer: "top", width: 0.1 },
        { route_type: "wire", x: 1, y: 0, layer: "top", width: 0.1 },
        {
          route_type: "via",
          x: 1,
          y: 0,
          from_layer: "top",
          to_layer: "bottom",
        },
        { route_type: "wire", x: 1, y: 0, layer: "bottom", width: 0.1 },
        { route_type: "wire", x: 1.1, y: 0, layer: "bottom", width: 0.1 },
        {
          route_type: "via",
          x: 1.1,
          y: 0,
          from_layer: "bottom",
          to_layer: "top",
        },
        { route_type: "wire", x: 1.1, y: 0, layer: "top", width: 0.1 },
        { route_type: "wire", x: 2, y: 0, layer: "top", width: 0.1 },
      ],
    },
  ]
  expect(() =>
    acceptKrtBranches({ original, branches, proposed, gridStep: 0.1 }),
  ).toThrow("drill clearance")
})
