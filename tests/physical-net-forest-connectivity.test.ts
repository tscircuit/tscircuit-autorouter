import { expect, test } from "bun:test"
import { PhysicalNetForestSolver } from "lib/solvers/PhysicalNetForestSolver/PhysicalNetForestSolver"
import type { SimpleRouteJson } from "lib/types"

test("unchanged intended net labels and connectsTo IDs cannot certify spatially disconnected forest copper", () => {
  const input: SimpleRouteJson = {
    layerCount: 2, minTraceWidth: 0.15,
    bounds: { minX: -6, maxX: 6, minY: -6, maxY: 6 }, obstacles: [],
    connections: [{ name: "tree", pointsToConnect: [
      { x: 0, y: 0, layer: "top", pointId: "a" },
      { x: 2, y: 0, layer: "top", pointId: "b" },
      { x: 1, y: 3, layer: "top", pointId: "c" },
    ] }],
  }
  const solver = new PhysicalNetForestSolver(input)
  solver.solve()
  expect(() => solver.assertOutputPhysicalConnectivity(solver.branches)).not.toThrow()
  const broken = structuredClone(solver.branches)
  const end = broken[1]!.route[1]!
  if (end.route_type !== "wire") throw new Error("Fixture expects a wire")
  end.y += 0.5
  expect(broken[1]!.connectsTo).toEqual(solver.branches[1]!.connectsTo)
  expect(() => solver.assertOutputPhysicalConnectivity(broken)).toThrow("lost copper connectivity")
})
