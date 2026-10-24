import { expect, test } from "bun:test"
import type { Node } from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import { withDetailedWork, options, resetGrid, UniformLazy } from "./lazyPhysicalTestUtils"

test("an unchecked near-goal candidate is rejected before closing, goal acceptance, or descendant generation", () => withDetailedWork(() => {
  class Ordered extends UniformLazy {
    override setNodeCosts(n: Node): void {
      super.setNodeCosts(n)
      if (n.x === 2 && n.y === 1) n.f = -100
    }
  }
  const solver = new Ordered(options({ B: { x: 3, y: 1, z: 0 }, obstacleRoutes: [{ connectionName: "wall",
    traceThickness: 0.08, viaDiameter: 0.3, vias: [],
    route: [{ x: 1.5, y: 0.8, z: 0 }, { x: 1.5, y: 1.2, z: 0 }] }] }))
  resetGrid(solver)
  solver.step()
  const proposals = solver.lazyPhysicalDiagnostics.lazyPlanarProposals
  solver.step()
  expect(solver.solved).toBe(false)
  expect(solver.lazyPhysicalDiagnostics.lazyRejectedPlanar).toBe(1)
  expect(solver.lazyPhysicalDiagnostics.lazyGoalChecks).toBe(0)
  expect(solver.lazyPhysicalDiagnostics.lazyExpanded).toBe(1)
  expect(solver.lazyPhysicalDiagnostics.lazyPlanarProposals).toBe(proposals)
  expect(solver.solvedPath).toBeNull()
}))
