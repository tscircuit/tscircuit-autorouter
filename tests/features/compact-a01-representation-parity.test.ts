import { expect, test } from "bun:test"
import { HighDensitySolverA01 } from "@tscircuit/high-density-a01"
import { HighDensitySolverA01Compact, type HighDensitySolverA01CompactProps } from "lib/solvers/HyperHighDensitySolver/HighDensitySolverA01Compact"

test("compact A01 storage alone preserves route, tie ordering, iterations and work classification", () => {
  const cases: HighDensitySolverA01CompactProps[] = [
    {
      nodeWithPortPoints: {
        capacityMeshNodeId: "compact-crossing",
        center: { x: 0, y: 0 }, width: 3, height: 3, availableZ: [0, 3],
        portPoints: [
          { x: -1.5, y: -0.6, z: 0, connectionName: "a" },
          { x: 1.5, y: 0.6, z: 0, connectionName: "a" },
          { x: -0.6, y: 1.5, z: 3, connectionName: "b" },
          { x: 0.6, y: -1.5, z: 0, connectionName: "b" },
        ],
      },
      cellSizeMm: 0.1, viaDiameter: 0.3, traceThickness: 0.15,
      traceMargin: 0.1, viaMinDistFromBorder: 0.15,
    },
    {
      nodeWithPortPoints: {
        capacityMeshNodeId: "compact-same-root",
        center: { x: 0.4, y: -0.1 }, width: 2, height: 2, availableZ: [0, 1],
        portPoints: [
          { x: -0.6, y: -0.3, z: 0, connectionName: "net_mst0", rootConnectionName: "net" },
          { x: 1.4, y: 0.1, z: 0, connectionName: "net_mst0", rootConnectionName: "net" },
          { x: -0.6, y: -0.3, z: 0, connectionName: "net_mst1", rootConnectionName: "net" },
          { x: 1.4, y: 0.1, z: 0, connectionName: "net_mst1", rootConnectionName: "net" },
          { x: 0.4, y: -1.1, z: 0, connectionName: "other" },
          { x: 0.4, y: 0.9, z: 1, connectionName: "other" },
        ],
      },
      cellSizeMm: 0.1, viaDiameter: 0.3, traceThickness: 0.15,
      traceMargin: 0.1, viaMinDistFromBorder: 0.15,
    },
  ]
  for (const scene of cases) {
    for (const seed of [0, 1, 5]) {
      const props = { ...scene, hyperParameters: { shuffleSeed: seed } }
      const baseline = new HighDensitySolverA01(props)
      const compact = new HighDensitySolverA01Compact({ ...props, compactFrontierPruning: false })
      baseline.setup()
      compact.setup()
      expect(compact).toBeInstanceOf(HighDensitySolverA01)
      expect(compact.MAX_ITERATIONS).toBe(baseline.MAX_ITERATIONS)
      baseline.MAX_ITERATIONS = 100_000
      compact.MAX_ITERATIONS = 100_000
      baseline.solve()
      compact.solve()
      expect(compact.solved).toBe(baseline.solved)
      expect(compact.failed).toBe(baseline.failed)
      expect(compact.error).toBe(baseline.error)
      expect(compact.iterations).toBe(baseline.iterations)
      expect(compact.getOutput()).toEqual(baseline.getOutput())
      expect(compact.compactFrontier!.metrics.prunedEquivalent).toBe(0)
      expect(compact.compactFrontier!.metrics.enqueued).toBeGreaterThan(0)
    }
  }
})
