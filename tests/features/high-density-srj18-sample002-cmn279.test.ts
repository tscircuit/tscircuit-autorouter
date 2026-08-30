import { expect, test } from "bun:test"
import { findRouteGeometryViolations } from "@tscircuit/high-density-a01"
import { HighDensitySolverA01FineGrid } from "lib/solvers/HighDensitySolver/high-density-solver-a01-fine-grid"
import { GrowShrinkHighDensityIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import sample002Cmn279 from "../fixtures/srj18-sample002-cmn279.json"

test("the fine-grid A01 candidate solves SRJ18 sample002 cmn_279 without growth", () => {
  expect(
    HighDensitySolverA01FineGrid.isApplicable({
      ...(sample002Cmn279 as NodeWithPortPoints),
      availableZ: [0],
    }),
  ).toBe(false)

  const solver = new GrowShrinkHighDensityIntraNodeSolver({
    nodeWithPortPoints: sample002Cmn279 as NodeWithPortPoints,
    viaDiameter: 0.3,
    traceWidth: 0.1,
    obstacleMargin: 0.15,
    obstacles: [],
    layerCount: 2,
    effort: 1,
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
  expect(winningSolver.getSolverName()).toBe("HighDensitySolverA01FineGrid")
  expect(winningSolver).toBeInstanceOf(HighDensitySolverA01FineGrid)
  if (!(winningSolver instanceof HighDensitySolverA01FineGrid)) {
    throw new Error("Expected the fine-grid A01 candidate to win")
  }
  expect(winningSolver.cellSizeMm).toBe(0.05)
  expect(winningSolver.traceMargin).toBe(0.15)
  expect(findRouteGeometryViolations(solver.solvedRoutes)).toHaveLength(0)
})
