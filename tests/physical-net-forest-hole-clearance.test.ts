import { expect, test } from "bun:test"
import { PhysicalNetForestSolver } from "lib/solvers/PhysicalNetForestSolver/PhysicalNetForestSolver"
import type { SimpleRouteJson } from "lib/types"

test("same-net labels cannot make non-plated holes traversable and declared width aliases are retained", () => {
  const input: SimpleRouteJson = {
    layerCount: 2, minTraceWidth: 0.15,
    bounds: { minX: -6, maxX: 6, minY: -6, maxY: 6 }, obstacles: [],
    connections: [{ name: "tree", width: 0.4, pointsToConnect: [
      { x: -3, y: 0, layer: "top", pointId: "a" },
      { x: 3, y: 0, layer: "top", pointId: "b" },
      { x: 0, y: 3, layer: "top", pointId: "c" },
    ] }],
  }
  const clear = new PhysicalNetForestSolver(input)
  clear.solve()
  expect(clear.branches).toHaveLength(2)
  expect(clear.branches.flatMap((trace) => trace.route).every((point) => point.route_type === "wire" && point.width === 0.4)).toBe(true)
  const blocked = new PhysicalNetForestSolver({ ...input, obstacles: [{ type: "rect", center: { x: 0, y: 0 }, width: 4, height: 4,
    layers: ["top", "bottom"], connectedTo: ["tree"], isNonPlatedHole: true }] })
  blocked.solve()
  expect(blocked.branches).toEqual([])
  expect(blocked.diagnostics.rejectedVisibility).toBe(1)
})
