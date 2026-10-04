import { expect, test } from "bun:test"
import type { BaseSolver } from "lib/solvers/BaseSolver"
import { CachedIntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/CachedIntraNodeRouteSolver"
import {
  GrowShrinkHighDensityIntraNodeSolver,
  type GrowShrinkHighDensityIntraNodeSolverParams,
} from "lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import type {
  HighDensityIntraNodeRoute,
  NodeWithPortPoints,
  PortPoint,
} from "lib/types/high-density-types"

type Candidate =
  NonNullable<PortfolioSingleIntraNodeSolver["supervisedSolvers"]>[number]
type AttemptRecord = {
  solver: PortfolioSingleIntraNodeSolver
  growthAttempts: number
  scaleFactor: number
  candidates: Candidate[]
  candidateLimits: Map<BaseSolver, number>
  seenCandidates: Set<BaseSolver>
  parentLimit: number
}
type Scenario = {
  records: AttemptRecord[]
  winAt: number | number[] | null
  quickOriginalWin: boolean
  suspendedIterations: number | null
  suspendedWork: number[] | null
}

function createNode(width = 0.8, height = 1.2): NodeWithPortPoints {
  const center = { x: 5, y: 7 }
  const pairs = [-0.4, 0, 0.4].map((offset, index): [PortPoint, PortPoint] => {
    const connectionName = `connection${index}`
    return [
      { x: center.x - width / 2, y: center.y + offset, z: 0, connectionName },
      {
        x: center.x + width / 2,
        y: center.y + offset,
        z: index === 0 ? 1 : 0,
        connectionName,
      },
    ]
  })
  return {
    capacityMeshNodeId: "attempt-order-node",
    center,
    width,
    height,
    availableZ: [0, 1],
    portPoints: pairs.flat(),
    portPointsInPairs: pairs,
  }
}

function createGrow(
  maxGrowthAttempts: number,
  extra: Partial<GrowShrinkHighDensityIntraNodeSolverParams> = {},
): GrowShrinkHighDensityIntraNodeSolver {
  return new GrowShrinkHighDensityIntraNodeSolver({
    nodeWithPortPoints: createNode(),
    traceWidth: 0.15,
    obstacleMargin: 0.1,
    viaDiameter: 0.3,
    maxGrowthAttempts,
    enableNegotiatedSearch: true,
    fallbackToInvalidGeometryOnFailure: false,
    ...extra,
  })
}

function makeRoutes(node: NodeWithPortPoints): HighDensityIntraNodeRoute[] {
  const routes: HighDensityIntraNodeRoute[] = []
  for (const [start, end] of node.portPointsInPairs!) {
    routes.push({
      connectionName: start.connectionName,
      traceThickness: 0.15,
      viaDiameter: 0.3,
      route: [start, { x: node.center.x, y: start.y, z: end.z }, end],
      vias: [{ x: node.center.x, y: start.y }],
    })
  }
  return routes
}

function completedFirstRound(record: AttemptRecord): boolean {
  for (const candidate of record.candidates) {
    if (candidate.hyperParameters.MULTI_HEAD_POLYLINE_SOLVER) continue
    const solver = candidate.solver
    if (
      !solver.solved &&
      !solver.failed &&
      solver.iterations < record.solver.MIN_SUBSTEPS
    ) {
      return false
    }
  }
  return true
}

function prepareAttempt(
  grow: GrowShrinkHighDensityIntraNodeSolver,
  scenario: Scenario,
): AttemptRecord {
  if (!grow.activeSubSolver) {
    const factory = grow as unknown as { createActiveSubSolver(): void }
    factory.createActiveSubSolver()
  }
  const portfolio = grow.activeSubSolver!
  let record = scenario.records.find((attempt) => attempt.solver === portfolio)
  if (!record) {
    portfolio.initializeSolvers()
    record = {
      solver: portfolio,
      growthAttempts: grow.growthAttempts,
      scaleFactor: grow.scaleFactor,
      candidates: [...portfolio.supervisedSolvers!],
      candidateLimits: new Map(),
      seenCandidates: new Set(),
      parentLimit: grow.MAX_ITERATIONS,
    }
    scenario.records.push(record)
  }
  const attempt = record
  for (const candidate of portfolio.supervisedSolvers!) {
    scriptCandidate(candidate.solver, attempt, scenario)
    if (!attempt.candidateLimits.has(candidate.solver)) {
      attempt.candidateLimits.set(
        candidate.solver,
        candidate.solver.MAX_ITERATIONS,
      )
    }
  }
  if (attempt.growthAttempts > 0 || completedFirstRound(attempt)) {
    const generateSolver = portfolio.generateSolver
    portfolio.generateSolver = function (
      parameters,
    ): ReturnType<typeof generateSolver> {
      const candidate = generateSolver.call(this, parameters)
      expect(this).toBe(attempt.solver)
      expect(candidate.iterations).toBe(0)
      expect(candidate.MAX_ITERATIONS).toBeGreaterThan(0)
      scriptCandidate(candidate, attempt, scenario)
      return candidate
    }
  }
  return attempt
}

