import { expect, test } from "bun:test"
import { CompactA01Frontier } from "lib/solvers/HyperHighDensitySolver/CompactA01Frontier"
import { HighDensitySolverA01Compact } from "lib/solvers/HyperHighDensitySolver/HighDensitySolverA01Compact"

test("compact masks enforce actual interned owners and reject cached masks outside that exact range", () => {
  const frontier = new CompactA01Frontier(4_000_000, true, 12)
  for (const compactMask of [4096, 2 ** 31, -1, 0.5, NaN, Infinity]) {
    expect(() => frontier.enqueue(0, 1, 1, -1, { id: 0, prev: null, compactMask })).toThrow("cached victim mask")
  }
  expect(() => frontier.enqueue(0, 1, 1, -1, { id: 12, prev: null })).toThrow("victim ID")
  expect(() => frontier.enqueue(0, 1, 1, -1, { id: 1, prev: { id: 0, prev: null, compactMask: 4096 } })).toThrow("cached victim mask")
  const solver = new HighDensitySolverA01Compact({
    nodeWithPortPoints: {
      capacityMeshNodeId: "actual-owners", center: { x: 0, y: 0 }, width: 2, height: 2, availableZ: [0, 1],
      portPoints: [
        { x: -1, y: 0, z: 0, connectionName: "routed" },
        { x: 1, y: 0, z: 1, connectionName: "routed" },
        { x: -1, y: 0.5, z: 0, connectionName: "single-a" },
        { x: 1, y: 0.5, z: 1, connectionName: "single-b" },
      ],
    }, cellSizeMm: 0.1, viaDiameter: 0.3,
  })
  solver.setup()
  // Preflight counted three names; A01 only interns the one actual route task.
  expect(solver.compactFrontier!.connectionCount).toBe(1)
  expect(() => solver.compactFrontier!.enqueue(0, 1, 1, -1, { id: 1, prev: null })).toThrow("victim ID")
  expect(() => solver.compactFrontier!.enqueue(0, 1, 1, -1, { id: 0, prev: null, compactMask: 2 })).toThrow("cached victim mask")
})
