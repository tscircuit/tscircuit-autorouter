import { expect, test } from "bun:test"
import type { Node } from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import { SingleHighDensityRouteSolver as Base } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver"
import { createSolver, parent } from "./fixtures/planarCostContextSolver"

class CustomPlanarCostSolver extends Base {
  calls = 0
  protected override planarCostMethod = this.setPlanarNodeCosts
  protected override setPlanarNodeCosts(node: Node, key: number, validate: boolean): void {
    this.calls++
    this.traceThickness = 0.8
    super.setPlanarNodeCosts(node, key, validate)
  }
}

test("custom internal cost hooks cannot bypass the ordinary per-call mutation behavior", () => {
  const options = {
    connectionName: "route", A: { x: -2, y: 0, z: 0 }, B: { x: 2, y: 0, z: 1 },
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 }, minDistBetweenEnteringPoints: 0.15,
    traceThickness: 0.05, obstacleMargin: 0.05, obstacleRoutes: [],
  }
  const baseCandidate = new CustomPlanarCostSolver({ ...options, fixedObstacleGeometry: true })
  const baseReference = new CustomPlanarCostSolver({ ...options, fixedObstacleGeometry: false })
  expect(baseCandidate.getNeighbors(parent)).toEqual(baseReference.getNeighbors(parent))
  expect(baseCandidate.calls).toBe(0)
  expect((baseCandidate as unknown as { planarFreeCache: unknown }).planarFreeCache).toBeUndefined()

  for (const method of ["setPlanarNodeCosts", "setNodeCostsCore", "invalidateChangedNodeCostParameters", "initializeDenseNodeCostTerms"] as const) {
    const candidate = createSolver(true)
    const reference = createSolver(false)
    const calls = [0, 0]
    for (const [index, solver] of [candidate, reference].entries()) {
      const target = solver as unknown as Record<string, (...args: unknown[]) => unknown>
      const original = target[method]!
      target[method] = function (...args: unknown[]): unknown {
        calls[index]++
        const result = original.apply(solver, args)
        solver.B.x = 0.2
        return result
      }
    }
    expect(candidate.getNeighbors(parent)).toEqual(reference.getNeighbors(parent))
    expect(candidate.getNeighbors(parent)).toEqual(reference.getNeighbors(parent))
    expect(calls[0]).toBe(calls[1])
    if (method === "setPlanarNodeCosts") expect(calls[0]).toBe(0)
    else expect(calls[0]).toBeGreaterThan(0)
    expect((candidate as unknown as { planarFreeCache: unknown }).planarFreeCache).toBeUndefined()
  }
})