function scriptCandidate(
  child: BaseSolver,
  attempt: AttemptRecord,
  scenario: Scenario,
): void {
  if (attempt.seenCandidates.has(child)) return
  attempt.seenCandidates.add(child)
  child._step = function (): void {
    const initialRoundDone = completedFirstRound(attempt)
    const originalCanFinish =
      scenario.quickOriginalWin ||
      initialRoundDone ||
      scenario.records.some((entry) => entry.growthAttempts === 1)
    if (attempt.growthAttempts === 0 && !originalCanFinish) {
      this.progress = 0
      return
    }
    const shouldWin = Array.isArray(scenario.winAt)
      ? scenario.winAt.includes(attempt.growthAttempts)
      : attempt.growthAttempts === scenario.winAt
    if (shouldWin && this instanceof CachedIntraNodeRouteSolver) {
      this.solvedRoutes = makeRoutes(attempt.solver.nodeWithPortPoints)
      this.solved = true
      return
    }
    this.failed = true
    this.error = "Scripted native candidate exhausted"
  }
}

function runScenario(
  grow: GrowShrinkHighDensityIntraNodeSolver,
  scenario: Scenario,
): void {
  for (let step = 0; step < 1000 && !grow.solved && !grow.failed; step++) {
    const attempt = prepareAttempt(grow, scenario)
    const original = scenario.records[0]!
    if (
      attempt.growthAttempts === 1 &&
      !original.solver.failed &&
      scenario.suspendedIterations === null
    ) {
      scenario.suspendedIterations = original.solver.iterations
      scenario.suspendedWork = original.candidates.map(
        ({ solver }) => solver.iterations,
      )
    }
    if (attempt.growthAttempts === 1 && !original.solver.failed) {
      expect(original.solver.iterations).toBe(scenario.suspendedIterations)
      expect(
        original.candidates.map(({ solver }) => solver.iterations),
      ).toEqual(scenario.suspendedWork)
    }
    grow.step()
    expect(grow.MAX_ITERATIONS).toBe(attempt.parentLimit)
    for (const [candidate, limit] of attempt.candidateLimits) {
      expect(candidate.MAX_ITERATIONS).toBe(limit)
    }
  }
  expect(grow.solved || grow.failed).toBe(true)
}

function createScenario(
  winAt: number | number[] | null,
  quickOriginalWin = false,
): Scenario {
  return {
    records: [],
    winAt,
    quickOriginalWin,
    suspendedIterations: null,
    suspendedWork: null,
  }
}

