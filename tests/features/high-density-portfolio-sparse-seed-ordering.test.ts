import { expect, test } from "bun:test"
import { HighDensitySolverA01 } from "@tscircuit/high-density-a01"
import { HighDensitySolverA01 as HighDensitySolverA01Next } from "@tscircuit/high-density-a01-next"
import { GrowShrinkHighDensityIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import sample002LargeNode from "../fixtures/srj18-sample002-large-node.json"

const getA01SeedSolver = (
  portfolio: PortfolioSingleIntraNodeSolver,
  seed: number,
  next: boolean,
): NonNullable<typeof portfolio.supervisedSolvers>[number]["solver"] =>
  portfolio.supervisedSolvers!.find(
    ({ hyperParameters }) =>
      Boolean(
        next
          ? hyperParameters.HIGH_DENSITY_A01_NEXT
          : hyperParameters.HIGH_DENSITY_A01,
      ) && hyperParameters.SHUFFLE_SEED === seed,
  )!.solver

test("Pipeline9 prioritizes always-enabled next-generation candidates", () => {
  const denseNode = structuredClone(
    sample002LargeNode,
  ) as NodeWithPortPoints
  const sparseNode = structuredClone(denseNode)
  sparseNode.portPointsInPairs = sparseNode.portPointsInPairs!.slice(0, 5)
  sparseNode.portPoints = sparseNode.portPointsInPairs.flat()
  const createPortfolio = (
    nodeWithPortPoints: NodeWithPortPoints,
    prioritizeNextGenerationSolvers = false,
  ): PortfolioSingleIntraNodeSolver => {
    const portfolio = new PortfolioSingleIntraNodeSolver({
      nodeWithPortPoints,
      viaDiameter: 0.3,
      traceWidth: 0.1,
      obstacleMargin: 0.15,
      obstacles: [],
      layerCount: 2,
      effort: 1,
      prioritizeNextGenerationSolvers,
    })
    portfolio.initializeSolvers()
    return portfolio
  }
  const compatibilityPortfolio = createPortfolio(sparseNode)
  const sparsePortfolio = createPortfolio(sparseNode, true)
  const densePortfolio = createPortfolio(denseNode, true)
  const legacySeed0 = getA01SeedSolver(sparsePortfolio, 0, false)
  const nextSeed5 = getA01SeedSolver(sparsePortfolio, 5, true)

  expect(legacySeed0).toBeInstanceOf(HighDensitySolverA01)
  expect(legacySeed0).not.toBeInstanceOf(HighDensitySolverA01Next)
  expect(nextSeed5).toBeInstanceOf(HighDensitySolverA01Next)
  expect(nextSeed5).not.toBeInstanceOf(HighDensitySolverA01)

  expect(
    compatibilityPortfolio.computeG(
      getA01SeedSolver(compatibilityPortfolio, 5, true) as any,
    ),
  ).toBe(Number.POSITIVE_INFINITY)
  expect(
    compatibilityPortfolio.stats.dynamicExpansionWorkBudget,
  ).toBeLessThan(
    getA01SeedSolver(compatibilityPortfolio, 5, true).MAX_ITERATIONS,
  )
  expect(
    sparsePortfolio.computeG(nextSeed5 as any),
  ).toBe(0.25)
  const getA08Solver = (portfolio: PortfolioSingleIntraNodeSolver) =>
    portfolio.supervisedSolvers!.find(
      ({ hyperParameters }) => hyperParameters.HIGH_DENSITY_A08,
    )!.solver
  expect(
    compatibilityPortfolio.computeG(
      getA08Solver(compatibilityPortfolio) as any,
    ),
  ).toBe(Number.POSITIVE_INFINITY)
  expect(
    sparsePortfolio.computeG(getA08Solver(sparsePortfolio) as any),
  ).toBe(7.25)
  expect(
    sparsePortfolio.computeG(legacySeed0 as any),
  ).toBe(0)
  expect(
    densePortfolio.computeG(
      getA01SeedSolver(densePortfolio, 2, true) as any,
    ),
  ).toBe(0.25)

  for (const supervisedSolver of compatibilityPortfolio.supervisedSolvers!) {
    const hyperParameters = supervisedSolver.hyperParameters
    if (
      !hyperParameters.HIGH_DENSITY_A01_NEXT &&
      !hyperParameters.HIGH_DENSITY_A08
    ) {
      supervisedSolver.solver.failed = true
    }
  }
  compatibilityPortfolio.step()

  expect(compatibilityPortfolio.adaptiveSearchExpanded).toBe(true)
  expect(
    compatibilityPortfolio.stats
      .compatibilityNextGenerationCandidatesActivated,
  ).toBeUndefined()
  expect(
    compatibilityPortfolio.computeG(
      getA01SeedSolver(compatibilityPortfolio, 5, true) as any,
    ),
  ).toBe(Number.POSITIVE_INFINITY)
  for (const supervisedSolver of compatibilityPortfolio.supervisedSolvers!) {
    const hyperParameters = supervisedSolver.hyperParameters
    if (
      !hyperParameters.HIGH_DENSITY_A01_NEXT &&
      !hyperParameters.HIGH_DENSITY_A08
    ) {
      supervisedSolver.solver.failed = true
    }
  }
  compatibilityPortfolio.step()

  expect(
    compatibilityPortfolio.stats
      .compatibilityNextGenerationCandidatesActivated,
  ).toBe(true)
  expect(
    compatibilityPortfolio.computeG(
      getA01SeedSolver(compatibilityPortfolio, 5, true) as any,
    ),
  ).toBeGreaterThanOrEqual(6)
  expect(
    compatibilityPortfolio.computeG(
      getA08Solver(compatibilityPortfolio) as any,
    ),
  ).toBeGreaterThanOrEqual(13)
  expect(compatibilityPortfolio.activeSubSolver).toBeInstanceOf(
    HighDensitySolverA01Next,
  )

  const rejectionPortfolio = createPortfolio(sparseNode, true)
  const rejectedCandidate = getA01SeedSolver(rejectionPortfolio, 0, false)
  rejectedCandidate.solved = true
  rejectionPortfolio.solved = true
  rejectionPortfolio.winningSolver = rejectedCandidate as any
  rejectionPortfolio.solvedRoutes = []
  const growShrinkSolver = new GrowShrinkHighDensityIntraNodeSolver({
    ...rejectionPortfolio.constructorParams,
    growShrinkSolutionValidator: () => false,
  })
  growShrinkSolver.activeSubSolver = rejectionPortfolio
  growShrinkSolver.step()

  expect(rejectedCandidate.failed).toBe(true)
  expect(rejectionPortfolio.failed).toBe(false)
  expect(rejectionPortfolio.solved).toBe(false)
  expect(rejectionPortfolio.stats.rejectedByParentValidatorCount).toBe(1)
  expect(growShrinkSolver.activeSubSolver).toBe(rejectionPortfolio)
  expect(growShrinkSolver.growthAttempts).toBe(0)
  expect(growShrinkSolver.scaleFactor).toBe(1)

  const compatibilityGrowShrinkSolver =
    new GrowShrinkHighDensityIntraNodeSolver({
      nodeWithPortPoints: sparseNode,
      viaDiameter: 0.3,
      traceWidth: 0.1,
      obstacleMargin: 0.15,
      obstacles: [],
      layerCount: 2,
      effort: 1,
      maxGrowthAttempts: 1,
      maxInnerIterationsPerGrowthAttempt: 17,
    })
  compatibilityGrowShrinkSolver.step()
  expect(
    compatibilityGrowShrinkSolver.activeSubSolver!.constructorParams
      .supervisorIterationLimit,
  ).toBe(17)
  expect(compatibilityGrowShrinkSolver.activeSubSolver!.MAX_ITERATIONS).toBe(
    17,
  )
  expect(
    compatibilityGrowShrinkSolver.activeSubSolver!.constructorParams
      .deferNextGenerationSolversToParentRetry,
  ).toBe(true)
  expect(
    compatibilityGrowShrinkSolver.activeSubSolver!.supervisedSolvers!.some(
      ({ hyperParameters }) => hyperParameters.HIGH_DENSITY_A01_NEXT,
    ),
  ).toBe(true)
  compatibilityGrowShrinkSolver.activeSubSolver!.failed = true
  compatibilityGrowShrinkSolver.step()
  compatibilityGrowShrinkSolver.step()
  expect(compatibilityGrowShrinkSolver.growthAttempts).toBe(1)
  expect(
    compatibilityGrowShrinkSolver.activeSubSolver!.constructorParams
      .deferNextGenerationSolversToParentRetry,
  ).toBe(false)
  expect(
    compatibilityGrowShrinkSolver.activeSubSolver!.constructorParams
      .supervisorIterationLimit,
  ).toBeUndefined()
})
