import { expect, test } from "bun:test"
import type { Node } from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import { withDetailedWork, Native, options, resetGrid, UniformLazy } from "./lazyPhysicalTestUtils"

test("deferred rejection consumes native step allowance and the preexisting key-zero policy is preserved", () => withDetailedWork(() => {
  class Ordered extends UniformLazy {
    override setNodeCosts(n: Node): void {
      super.setNodeCosts(n)
      if (n.x === 2 && n.y === 1) n.f = -100
    }
  }
  const solver = new Ordered(options({ obstacleRoutes: [{ connectionName: "wall", traceThickness: 0.08,
    viaDiameter: 0.3, vias: [], route: [{ x: 1.5, y: 0.8, z: 0 }, { x: 1.5, y: 1.2, z: 0 }] }] }))
  resetGrid(solver)
  solver.MAX_ITERATIONS = 1
  solver.step()
  solver.step()
  expect(solver.iterations).toBe(2)
  expect(solver.failed).toBe(true)
  expect(solver.solved).toBe(false)
  expect(solver.lazyPhysicalDiagnostics.lazyRejectedPlanar).toBe(1)
  expect(solver.lazyPhysicalDiagnostics.lazyExpanded).toBe(1)
  expect(solver.error).toContain("MAX_ITERATIONS=1")
  for (const Solver of [Native, UniformLazy]) {
    const zero = new Solver(options())
    resetGrid(zero)
    zero.gridMinXIndex = 1
    zero.gridMinYIndex = 1
    expect(zero.getNodeKey(zero.candidates.peek()!)).toBe(0)
    zero.step()
    expect(zero.failed).toBe(true)
    expect(zero.error).toBe("Ran out of candidate nodes to explore")
  }
}))
