import { expect, test } from "bun:test"
import { HighDensitySolver } from "lib/solvers/HighDensitySolver/HighDensitySolver"
import { GrowShrinkHighDensityIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver"
import { makeNode, makeStraightRoute } from "./test-helpers"

test("HighDensitySolver stats exposes highDensityResizeCount", () => {
  const growShrinkSolver = new GrowShrinkHighDensityIntraNodeSolver({
    nodeWithPortPoints: makeNode(),
  })
  growShrinkSolver.solved = true
  growShrinkSolver.solvedRoutes = [makeStraightRoute()]
  growShrinkSolver.growthAttempts = 2

  const highDensitySolver = new HighDensitySolver({
    nodePortPoints: [],
    useGrowShrinkHighDensityIntraNodeSolver: true,
  })
  highDensitySolver.activeSubSolver = growShrinkSolver

  highDensitySolver.step()

  expect(highDensitySolver.stats.highDensityResizeCount).toBe(2)
})
