import { expect, test } from "bun:test"
import { GrowShrinkHighDensityIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import { makeNode } from "./test-helpers"

/**
 * A node with four mutually crossing connections in a small area, so the inner
 * portfolio is still running after one step and its budget can be inspected.
 */
const makeBusyNode = (): NodeWithPortPoints => ({
  capacityMeshNodeId: "cn_busy",
  center: { x: 0, y: 0 },
  width: 1,
  height: 1,
  availableZ: [0, 1],
  portPoints: [
    { connectionName: "a", x: -0.5, y: -0.3, z: 0 },
    { connectionName: "a", x: 0.5, y: 0.3, z: 0 },
    { connectionName: "b", x: -0.5, y: 0.3, z: 0 },
    { connectionName: "b", x: 0.5, y: -0.3, z: 0 },
    { connectionName: "c", x: -0.3, y: -0.5, z: 0 },
    { connectionName: "c", x: 0.3, y: 0.5, z: 0 },
    { connectionName: "d", x: 0.3, y: -0.5, z: 0 },
    { connectionName: "d", x: -0.3, y: 0.5, z: 0 },
  ],
})

/**
 * `maxInnerIterationsPerGrowthAttempt` bounds how long a single growth attempt
 * searches before the node is grown and retried. It was silently ineffective:
 * GrowShrink assigned `activeSubSolver.MAX_ITERATIONS`, then the portfolio's
 * `refreshDynamicIterationLimit()` recomputed that value from the remaining
 * candidate budgets on its first step and discarded the cap (observed: a cap of
 * 25 became 45128).
 */
test("maxInnerIterationsPerGrowthAttempt caps the inner solver's budget", () => {
  const maxInnerIterationsPerGrowthAttempt = 25

  const solver = new GrowShrinkHighDensityIntraNodeSolver({
    nodeWithPortPoints: makeBusyNode(),
    maxInnerIterationsPerGrowthAttempt,
    maxGrowthAttempts: 3,
  })

  solver.step()

  expect(solver.activeSubSolver).toBeTruthy()
  expect(solver.activeSubSolver!.MAX_ITERATIONS).toBeLessThanOrEqual(
    maxInnerIterationsPerGrowthAttempt,
  )
})

test("an external iteration ceiling survives the portfolio's dynamic limit", () => {
  const solver = new PortfolioSingleIntraNodeSolver({
    nodeWithPortPoints: makeNode(),
  })
  solver.externalMaxIterations = 25

  solver.step()

  expect(solver.MAX_ITERATIONS).toBeLessThanOrEqual(25)
})
