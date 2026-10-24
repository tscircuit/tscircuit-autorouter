import { expect, test } from "bun:test"
import type { Node } from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import { options, resetGrid, UniformLazy } from "./lazyPhysicalTestUtils"

test("vias remain eager and reject a same-location second drill using the current certified parent chain", () => {
  class Ordered extends UniformLazy {
    history: Array<{ from: number; to: number; prior: number; blocked: boolean }> = []
    override setNodeCosts(n: Node): void {
      super.setNodeCosts(n)
      n.f = n.z === 1 ? -20 : n.z === 2 ? -10 : 100 + n.g
    }
    override isNodeTooCloseToObstacle(n: Node, margin?: number, via?: boolean,
      query?: Parameters<UniformLazy["isNodeTooCloseToObstacle"]>[3]): boolean {
      const blocked = super.isNodeTooCloseToObstacle(n, margin, via, query)
      if (via && n.parent && this.history) this.history.push({ from: n.parent.z, to: n.z,
        prior: this.getViasInNodePath(n.parent).length, blocked })
      return blocked
    }
  }
  const solver = new Ordered(options({ layerCount: 3, availableZ: [0, 1, 2], B: { x: 5, y: 5, z: 2 } }))
  resetGrid(solver)
  solver.step()
  expect(solver.history.filter((h) => h.from === 0 && h.prior === 0 && !h.blocked)).toHaveLength(2)
  solver.step()
  expect(solver.history).toContainEqual({ from: 1, to: 2, prior: 1, blocked: true })
  expect(solver.lazyPhysicalDiagnostics.lazyViaChecks).toBe(3)
  expect(solver.lazyPhysicalDiagnostics.lazyExpanded).toBe(2)
  expect(solver.lazyPhysicalDiagnostics.lazyValidatedPlanar).toBe(0)
})
