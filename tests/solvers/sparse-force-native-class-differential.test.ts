import { expect, test } from "bun:test"
import { HighDensityForceImproveSolver } from "high-density-repair01/lib/HighDensityForceImproveSolver"
import { SparseHighDensityForceImproveSolver } from "lib/solvers/SparseForceImproveSolver/SparseHighDensityForceImproveSolver"
import { createSparseForceDifferentialCases } from "tests/fixtures/createSparseForceDifferentialCases"

test("sparse native class retains outer projection, topology, metadata, stats and visualization", () => {
  for (const item of createSparseForceDifferentialCases()) {
    const input = {
      nodeWithPortPoints: [{ capacityMeshNodeId: "sample", center: { x: 5, y: 5 }, width: 10, height: 10, availableZ: [0, 1], portPoints: [] }],
      hdRoutes: item.routes,
      totalStepsPerNode: 12,
      colorMap: { a: "#ff4400", b: "#4488aa" },
    }
    const before = structuredClone(input)
    const native = new HighDensityForceImproveSolver(input)
    const sparse = new SparseHighDensityForceImproveSolver(input)
    native.solve()
    sparse.solve()
    expect(sparse.getOutput(), item.name).toEqual(native.getOutput())
    expect(sparse.latestVisualization, item.name).toEqual(native.latestVisualization)
    expect(sparse.visualize(), item.name).toEqual(native.visualize())
    expect(sparse.stats).toEqual(native.stats)
    expect(sparse.iterations).toBe(native.iterations)
    expect(sparse.solved).toBe(native.solved)
    expect(sparse.failed).toBe(native.failed)
    expect(sparse.getConstructorParams()).toEqual(native.getConstructorParams())
    expect(input).toEqual(before)
    expect(sparse.sparseForceStats.sampleNodes).toBe(1)
    expect(sparse.sparseForceStats.activated).toBe(true)
  }
})
