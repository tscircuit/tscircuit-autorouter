import { expect, test } from "bun:test"
import { PhysicalNetForestSolver } from "lib/solvers/PhysicalNetForestSolver/PhysicalNetForestSolver"
import { NetToPointPairsSolver } from "lib/solvers/NetToPointPairsSolver/NetToPointPairsSolver"
import { getInitiallyConnectedMapFromSimpleRouteJson } from "lib/utils/get-initially-connected-map-from-simple-route-json"
import type { SimpleRouteJson } from "lib/types"

test("physical forest attaches once to the interior of committed copper and removes redundant pair demands", () => {
  const input: SimpleRouteJson = {
    layerCount: 2, minTraceWidth: 0.15,
    bounds: { minX: -6, maxX: 6, minY: -6, maxY: 6 }, obstacles: [],
    connections: [{ name: "tree", pointsToConnect: [
      { x: 0, y: 0, layer: "top", pointId: "a" },
      { x: 2, y: 0, layer: "top", pointId: "b" },
      { x: 1, y: 3, layer: "top", pointId: "c" },
    ] }],
  }
  const original = structuredClone(input)
  const solver = new PhysicalNetForestSolver(input)
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.branches).toHaveLength(2)
  expect(solver.branches[1]!.route).toHaveLength(2)
  expect(solver.branches[1]!.route[1]).toMatchObject({ x: 1, y: 0, layer: "top" })
  expect(solver.branches[1]!.connectsTo).toEqual(["c", solver.branches[0]!.pcb_trace_id])
  expect(solver.diagnostics.interiorAttachments).toBe(1)
  expect(solver.diagnostics.copperLength).toBe(5)
  expect(solver.diagnostics.visibleTerminalGraphLength).toBeGreaterThan(5)
  const output = solver.getOutputSimpleRouteJson()
  const pairs = new NetToPointPairsSolver(output, {}, getInitiallyConnectedMapFromSimpleRouteJson(output))
  pairs.solve()
  expect(pairs.newConnections).toEqual([])
  expect(input).toEqual(original)
})
