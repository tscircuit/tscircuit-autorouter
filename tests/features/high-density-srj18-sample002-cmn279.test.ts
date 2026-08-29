import { expect, test } from "bun:test"
import { findRouteGeometryViolations } from "@tscircuit/high-density-a01"
import { HighDensitySolverA01FineGrid } from "lib/solvers/HighDensitySolver/high-density-solver-a01-fine-grid"
import { GrowShrinkHighDensityIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import cmn279 from "../fixtures/srj18-sample002-cmn279.json"

test("fine-grid A01 solves srj18 sample002 cmn_279 without growth", () => {
  const solver = new GrowShrinkHighDensityIntraNodeSolver({
    nodeWithPortPoints: cmn279 as NodeWithPortPoints,
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
  const winningSolver = solver.winningSolver!
    .winningSolver as HighDensitySolverA01FineGrid
  expect(winningSolver.getSolverName()).toBe(
    "HighDensitySolverA01FineGrid",
  )
  expect(winningSolver).toBeInstanceOf(HighDensitySolverA01FineGrid)
  expect(winningSolver.cellSizeMm).toBe(0.05)
  expect(winningSolver.traceMargin).toBe(0.15)
  expect(findRouteGeometryViolations(solver.solvedRoutes)).toEqual([])
})
