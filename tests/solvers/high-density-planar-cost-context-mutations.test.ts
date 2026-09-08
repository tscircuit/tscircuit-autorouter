import { expect, test } from "bun:test"
import type { Node } from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost as Solver } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"
import { createSolver, parent } from "./fixtures/planarCostContextSolver"

const mutations: Array<(solver: Solver) => void> = [
  solver => { solver.B.x = 0.1 },
  solver => { solver.B.y = 1 },
  solver => { solver.B.z = 0 },
  solver => { solver.viaDiameter *= 2 },
  solver => { solver.FUTURE_CONNECTION_PROXIMITY_VD *= 2 },
  solver => { solver.FUTURE_CONNECTION_PROX_TRACE_PENALTY_FACTOR *= 2 },
  solver => { solver.FUTURE_CONNECTION_PROX_VIA_PENALTY_FACTOR *= 2 },
  solver => { solver.straightLineDistance *= 2 },
  solver => { solver.VIA_PENALTY_FACTOR = 0 },
  solver => { solver.cellStep *= 1.2 },
  solver => { solver.MISALIGNED_DIST_PENALTY_FACTOR *= 2 },
  solver => { solver.FLIP_TRACE_ALIGNMENT_DIRECTION = true },
  solver => { solver.futureConnectionPoints = [{ x: 0.01, y: 0.1, z: 0 }] },
  solver => { solver.FUTURE_CONNECTION_PROXIMITY_VD = -0 },
  solver => { solver.FUTURE_CONNECTION_PROXIMITY_VD = +0 },
  solver => { solver.FUTURE_CONNECTION_PROX_TRACE_PENALTY_FACTOR = NaN },
  solver => { solver.FUTURE_CONNECTION_PROX_VIA_PENALTY_FACTOR = Infinity },
]

test("cost contexts observe between-expansion changes and preserve every direct planar and via calculation", () => {
  for (const mutate of mutations) {
    const candidate = createSolver(true)
    const reference = createSolver(false)
    expect(candidate.getNeighbors(parent)).toEqual(reference.getNeighbors(parent))
    mutate(candidate)
    mutate(reference)
    candidate.exploredNodes.clear()
    reference.exploredNodes.clear()
    expect(candidate.getNeighbors(parent)).toEqual(reference.getNeighbors(parent))
    for (const parentZ of [0, 1]) {
      const node: Node = { ...parent, parent: { ...parent, x: -0.1, z: parentZ } }
      const expectedG = candidate.computeG(node)
      const expectedH = candidate.computeH(node)
      candidate.setNodeCosts(node)
      expect([node.g, node.h, node.f]).toEqual([expectedG, expectedH, candidate.computeF(expectedG, expectedH)])
    }
  }

  // Fault injection happens after the first planar validation, inside the cost
  // lookup. No expansion state may leak into a later direct call or retry.
  const candidate = createSolver(true)
  const reference = createSolver(false)
  for (const solver of [candidate, reference]) {
    solver.getNeighbors(parent)
    const internals = solver as unknown as { denseNodeCostTerms: null; nodeCostTermsByGridKey: Map<number, unknown> }
    internals.denseNodeCostTerms = null
    const map = internals.nodeCostTermsByGridKey
    const originalGet = map.get
    map.get = (): never => { throw new Error("injected cost lookup failure") }
    let error: Error | undefined
    try { solver.getNeighbors(parent) } catch (caught) { error = caught as Error }
    expect(error?.message).toBe("injected cost lookup failure")
    if (solver === candidate) expect(error?.stack).toContain("setPlanarNodeCosts")
    map.get = originalGet
    solver.B.x = 0.2
    const direct = { ...parent, parent: { ...parent, x: -0.1 } }
    const expectedG = solver.computeG(direct)
    const expectedH = solver.computeH(direct)
    solver.setNodeCosts(direct)
    expect([direct.g, direct.h]).toEqual([expectedG, expectedH])
  }
  expect(candidate.getNeighbors(parent)).toEqual(reference.getNeighbors(parent))
})
