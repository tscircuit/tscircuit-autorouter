import { expect, test } from "bun:test"
import { getFixedObstacleViolations, RelaxTraceClearanceSolver } from "@tscircuit/repair04"
import { SharedElectricalTreeClearanceSolver } from "lib/solvers/SharedElectricalTreeClearanceSolver/SharedElectricalTreeClearanceSolver"
import { assertSharedElectricalTreeRoutes } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/assertSharedElectricalTreeRoutes"
import { sharedElectricalTreeClearanceFixture } from "../fixtures/sharedElectricalTreeClearanceFixture"

test("unique physical constraints move a coupled junction while retaining every pad, via and decoder obligation", (): void => {
  const { srj, routes, connections, adapter } = sharedElectricalTreeClearanceFixture()
  const before = structuredClone(adapter.routes)
  const input = { srj: { ...srj, traces: undefined }, routes: adapter.routes, bounds: srj.bounds, boundaryMargin: 0,
    lockedPointIndices: adapter.lockedPointIndices, traceClearance: 0.1, viaClearance: 0.1, allowViaMovement: true }
  const native = new RelaxTraceClearanceSolver(input)
  native.step()
  const solver = new SharedElectricalTreeClearanceSolver({ ...input, segmentIdentityByRoute: adapter.segmentIdentityByRoute })
  solver.solve()
  const stepped = new SharedElectricalTreeClearanceSolver({ ...input, segmentIdentityByRoute: adapter.segmentIdentityByRoute })
  while (!stepped.solved && !stepped.failed) stepped.step()
  expect(stepped.getOutput()).toEqual(solver.getOutput())
  expect(stepped.stats).toEqual(solver.stats)
  expect(stepped.iterations).toBe(solver.iterations)
  expect(stepped.MAX_ITERATIONS).toBe(solver.MAX_ITERATIONS)
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.stats.treePrimitiveRawActiveReferences).toBe(15)
  expect(solver.stats.treePrimitivePhysicalVariants).toBe(5)
  expect(solver.stats.treePrimitiveMergedSourceReferences).toBe(5)
  expect(solver.stats.treePrimitiveManufacturedSeamReferences).toBe(5)
  expect(solver.stats.treePrimitiveCoveredSeams).toBe(5)
  expect(solver.stats.treePrimitiveActiveCount).toBe(5)
  expect(solver.stats.treePrimitiveRawPairUpperBound).toBe(105)
  expect(solver.stats.treePrimitivePreparedPairVisits).toBe(10)
  expect(solver.stats.treePrimitiveObstacleVisits).toBe(5)
  expect(solver.stats.treePrimitiveSweeps).toBe(256)
  expect(solver.MAX_ITERATIONS).toBe(native.MAX_ITERATIONS)
  expect(solver.iterations).toBeLessThanOrEqual(solver.MAX_ITERATIONS)
  const output = adapter.decode(solver.getOutput())
  assertSharedElectricalTreeRoutes({ connections, routes: output, layerCount: 2 })
  const junction = output[0]!.route.at(-1)!
  expect(junction.y).toBeGreaterThan(0.05)
  expect(output.map((route) => route.route.at(-1))).toEqual([junction, junction, junction])
  expect(output.map((route) => route.route[0])).toEqual(routes.map((route) => route.route[0]))
  expect(output.reduce((count, route) => count + route.vias.length, 0)).toBe(1)
  expect(getFixedObstacleViolations({ srj: { ...srj, traces: undefined }, routes: output, traceClearance: 0.1, viaClearance: 0.1 })).toHaveLength(0)
  expect(adapter.routes).toEqual(before)
  const inconsistent = structuredClone(solver.getOutput())
  inconsistent[0]!.route[1]!.x += 0.01
  expect(() => adapter.decode(inconsistent)).toThrow("shared occurrences inconsistently")
})
