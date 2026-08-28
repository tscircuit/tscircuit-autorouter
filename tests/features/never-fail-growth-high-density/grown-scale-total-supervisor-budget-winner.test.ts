import { expect, test } from "bun:test"
import { GrowShrinkHighDensityIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import { makeNode, makeStraightRoute } from "./test-helpers"

test("GrowShrink preserves an 8x winner below the total grown-scale budget", () => {
  const solveEightScaleWinner = (
    maxTotalGrownScaleSupervisorIterations?: number,
  ) => {
    const solver = new GrowShrinkHighDensityIntraNodeSolver({
      nodeWithPortPoints: makeNode(),
      maxTotalGrownScaleSupervisorIterations,
      tryLargestScaleAsRepairSeedAfterInitialFailure: true,
    })
    solver.activeSubSolver = {
      iterations: 1,
      failed: false,
      solved: false,
      error: null,
      solvedRoutes: [],
      step() {
        this.failed = true
        this.error = "forced initial failure"
      },
    } as any
    solver.step()
    ;(solver as any).createActiveSubSolver()

    const portfolio = solver.activeSubSolver!
    const [scaledStart, scaledEnd] = portfolio.nodeWithPortPoints.portPoints
    const scaledRoute: HighDensityIntraNodeRoute = {
      ...makeStraightRoute(),
      route: [
        { x: scaledStart!.x, y: scaledStart!.y, z: scaledStart!.z },
        { x: scaledEnd!.x, y: scaledEnd!.y, z: scaledEnd!.z },
      ],
    }
    const winner = {
      iterations: 0,
      MAX_ITERATIONS: 30_000,
      progress: 0,
      solved: false,
      failed: false,
      error: null,
      hyperParameters: {},
      solvedRoutes: [scaledRoute],
      step() {
        this.iterations++
        if (this.iterations === 24_999) this.solved = true
      },
    }
    portfolio.MIN_SUBSTEPS = 1
    portfolio.adaptiveSearchExpanded = true
    portfolio.supervisedSolvers = [
      {
        solver: winner,
        hyperParameters: {},
        g: 0,
        h: 1,
        f: 0,
      },
    ] as any
    ;(portfolio as any).refreshDynamicIterationLimit()

    while (!solver.solved && !solver.failed) solver.step()
    return { solver, portfolio, winner }
  }

  const uncapped = solveEightScaleWinner()
  const budgeted = solveEightScaleWinner(25_000)

  expect(budgeted.portfolio.maxSupervisorIterations).toBe(25_000)
  expect(budgeted.winner.iterations).toBe(24_999)
  expect(budgeted.solver.solved).toBe(true)
  expect(budgeted.solver.failed).toBe(false)
  expect(budgeted.solver.growthAttempts).toBe(1)
  expect(budgeted.solver.scaleFactor).toBe(8)
  expect(budgeted.solver.solvedRoutes).toEqual([makeStraightRoute()])
  expect(budgeted.solver.solvedRoutes).toEqual(uncapped.solver.solvedRoutes)
  expect(budgeted.solver.stats.acceptedScaleFactor).toBe(8)
  expect(budgeted.solver.stats.postShrinkValidatorRan).toBe(false)
  expect(budgeted.solver.stats.unvalidatedPostShrinkRepairSeed).toBe(true)
  expect(budgeted.solver.stats.invalidGeometryFallback).not.toBe(true)
})
