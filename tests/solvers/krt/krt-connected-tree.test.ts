import { expect, test } from "bun:test"
import { acceptKrtBranches } from "lib/testing/acceptKrtBranches"
import { prepareKrtBranches } from "lib/testing/prepareKrtBranches"
import { krtTestBoard } from "./krtTestBoard"

test("direct KRT preserves all terminal and root references in a connected tree", (): void => {
  const original = krtTestBoard()
  const { branches } = prepareKrtBranches(original)
  const proposed = branches.map((branch) => ({
    type: "pcb_trace",
    pcb_trace_id: branch.name,
    connection_name: branch.name,
    route: branch.points.map((point) => ({
      route_type: "wire",
      x: point.x,
      y: point.y,
      width: 0.1,
      layer: "top",
    })),
  }))
  const accepted = acceptKrtBranches({
    original,
    branches,
    proposed,
    gridStep: 0.1,
  })
  expect(accepted).toHaveLength(2)
  expect(accepted.every((trace) => trace.connection_name === "tree")).toBe(true)
  expect(
    accepted.every((trace) => trace.connectsTo?.includes("original_net")),
  ).toBe(true)
  const referenced = new Set(accepted.flatMap((trace) => trace.connectsTo))
  expect(["a", "b", "c"].every((id) => referenced.has(id))).toBe(true)
  expect(
    accepted.every(
      (trace) =>
        trace.route[0].route_type === "wire" &&
        trace.route[0].start_pcb_port_id,
    ),
  ).toBe(true)
})
