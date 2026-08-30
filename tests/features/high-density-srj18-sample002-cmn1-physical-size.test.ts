import { expect, test } from "bun:test"
import { GrowShrinkHighDensityIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import sample002LargeNode from "../fixtures/srj18-sample002-large-node.json"

test("the SRJ18 sample002 cmn1 node solves at its physical size", () => {
  const solver = new GrowShrinkHighDensityIntraNodeSolver({
    nodeWithPortPoints: sample002LargeNode as NodeWithPortPoints,
    viaDiameter: 0.3,
    traceWidth: 0.1,
    obstacleMargin: 0.15,
    obstacles: [],
    layerCount: 2,
    effort: 1,
    maxGrowthAttempts: 3,
    fallbackToInvalidGeometryOnFailure: false,
    prioritizeNextGenerationSolvers: true,
  })

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.growthAttempts).toBe(0)
  expect(solver.scaleFactor).toBe(1)
  expect(solver.winningSolver!.winningSolver!.getSolverName()).toBe(
    "HighDensitySolverA08",
  )
  expect(solver.stats.invalidGeometryFallback).not.toBe(true)
  expect(solver.winningSolver!.iterations).toBeLessThanOrEqual(
    solver.winningSolver!.MAX_ITERATIONS,
  )
  expect(solver.solvedRoutes).toHaveLength(19)
})
