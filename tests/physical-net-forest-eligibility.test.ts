import { expect, test } from "bun:test"
import { PhysicalNetForestSolver } from "lib/solvers/PhysicalNetForestSolver/PhysicalNetForestSolver"
import type { SimpleRouteJson } from "lib/types"

test("forest leaves obstructed, constrained, and layer-incompatible nets as unresolved native requirements", () => {
  const input: SimpleRouteJson = {
    layerCount: 2, minTraceWidth: 0.15,
    bounds: { minX: -6, maxX: 6, minY: -6, maxY: 6 },
    obstacles: [{ type: "rect", center: { x: 0, y: 0 }, width: 1, height: 11, layers: ["top", "bottom"], connectedTo: [] }],
    connections: [{ name: "tree", pointsToConnect: [
      { x: -3, y: 0, layer: "top", pointId: "a" },
      { x: 3, y: 0, layer: "top", pointId: "b" },
      { x: 3, y: 3, layer: "top", pointId: "c" },
    ] }],
  }
  const blocked = new PhysicalNetForestSolver(input)
  blocked.solve()
  expect(blocked.branches).toEqual([])
  expect(blocked.diagnostics.rejectedVisibility).toBe(1)
  const constrained = new PhysicalNetForestSolver({ ...input, obstacles: [], buses: [{ busId: "bus", connectionNames: ["tree"], allowedLayers: ["bottom"] }] })
  constrained.solve()
  expect(constrained.branches).toEqual([])
  expect(constrained.diagnostics.rejectedConstraints).toBe(1)
  const layers = structuredClone(input)
  layers.obstacles = []
  layers.connections[0]!.pointsToConnect[1] = { x: 3, y: 0, layer: "bottom", pointId: "b" }
  const incompatible = new PhysicalNetForestSolver(layers)
  incompatible.solve()
  expect(incompatible.branches).toEqual([])
  expect(incompatible.getOutputSimpleRouteJson().connections).toEqual(layers.connections)
  const disabled = new PhysicalNetForestSolver(input, false)
  disabled.solve()
  expect(disabled.diagnostics.consideredNets).toBe(0)
})
