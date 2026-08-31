import { expect, test } from "bun:test"
import { findRouteGeometryViolations } from "@tscircuit/high-density-a01"
import { HighDensitySolverA11 } from "lib/solvers/HighDensitySolver/official-high-density-a11-a12"
import { GrowShrinkHighDensityIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import sample002Cmn279 from "../fixtures/srj18-sample002-cmn279.json"

test("A11 solves SRJ18 sample002 cmn_279 without growth", () => {
  const solver = new GrowShrinkHighDensityIntraNodeSolver({
    nodeWithPortPoints: sample002Cmn279 as NodeWithPortPoints,
    viaDiameter: 0.3,
    traceWidth: 0.1,
    obstacleMargin: 0.15,
    obstacles: [],
    layerCount: 2,
    effort: 1,
    prioritizeNextGenerationSolvers: true,
    maxGrowthAttempts: 3,
    fallbackToInvalidGeometryOnFailure: false,
  })

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.growthAttempts).toBe(0)
  expect(solver.scaleFactor).toBe(1)
  expect(solver.solvedRoutes).toHaveLength(4)

  const winningSolver = solver.winningSolver!.winningSolver!
  expect(winningSolver.getSolverName()).toBe("HighDensitySolverA11")
  expect(winningSolver).toBeInstanceOf(HighDensitySolverA11)
  if (!(winningSolver instanceof HighDensitySolverA11)) {
    throw new Error("Expected the A11 candidate to win")
  }
  expect((winningSolver as any).cellSizeMm).toBe(0.05)
  expect((winningSolver as any).traceMargin).toBe(0.1)
  expect(findRouteGeometryViolations(solver.solvedRoutes)).toHaveLength(0)
})
