import { expect, test } from "bun:test"
import { GrowShrinkHighDensityIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver"
import { makeNode, makeStraightRoute } from "./test-helpers"

test("GrowShrink caps only the initial-scale portfolio supervisor", () => {
  const solver = new GrowShrinkHighDensityIntraNodeSolver({
    nodeWithPortPoints: makeNode(),
    maxInitialScaleSupervisorIterations: 2,
    tryLargestScaleAsRepairSeedAfterInitialFailure: true,
  })
  ;(solver as any).createActiveSubSolver()

  const initialPortfolio = solver.activeSubSolver!
  const neverSolves = {
    iterations: 0,
    MAX_ITERATIONS: 100,
    progress: 0,
    solved: false,
    failed: false,
    error: null,
    hyperParameters: {},
    step() {
      this.iterations++
    },
  }
  initialPortfolio.MIN_SUBSTEPS = 1
  initialPortfolio.adaptiveSearchExpanded = true
  initialPortfolio.supervisedSolvers = [
    {
      solver: neverSolves,
      hyperParameters: {},
      g: 0,
      h: 1,
      f: 0,
    },
  ] as any
  ;(initialPortfolio as any).refreshDynamicIterationLimit()

  expect(initialPortfolio.maxSupervisorIterations).toBe(2)
  expect(initialPortfolio.MAX_ITERATIONS).toBe(1)
  while (solver.scaleFactor === 1) solver.step()
  expect(initialPortfolio.failed).toBe(true)
  expect(initialPortfolio.iterations).toBe(2)
  expect(solver.scaleFactor).toBe(8)
  ;(solver as any).createActiveSubSolver()
  const enlargedPortfolio = solver.activeSubSolver!
  const [scaledStart, scaledEnd] =
    enlargedPortfolio.nodeWithPortPoints.portPoints
  const solvesAfterInitialLimit = {
    iterations: 0,
    MAX_ITERATIONS: 10,
    progress: 0,
    solved: false,
    failed: false,
    error: null,
    hyperParameters: {},
    solvedRoutes: [
      {
        connectionName: "a",
        traceThickness: 0.15,
        viaDiameter: 0.3,
        route: [
          { x: scaledStart!.x, y: scaledStart!.y, z: scaledStart!.z },
          { x: scaledEnd!.x, y: scaledEnd!.y, z: scaledEnd!.z },
        ],
        vias: [],
      },
    ],
    step() {
      this.iterations++
      if (this.iterations === 4) this.solved = true
    },
  }
  enlargedPortfolio.MIN_SUBSTEPS = 1
  enlargedPortfolio.adaptiveSearchExpanded = true
  enlargedPortfolio.supervisedSolvers = [
    {
      solver: solvesAfterInitialLimit,
      hyperParameters: {},
      g: 0,
      h: 1,
      f: 0,
    },
  ] as any
  ;(enlargedPortfolio as any).refreshDynamicIterationLimit()

  expect(enlargedPortfolio.maxSupervisorIterations).toBeUndefined()
  expect(enlargedPortfolio.MAX_ITERATIONS).toBeGreaterThan(2)
  while (!solver.solved && !solver.failed) solver.step()
  expect(solvesAfterInitialLimit.iterations).toBe(4)
  expect(solver.solved).toBe(true)
  expect(solver.growthAttempts).toBe(1)
  expect(solver.solvedRoutes).toEqual([makeStraightRoute()])

  const uncappedWinner = new GrowShrinkHighDensityIntraNodeSolver({
    nodeWithPortPoints: makeNode(),
    cacheProvider: null,
    captureSearchDebug: false,
  })
  const cappedWinner = new GrowShrinkHighDensityIntraNodeSolver({
    nodeWithPortPoints: makeNode(),
    cacheProvider: null,
    captureSearchDebug: false,
    maxInitialScaleSupervisorIterations: 50_000,
  })
  uncappedWinner.solve()
  cappedWinner.solve()

  expect(uncappedWinner.growthAttempts).toBe(0)
  expect(cappedWinner.growthAttempts).toBe(0)
  expect(cappedWinner.winningSolver?.maxSupervisorIterations).toBe(50_000)
  expect(cappedWinner.solvedRoutes).toEqual(uncappedWinner.solvedRoutes)

  const allScaleLimit = new GrowShrinkHighDensityIntraNodeSolver({
    nodeWithPortPoints: makeNode(),
    maxInnerIterationsPerGrowthAttempt: 7,
    maxInitialScaleSupervisorIterations: 11,
  })
  ;(allScaleLimit as any).createActiveSubSolver()
  expect(allScaleLimit.activeSubSolver?.maxSupervisorIterations).toBe(7)
  allScaleLimit.activeSubSolver = null
  allScaleLimit.scaleFactor = 8
  ;(allScaleLimit as any).createActiveSubSolver()
  expect((allScaleLimit.activeSubSolver as any)?.maxSupervisorIterations).toBe(
    7,
  )
})
