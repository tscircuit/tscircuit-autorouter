import { HighDensitySolverA01 } from "@tscircuit/high-density-a01"
import { expect, test } from "bun:test"
import { HighDensitySolverA01Compact } from "lib/solvers/HyperHighDensitySolver/HighDensitySolverA01Compact"

test("new large-grid storage preserves original routes and work beyond the earlier21-bit cell bound", () => {
  const props = {
    nodeWithPortPoints: {
      capacityMeshNodeId: "large-grid-parity", center: { x: 0, y: 0 }, width: 51.2, height: 51.4,
      availableZ: [0, 1, 2, 3, 4, 5, 6, 7],
      portPoints: [
        { connectionName: "net", x: -1, y: 25.7, z: 7 },
        { connectionName: "net", x: 1, y: 25.7, z: 7 },
      ],
    },
    cellSizeMm: 0.1, viaDiameter: 0.3, traceThickness: 0.1, traceMargin: 0.1,
  }
  const original = new HighDensitySolverA01(props)
  const compact = new HighDensitySolverA01Compact({ ...props, compactFrontierPruning: false })
  original.setup()
  compact.setup()
  expect(compact.gridStats.states).toBeGreaterThan(2 ** 21)
  expect(compact.MAX_ITERATIONS).toBe(original.MAX_ITERATIONS)
  original.solve()
  compact.solve()
  expect(original.solved).toBe(true)
  expect(compact.solved).toBe(true)
  expect(compact.failed).toBe(false)
  expect(compact.iterations).toBe(original.iterations)
  expect(compact.getOutput()).toEqual(original.getOutput())
  const observed = compact as unknown as { visitedStamp: Uint32Array; stamp: number }
  expect(observed.visitedStamp.subarray(2 ** 21).some((stamp) => stamp === observed.stamp)).toBe(true)
  expect(compact.compactFrontier!.metrics.prunedEquivalent).toBe(0)
})