test("growth attempt ordering preserves every native search budget", () => {
  const quick = createGrow(3)
  const quickScenario = createScenario(0, true)
  runScenario(quick, quickScenario)
  expect(quick.solved).toBe(true)
  expect(quick.growthAttempts).toBe(0)
  expect(quick.scaleFactor).toBe(1)
  expect(quickScenario.records).toHaveLength(1)

  const negativeFitness = createGrow(1)
  const negativeScenario = createScenario(1)
  const negativeOriginal = prepareAttempt(negativeFitness, negativeScenario)
  negativeFitness.step()
  const repeatedCandidate = negativeOriginal.solver.supervisedSolvers!.find(
    ({ solver }) =>
      solver instanceof CachedIntraNodeRouteSolver && !solver.failed,
  )!
  for (let round = 0; round < 5; round++) {
    // Native progress can exceed one for multi-terminal connections. Its
    // negative fitness legitimately outranks untouched zero-fitness probes.
    repeatedCandidate.solver.progress = 2
    repeatedCandidate.g = negativeOriginal.solver.computeG(
      repeatedCandidate.solver,
    )
    repeatedCandidate.h = negativeOriginal.solver.computeH(
      repeatedCandidate.solver,
    )
    repeatedCandidate.f = negativeOriginal.solver.computeF(
      repeatedCandidate.g,
      repeatedCandidate.h,
    )
    expect(repeatedCandidate.f).toBeLessThan(0)
    negativeFitness.step()
    expect(negativeFitness.activeSubSolver).toBe(negativeOriginal.solver)
    expect(negativeFitness.growthAttempts).toBe(0)
    expect(negativeFitness.scaleFactor).toBe(1)
    expect(
      negativeOriginal.candidates.some(
        ({ solver, hyperParameters }) =>
          !hyperParameters.MULTI_HEAD_POLYLINE_SOLVER &&
          !solver.solved &&
          !solver.failed &&
          solver.iterations === 0,
      ),
    ).toBe(true)
  }

  const grown = createGrow(3)
  const grownScenario = createScenario(1)
  runScenario(grown, grownScenario)
  expect(grown.solved).toBe(true)
  expect(
    grownScenario.records.map(({ growthAttempts }) => growthAttempts),
  ).toEqual([0, 1])
  expect(grown.winningSolver).toBe(grownScenario.records[1]!.solver)
  expect(grown.growthAttempts).toBe(1)
  expect(grown.scaleFactor).toBe(2)
  expect(grown.failedSolvers).toHaveLength(0)
  expect(grownScenario.records[0]!.solver.failed).toBe(false)
  expect(grownScenario.records[0]!.solver.iterations).toBe(
    grownScenario.suspendedIterations,
  )
  expect(grown.solvedRoutes).toEqual(makeRoutes(grown.nodeWithPortPoints))
  expect(
    (grown as unknown as { suspendedInitialAttempt: unknown })
      .suspendedInitialAttempt,
  ).toBeNull()
  const originalCandidates = grownScenario.records[0]!.candidates
  for (const candidate of originalCandidates) {
    if (candidate.hyperParameters.MULTI_HEAD_POLYLINE_SOLVER) {
      expect(candidate.solver.iterations).toBe(0)
    } else if (!candidate.solver.failed && !candidate.solver.solved) {
      expect(candidate.solver.iterations).toBe(100)
    }
  }

  const resumed = createGrow(3)
  const resumedScenario = createScenario(0)
  runScenario(resumed, resumedScenario)
  expect(resumed.solved).toBe(true)
  expect(resumed.winningSolver).toBe(resumedScenario.records[0]!.solver)
  expect(resumed.growthAttempts).toBe(0)
  expect(resumed.scaleFactor).toBe(1)
  expect(resumed.failedSolvers).toEqual([resumedScenario.records[1]!.solver])
  expect(resumed.solvedRoutes).toEqual(makeRoutes(resumed.nodeWithPortPoints))
  expect(resumedScenario.records).toHaveLength(2)
  expect(resumedScenario.records[0]!.solver.iterations).toBeGreaterThan(
    resumedScenario.suspendedIterations!,
  )

  for (const maximum of [0, 1, 3]) {
    const exhausted = createGrow(maximum)
    const scenario = createScenario(null)
    runScenario(exhausted, scenario)
    expect(exhausted.failed).toBe(true)
    expect(exhausted.failedSolvers).toHaveLength(maximum + 1)
    expect(new Set(exhausted.failedSolvers)).toHaveProperty("size", maximum + 1)
    expect(
      scenario.records.map(({ growthAttempts }) => growthAttempts),
    ).toEqual(
      Array.from({ length: maximum + 1 }, (_, index) => index),
    )
    const actualFailures = exhausted.failedSolvers.map(
      (solver) =>
        scenario.records.find((record) => record.solver === solver)!
          .growthAttempts,
    )
    expect(actualFailures).toEqual(
      maximum === 0
        ? [0]
        : [
            1,
            0,
            ...Array.from({ length: maximum - 1 }, (_, index) => index + 2),
          ],
    )
  }

  const validatorCalls: HighDensityIntraNodeRoute[][] = []
  const validated = createGrow(1, {
    growShrinkSolutionValidator: (routes): boolean => {
      validatorCalls.push(routes)
      const firstCandidate = validatorCalls.length === 1
      const endpoints = routes[0]!.route
      expect(endpoints[0]!.x).toBe(4.6)
      expect(endpoints[endpoints.length - 1]!.x).toBe(5.4)
      return !firstCandidate
    },
  })
  const validatedScenario = createScenario([0, 1])
  runScenario(validated, validatedScenario)
  expect(validated.solved).toBe(true)
  expect(
    validatedScenario.records.map(({ growthAttempts }) => growthAttempts),
  ).toEqual([0, 1])
  expect(validated.failedSolvers[0]).toBe(validatedScenario.records[0]!.solver)
  expect(validatorCalls).toHaveLength(2)
  expect(validatedScenario.suspendedIterations).toBeNull()

  const customCache = createGrow(1, { cacheProvider: null })
  const cacheScenario = createScenario(null)
  runScenario(customCache, cacheScenario)
  expect(customCache.failedSolvers).toEqual(
    cacheScenario.records.map(({ solver }) => solver),
  )
  expect(cacheScenario.suspendedIterations).toBeNull()

  const spacious = createGrow(1, { nodeWithPortPoints: createNode(4, 4) })
  const spaciousScenario = createScenario(null)
  prepareAttempt(spacious, spaciousScenario)
  spacious.step()
  expect(
    (spacious as unknown as {
      activeAttemptFrame: { spaciousNode: boolean }
    }).activeAttemptFrame.spaciousNode,
  ).toBe(true)
  // Later geometry edits retain this attempt's original ordering. The owned
  // portfolio still has the original geometry and its unchanged search work.
  spacious.nodeWithPortPoints = createNode()
  runScenario(spacious, spaciousScenario)
  expect(spacious.failedSolvers).toEqual(
    spaciousScenario.records.map(({ solver }) => solver),
  )
  expect(spaciousScenario.suspendedIterations).toBeNull()

  const customPolicy = createGrow(1)
  const customScenario = createScenario(null)
  const customOriginal = prepareAttempt(customPolicy, customScenario).solver
  const originalComputeF = customOriginal.computeF
  customOriginal.computeF = function (g, h): number {
    const fitness = originalComputeF.call(this, g, h)
    expect(this).toBe(customOriginal)
    expect(Number.isFinite(g)).toBe(true)
    expect(Number.isFinite(h)).toBe(true)
    return fitness
  }
  runScenario(customPolicy, customScenario)
  expect(customPolicy.failedSolvers).toEqual(
    customScenario.records.map(({ solver }) => solver),
  )
  expect(customScenario.suspendedIterations).toBeNull()

  for (const hook of ["_step", "step"] as const) {
    const customHook = createGrow(1)
    const hookScenario = createScenario(null)
    const originalPortfolio = prepareAttempt(customHook, hookScenario).solver
    const nativeHook = originalPortfolio[hook]
    originalPortfolio[hook] = function (): void {
      expect(this).toBe(originalPortfolio)
      expect(this.MAX_ITERATIONS).toBeGreaterThan(0)
      const previousIteration = this.iterations
      nativeHook.call(this)
      expect(this.iterations).toBe(
        previousIteration + (hook === "step" ? 1 : 0),
      )
    }
    runScenario(customHook, hookScenario)
    expect(customHook.failedSolvers).toEqual(
      hookScenario.records.map(({ solver }) => solver),
    )
    expect(hookScenario.suspendedIterations).toBeNull()
  }

  const parentHook = createGrow(1)
  const parentHookScenario = createScenario(null)
  const nativeParentStep = parentHook.step
  parentHook.step = function (): void {
    expect(this).toBe(parentHook)
    const previousIteration = this.iterations
    expect(this.MAX_ITERATIONS).toBeGreaterThan(0)
    nativeParentStep.call(this)
    expect(this.iterations).toBe(previousIteration + 1)
  }
  runScenario(parentHook, parentHookScenario)
  expect(parentHook.failedSolvers).toEqual(
    parentHookScenario.records.map(({ solver }) => solver),
  )
  expect(parentHookScenario.suspendedIterations).toBeNull()
  const editedPublicScale = createGrow(1)
  const editedScenario = createScenario(null)
  prepareAttempt(editedPublicScale, editedScenario)
  editedPublicScale.scaleFactor = 1.5
  runScenario(editedPublicScale, editedScenario)
  expect(editedPublicScale.failedSolvers).toEqual(
    editedScenario.records.map(({ solver }) => solver),
  )
  expect(editedScenario.suspendedIterations).toBeNull()

  const tiny = createGrow(3, { nodeWithPortPoints: createNode(0.05, 1.2) })
  const tinyScenario = createScenario(null)
  runScenario(tiny, tinyScenario)
  expect(tiny.minimumGrowthAttempts).toBe(3)
  expect(
    tinyScenario.records.map(({ growthAttempts }) => growthAttempts),
  ).toEqual([0, 3])
  expect(tiny.failedSolvers).toEqual(
    tinyScenario.records.map(({ solver }) => solver),
  )
  expect(tinyScenario.suspendedIterations).toBeNull()
})
