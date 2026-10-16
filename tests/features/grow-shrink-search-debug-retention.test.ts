import { expect, test } from "bun:test"
import { GrowShrinkHighDensityIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import nodeJson from "../fixtures/srj18-sample15-sub-via-node.json"

test("disabling search debug releases failed growth portfolios without changing routing", (): void => {
  for (const maxGrowthAttempts of [3, undefined]) {
    const params = {
      nodeWithPortPoints: structuredClone(nodeJson) as NodeWithPortPoints,
      viaDiameter: 0.3,
      traceWidth: 0.1,
      obstacleMargin: 0.15,
      effort: 1,
      layerCount: 4,
      fallbackToInvalidGeometryOnFailure: false,
      maxGrowthAttempts,
      cacheProvider: null,
    }
    const debugSolver = new GrowShrinkHighDensityIntraNodeSolver(params)
    const solver = new GrowShrinkHighDensityIntraNodeSolver({
      ...params,
      nodeWithPortPoints: structuredClone(params.nodeWithPortPoints),
      captureSearchDebug: false,
    })

    debugSolver.solve()
    solver.solve()

    expect(debugSolver.failedSolvers.length).toBeGreaterThan(0)
    expect(
      debugSolver.failedSolvers.every(
        (attempt) => attempt.failed && attempt.supervisedSolvers!.length > 0,
      ),
    ).toBe(true)
    expect(solver.failedSolvers).toEqual([])
    expect(solver.activeSubSolver).toBeNull()
    expect(solver.growthAttempts).toBeGreaterThan(0)
    expect(solver.solved).toBe(debugSolver.solved)
    expect(solver.failed).toBe(debugSolver.failed)
    expect(solver.solvedRoutes).toEqual(debugSolver.solvedRoutes)
    expect(solver.error).toBe(debugSolver.error)
    expect(solver.stats).toEqual(debugSolver.stats)
    expect(solver.growthAttempts).toBe(debugSolver.growthAttempts)
    expect(solver.scaleFactor).toBe(debugSolver.scaleFactor)
    expect(solver.iterations).toBe(debugSolver.iterations)
    expect(solver.progress).toBe(debugSolver.progress)
    expect(solver.winningSolver?.winningSolver?.getSolverName()).toBe(
      debugSolver.winningSolver?.winningSolver?.getSolverName(),
    )
    if (maxGrowthAttempts === 3) {
      expect(solver.failed).toBe(true)
      expect(solver.error).toContain("resizing to 8x")
    } else {
      expect(solver.solved).toBe(true)
      expect(solver.solvedRoutes).toHaveLength(3)
      expect(solver.scaleFactor).toBe(16)
    }
  }
})
