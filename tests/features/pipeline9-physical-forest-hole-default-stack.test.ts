import { expect, test } from "bun:test"
import { PhysicalNetForestSolver } from "lib/solvers/PhysicalNetForestSolver/PhysicalNetForestSolver"
import type { SimpleRouteJson } from "lib/types"

test("forest construction preserves the physical hole rule on every board layer", () => {
  for (const layer of ["top", "inner1"]) {
    const input: SimpleRouteJson = {
      layerCount: 4, minTraceWidth: 0.1, defaultObstacleMargin: 0.15,
      bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
      connections: [{ name: "signal", pointsToConnect: [
        { x: 0.425, y: 0, layer, pointId: "a" },
        { x: 2, y: 0, layer, pointId: "b" },
        { x: 2, y: 2, layer, pointId: "c" },
      ] }],
      obstacles: [{ type: "rect", center: { x: 0, y: 0 }, width: 0.4, height: 0.4,
        layers: ["top", "bottom"], connectedTo: ["signal"], isNonPlatedHole: true }],
    }
    // The terminal's copper edge is 0.175mm from this through hole.
    const blocked = new PhysicalNetForestSolver(input)
    blocked.solve()
    expect(blocked.branches).toEqual([])
    expect(blocked.diagnostics.rejectedVisibility).toBe(1)
    const declared = new PhysicalNetForestSolver({ ...input, minTraceToHoleEdgeClearance: 0.15 })
    declared.solve()
    expect(declared.branches).toHaveLength(2)
  }
})
