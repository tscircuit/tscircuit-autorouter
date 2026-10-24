import { expect, test } from "bun:test"
import type { Node } from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import { withDetailedWork, options, resetGrid, UniformLazy } from "./lazyPhysicalTestUtils"

test("a blocked incoming segment cannot close a destination reached by a different certified parent", () => withDetailedWork(() => {
  class Ordered extends UniformLazy {
    override setNodeCosts(n: Node): void {
      super.setNodeCosts(n)
      n.f = n.x === 2 && n.y === 1 ? (n.parent!.x === 1 && n.parent!.y === 1 ? -100 : -40)
        : n.x === 2 && n.y === 2 ? -50 : 100 + n.g
    }
  }
  const solver = new Ordered(options({ obstacleRoutes: [{ connectionName: "wall", traceThickness: 0.08,
    viaDiameter: 0.3, vias: [], route: [{ x: 1.5, y: 0.8, z: 0 }, { x: 1.5, y: 1.2, z: 0 }] }] }))
  resetGrid(solver)
  const target = { x: 2, y: 1, z: 0, parent: null, g: 0, h: 0, f: 0 }
  solver.step()
  expect(solver.lazyPhysicalDiagnostics.lazyPointChecks).toBe(0)
  solver.step()
  expect(solver.lazyPhysicalDiagnostics.lazyRejectedPlanar).toBe(1)
  expect(solver.exploredNodes.has(solver.getNodeKey(target))).toBe(false)
  solver.step()
  expect(solver.exploredNodes.has(solver.getNodeKey(target))).toBe(false)
  solver.step()
  expect(solver.exploredNodes.has(solver.getNodeKey(target))).toBe(true)
  expect(solver.failed).toBe(false)
}))
