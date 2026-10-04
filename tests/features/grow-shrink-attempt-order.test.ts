import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { createPipeline9RegularNodeSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { doPipeline9RoutesHaveCopperConflict } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"
import type { BaseSolver } from "lib/solvers/BaseSolver"
import { CachedIntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/CachedIntraNodeRouteSolver"
import { HighDensitySolver } from "lib/solvers/HighDensitySolver/HighDensitySolver"
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

type Candidate = NonNullable<
  PortfolioSingleIntraNodeSolver["supervisedSolvers"]
>[number]
type AttemptRecord = {
  solver: PortfolioSingleIntraNodeSolver
  growthAttempts: number
  scaleFactor: number
  candidates: Candidate[]
  initialCachedProbes: [
    CachedIntraNodeRouteSolver,
    CachedIntraNodeRouteSolver,
  ]
  initialCachedProbeCount: number
  warmupWork: number
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
  deferredIterations: number | null
  deferredWork: number[] | null
}

function createNode(
  width = 0.8,
  height = 1.2,
  spacing = 0.4,
  connectionCount = 3,
): NodeWithPortPoints {
  const center = { x: 5, y: 7 }
  const pairs = Array.from(
    { length: connectionCount },
    (_, index): [PortPoint, PortPoint] => {
      const offset = (index - (connectionCount - 1) / 2) * spacing
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
    },
  )
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
    connMap: new ConnectivityMap({}),
    prioritizeGrowthAfterInitialProbes: true,
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

function getInitialCachedProbes(
  portfolio: PortfolioSingleIntraNodeSolver,
): [CachedIntraNodeRouteSolver, CachedIntraNodeRouteSolver] {
  const probes = portfolio.supervisedSolvers!
    .map(({ solver }) => solver)
    .filter(
      (solver): solver is CachedIntraNodeRouteSolver =>
        solver instanceof CachedIntraNodeRouteSolver,
    )
  const first = probes[0]
  const second = probes[1]
  if (!first || !second) {
    throw new Error("Native portfolio must retain both initial cached probes")
  }
  return [first, second]
}

function completedInitialCachedProbes(record: AttemptRecord): boolean {
  for (const solver of record.initialCachedProbes) {
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

function getCandidateWork(
  portfolio: PortfolioSingleIntraNodeSolver,
): number {
  const descriptor = Object.getOwnPropertyDescriptor(
    portfolio,
    "totalCandidateWork",
  )
  if (
    !descriptor ||
    !("value" in descriptor) ||
    typeof descriptor.value !== "number" ||
    !Number.isFinite(descriptor.value) ||
    descriptor.value < 0
  ) {
    throw new Error("Native portfolio must retain its real candidate work")
  }
  return descriptor.value
}

function completedInitialReadiness(record: AttemptRecord): boolean {
  if (!completedInitialCachedProbes(record)) {
    return false
  }
  const work = getCandidateWork(record.solver)
  return work >= record.warmupWork
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
    const initialCachedProbeCount = portfolio.supervisedSolvers!.filter(
      ({ solver }) => solver instanceof CachedIntraNodeRouteSolver,
    ).length
    record = {
      solver: portfolio,
      growthAttempts: grow.growthAttempts,
      scaleFactor: grow.scaleFactor,
      candidates: [...portfolio.supervisedSolvers!],
      initialCachedProbes: getInitialCachedProbes(portfolio),
      initialCachedProbeCount,
      warmupWork:
        initialCachedProbeCount *
        portfolio.MIN_SUBSTEPS *
        portfolio.GREEDY_MULTIPLIER,
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
  if (attempt.growthAttempts > 0 || completedInitialReadiness(attempt)) {
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
  const negotiatedCandidate = attempt.candidates.some(
    ({ solver, hyperParameters }) =>
      solver === child && hyperParameters.HIGH_DENSITY_A13,
  )
  child._step = function (): void {
    const initialReadiness = completedInitialReadiness(attempt)
    const originalCanFinish =
      scenario.quickOriginalWin ||
      initialReadiness ||
      scenario.records.some((entry) => entry.growthAttempts === 1)
    if (attempt.growthAttempts === 0 && !originalCanFinish) {
      // Native A13 work does not contribute to exploration accounting. This
      // scripted candidate fails after a real step so other native candidates
      // can accumulate the warmup without running a negotiated geometry search.
      if (negotiatedCandidate) {
        this.failed = true
        this.error = "Scripted negotiated candidate exhausted"
        return
      }
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
      expect(original.solver.iterations).toBe(scenario.suspendedIterations!)
      expect(
        original.candidates.map(({ solver }) => solver.iterations),
      ).toEqual(scenario.suspendedWork!)
    }
    const grown = scenario.records.find((record) => record.growthAttempts === 1)
    if (attempt.growthAttempts === 0 && grown?.solver.solved) {
      if (scenario.deferredIterations === null) {
        scenario.deferredIterations = grown.solver.iterations
        scenario.deferredWork = grown.candidates.map(
          ({ solver }) => solver.iterations,
        )
      }
      expect(grown.solver.iterations).toBe(scenario.deferredIterations!)
      expect(grown.candidates.map(({ solver }) => solver.iterations)).toEqual(
        scenario.deferredWork!,
      )
    }
    grow.step()
    if (scenario.deferredIterations !== null) {
      expect(grown!.solver.iterations).toBe(scenario.deferredIterations!)
      expect(grown!.candidates.map(({ solver }) => solver.iterations)).toEqual(
        scenario.deferredWork!,
      )
    }
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
    deferredIterations: null,
    deferredWork: null,
  }
}

test("growth attempt ordering preserves every native search budget", () => {
  for (const policyParams of [
    {},
    { prioritizeGrowthAfterInitialProbes: false },
  ]) {
    const defaultGrow = new GrowShrinkHighDensityIntraNodeSolver({
      nodeWithPortPoints: createNode(),
      maxGrowthAttempts: 1,
      ...policyParams,
    })
    const defaultScenario = createScenario(null)
    runScenario(defaultGrow, defaultScenario)
    expect(defaultGrow.failedSolvers).toEqual(
      defaultScenario.records.map(({ solver }) => solver),
    )
    expect(defaultScenario.suspendedIterations).toBeNull()

    const defaultHighDensity = new HighDensitySolver({
      nodePortPoints: [createNode()],
      useGrowShrinkHighDensityIntraNodeSolver: true,
      ...policyParams,
    })
    defaultHighDensity.step()
    const defaultChild = defaultHighDensity.activeSubSolver
    if (!(defaultChild instanceof GrowShrinkHighDensityIntraNodeSolver)) {
      throw new Error(
        "HighDensitySolver must construct its configured growth solver",
      )
    }
    expect(defaultHighDensity.prioritizeGrowthAfterInitialProbes).toBe(false)
    expect(
      defaultChild.constructorParams.prioritizeGrowthAfterInitialProbes,
    ).toBe(false)
  }

  const ordinaryPortfolio = new HighDensitySolver({
    nodePortPoints: [createNode()],
    prioritizeGrowthAfterInitialProbes: true,
  })
  ordinaryPortfolio.step()
  const portfolioChild = ordinaryPortfolio.activeSubSolver
  if (!(portfolioChild instanceof PortfolioSingleIntraNodeSolver)) {
    throw new Error(
      "HighDensitySolver must retain its ordinary portfolio branch",
    )
  }
  expect(
    "prioritizeGrowthAfterInitialProbes" in portfolioChild.constructorParams,
  ).toBe(false)

  const regularParams = {
    nodeWithPortPoints: createNode(),
    connMap: new ConnectivityMap({}),
    colorMap: {},
    viaDiameter: 0.3,
    traceWidth: 0.15,
    obstacleMargin: 0.1,
    effort: 1,
    nodePfById: new Map(),
    obstacles: [],
    layerCount: 2,
  }
  const defaultRegular = createPipeline9RegularNodeSolver(regularParams)
  expect(defaultRegular.prioritizeGrowthAfterInitialProbes).toBe(false)
  const regular = createPipeline9RegularNodeSolver({
    ...regularParams,
    prioritizeGrowthAfterInitialProbes: true,
  })
  regular.step()
  const regularChild = regular.activeSubSolver
  if (!(regularChild instanceof GrowShrinkHighDensityIntraNodeSolver)) {
    throw new Error("Pipeline9 regular factory must construct a growth solver")
  }
  expect(regular.prioritizeGrowthAfterInitialProbes).toBe(true)
  expect(
    regularChild.constructorParams.prioritizeGrowthAfterInitialProbes,
  ).toBe(true)
  const regularScenario = createScenario(1)
  runScenario(regularChild, regularScenario)
  expect(regularScenario.suspendedIterations).not.toBeNull()
  expect(regularChild.growthAttempts).toBe(1)
  expect(
    "prioritizeGrowthAfterInitialProbes" in
      regularScenario.records[0]!.solver.constructorParams,
  ).toBe(false)

  const quick = createGrow(3)
  const quickScenario = createScenario(0, true)
  runScenario(quick, quickScenario)
  expect(quick.solved).toBe(true)
  expect(quick.growthAttempts).toBe(0)
  expect(quick.scaleFactor).toBe(1)
  expect(quickScenario.records).toHaveLength(1)

  const cheapOriginal = createGrow(1)
  const cheapScenario = createScenario(null)
  const cheapAttempt = prepareAttempt(cheapOriginal, cheapScenario)
  cheapOriginal.step()
  cheapOriginal.step()
  expect(completedInitialCachedProbes(cheapAttempt)).toBe(true)
  expect(completedInitialReadiness(cheapAttempt)).toBe(false)
  expect(cheapAttempt.initialCachedProbeCount).toBe(63)
  expect(cheapAttempt.warmupWork).toBe(31_500)
  expect(getCandidateWork(cheapAttempt.solver)).toBe(200)
  expect(cheapOriginal.activeSubSolver).toBe(cheapAttempt.solver)
  const cheapWinningCandidate = cheapAttempt.candidates.find(
    ({ solver }) =>
      solver instanceof CachedIntraNodeRouteSolver &&
      !cheapAttempt.initialCachedProbes.includes(solver) &&
      !solver.failed &&
      solver.iterations === 0,
  )!
  cheapWinningCandidate.solver._step = function (): void {
    expect(this).toBe(cheapWinningCandidate.solver)
    expect(this.iterations).toBeGreaterThan(0)
    const cached = this as CachedIntraNodeRouteSolver
    cached.solvedRoutes = makeRoutes(cheapAttempt.solver.nodeWithPortPoints)
    this.solved = true
  }
  cheapOriginal.step()
  expect(cheapOriginal.solved).toBe(true)
  expect(cheapOriginal.winningSolver).toBe(cheapAttempt.solver)
  expect(cheapOriginal.growthAttempts).toBe(0)
  expect(cheapOriginal.scaleFactor).toBe(1)
  expect(getCandidateWork(cheapAttempt.solver)).toBeLessThan(
    cheapAttempt.warmupWork,
  )
  expect(cheapScenario.records).toHaveLength(1)

  const negotiatedOnly = createGrow(1)
  const negotiatedScenario = createScenario(1)
  const negotiatedAttempt = prepareAttempt(
    negotiatedOnly,
    negotiatedScenario,
  )
  const negotiatedCandidate = negotiatedAttempt.candidates.find(
    ({ hyperParameters }) => hyperParameters.HIGH_DENSITY_A13,
  )!
  negotiatedCandidate.solver._step = function (): void {
    expect(this).toBe(negotiatedCandidate.solver)
    expect(this.iterations).toBeGreaterThan(0)
    expect(this.MAX_ITERATIONS).toBe(
      negotiatedAttempt.candidateLimits.get(this)!,
    )
    this.progress = 0
  }
  for (let step = 0; step < 400; step++) {
    negotiatedOnly.step()
    expect(negotiatedOnly.activeSubSolver).toBe(negotiatedAttempt.solver)
    expect(negotiatedOnly.growthAttempts).toBe(0)
  }
  expect(completedInitialCachedProbes(negotiatedAttempt)).toBe(true)
  expect(negotiatedCandidate.solver.iterations).toBeGreaterThanOrEqual(
    negotiatedAttempt.warmupWork,
  )
  expect(getCandidateWork(negotiatedAttempt.solver)).toBeLessThan(
    negotiatedAttempt.warmupWork,
  )
  expect(completedInitialReadiness(negotiatedAttempt)).toBe(false)
  negotiatedCandidate.solver._step = function (): void {
    expect(this).toBe(negotiatedCandidate.solver)
    expect(this.iterations).toBeGreaterThan(negotiatedAttempt.warmupWork)
    this.failed = true
    this.error = "Scripted negotiated candidate exhausted after real work"
  }
  runScenario(negotiatedOnly, negotiatedScenario)
  expect(negotiatedOnly.solved).toBe(true)
  expect(negotiatedScenario.suspendedIterations).not.toBeNull()

  const corrupted = createGrow(1)
  const corruptScenario = createScenario(null)
  const corruptOriginal = prepareAttempt(corrupted, corruptScenario)
  const retainedProbe = corruptOriginal.initialCachedProbes[0]
  corruptOriginal.solver.supervisedSolvers =
    corruptOriginal.solver.supervisedSolvers!.filter(
      ({ solver }) =>
        !(solver instanceof CachedIntraNodeRouteSolver) ||
        solver === retainedProbe,
    )
  expect(corrupted.step.bind(corrupted)).toThrow(
    "Early growth requires both original native cached probes",
  )
  expect(retainedProbe.iterations).toBe(100)
  expect(corrupted.failed).toBe(true)
  expect(corrupted.growthAttempts).toBe(0)
  expect(corrupted.scaleFactor).toBe(1)
  expect(corruptScenario.records).toHaveLength(1)

  const secondProbeWinner = createGrow(1)
  const secondWinnerScenario = createScenario(null)
  const secondWinnerOriginal = prepareAttempt(
    secondProbeWinner,
    secondWinnerScenario,
  )
  const secondWinningProbe = secondWinnerOriginal.initialCachedProbes[1]
  secondWinningProbe._step = function (): void {
    expect(this).toBe(secondWinningProbe)
    expect(this.iterations).toBeGreaterThan(0)
    this.solvedRoutes = makeRoutes(
      secondWinnerOriginal.solver.nodeWithPortPoints,
    )
    this.solved = true
    this.failed = false
  }
  secondProbeWinner.step()
  secondProbeWinner.step()
  expect(secondProbeWinner.solved).toBe(true)
  expect(secondProbeWinner.growthAttempts).toBe(0)
  expect(secondProbeWinner.scaleFactor).toBe(1)
  expect(secondProbeWinner.winningSolver).toBe(secondWinnerOriginal.solver)
  expect(secondWinnerScenario.records).toHaveLength(1)

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
      repeatedCandidate.solver as CachedIntraNodeRouteSolver,
    )
    repeatedCandidate.h = negativeOriginal.solver.computeH(
      repeatedCandidate.solver as CachedIntraNodeRouteSolver,
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
    expect(negativeOriginal.initialCachedProbes[1].iterations).toBe(0)
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
  expect(completedInitialCachedProbes(negativeOriginal)).toBe(false)
  expect(negativeOriginal.solver.adaptiveSearchExpanded).toBe(false)
  expect(
    negativeOriginal.candidates.reduce(
      (work, candidate) => work + candidate.solver.iterations,
      0,
    ),
  ).toBeLessThan(negativeOriginal.solver.stats.dynamicExpansionWorkBudget)
  negativeFitness.step()
  expect(completedInitialCachedProbes(negativeOriginal)).toBe(true)
  expect(completedInitialReadiness(negativeOriginal)).toBe(false)
  expect(negativeFitness.activeSubSolver).toBe(negativeOriginal.solver)
  expect(negativeFitness.growthAttempts).toBe(0)
  expect(negativeFitness.scaleFactor).toBe(1)
  expect(negativeOriginal.solver.adaptiveSearchExpanded).toBe(false)
  expect(
    negativeOriginal.candidates.some(
      ({ solver }) =>
        solver instanceof CachedIntraNodeRouteSolver &&
        !negativeOriginal.initialCachedProbes.includes(solver) &&
        solver.iterations === 0,
    ),
  ).toBe(true)
  runScenario(negativeFitness, negativeScenario)
  expect(negativeFitness.solved).toBe(true)
  expect(getCandidateWork(negativeOriginal.solver)).toBeGreaterThanOrEqual(
    negativeOriginal.warmupWork,
  )
  expect(negativeFitness.winningSolver).toBe(
    negativeScenario.records[1]!.solver,
  )

  const expansionNode = createNode(0.8, 12, 0.4, 12)
  expansionNode.availableZ = [0, 1, 2, 3]
  const expanded = createGrow(1, {
    nodeWithPortPoints: expansionNode,
    layerCount: 4,
    gridSearchSegmentWork: 300,
    gridSearchWorkScale: 0.25,
  })
  const expansionScenario = createScenario(null)
  const expandedOriginal = prepareAttempt(expanded, expansionScenario)
  const [expansionFirst, expansionSecond] =
    expandedOriginal.initialCachedProbes
  const expansionThreshold =
    expandedOriginal.solver.stats.dynamicExpansionWorkBudget
  expect(expansionThreshold).toBe(expansionFirst.MAX_ITERATIONS)
  const repeatedRoutes = [
    ...makeRoutes(expandedOriginal.solver.nodeWithPortPoints),
    ...makeRoutes(expandedOriginal.solver.nodeWithPortPoints),
  ]
  expansionFirst._step = function (): void {
    expect(this).toBe(expansionFirst)
    expect(this.MAX_ITERATIONS).toBe(expansionThreshold)
    expect(this.iterations).toBeGreaterThan(0)
    // Explicit branches can outnumber distinct connections. Keep native
    // progress/fitness calculations and spend real BaseSolver steps.
    this.solvedRoutes = repeatedRoutes
  }
  for (
    let step = 0;
    !expandedOriginal.solver.adaptiveSearchExpanded &&
    step <=
      Math.ceil(expansionThreshold / expandedOriginal.solver.MIN_SUBSTEPS);
    step++
  ) {
    expanded.step()
    expect(expanded.activeSubSolver).toBe(expandedOriginal.solver)
    expect(expanded.growthAttempts).toBe(0)
    expect(expanded.scaleFactor).toBe(1)
    expect(expansionSecond.iterations).toBe(0)
  }
  expect(expandedOriginal.solver.adaptiveSearchExpanded).toBe(true)
  expect(expansionFirst.failed).toBe(true)
  expect(expansionFirst.iterations).toBeGreaterThan(expansionThreshold)
  expect(expandedOriginal.solver.stats.candidateWorkAtExpansion).toBe(
    expansionFirst.iterations,
  )
  expect(completedInitialCachedProbes(expandedOriginal)).toBe(false)
  expanded.step()
  expect(completedInitialCachedProbes(expandedOriginal)).toBe(true)
  expect(expanded.activeSubSolver).toBe(expandedOriginal.solver)
  expect(expanded.growthAttempts).toBe(0)
  expect(expanded.scaleFactor).toBe(1)
  runScenario(expanded, expansionScenario)
  expect(expanded.failedSolvers).toEqual(
    expansionScenario.records.map(({ solver }) => solver),
  )
  expect(expansionScenario.suspendedIterations).toBeNull()

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
    grownScenario.suspendedIterations!,
  )
  expect(grown.solvedRoutes).toEqual(makeRoutes(grown.nodeWithPortPoints))
  expect(
    (grown as unknown as { suspendedInitialAttempt: unknown })
      .suspendedInitialAttempt,
  ).toBeNull()
  const originalCandidates = grownScenario.records[0]!.candidates
  expect(grownScenario.records[0]!.initialCachedProbeCount).toBe(63)
  expect(getCandidateWork(grownScenario.records[0]!.solver)).toBe(31_500)
  for (const candidate of originalCandidates) {
    if (
      candidate.solver instanceof CachedIntraNodeRouteSolver &&
      grownScenario.records[0]!.initialCachedProbes.includes(candidate.solver)
    ) {
      expect(candidate.solver.iterations).toBeGreaterThanOrEqual(100)
    }
  }
  expect(
    originalCandidates.some(
      ({ solver }) =>
        !solver.solved && !solver.failed && solver.iterations === 0,
    ),
  ).toBe(true)

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

  for (const maximum of [1, 3]) {
    for (const originalWins of [false, true]) {
      const screened = createGrow(maximum, {
        nodeWithPortPoints: createNode(0.8, 1.2, 0.2),
      })
      const screenScenario = createScenario(originalWins ? [0, 1] : 1)
      runScenario(screened, screenScenario)
      const original = screenScenario.records[0]!
      const deferred = screenScenario.records[1]!
      expect(screened.solved).toBe(true)
      expect(screened.failed).toBe(false)
      expect(screenScenario.records).toHaveLength(2)
      expect(screenScenario.deferredIterations).not.toBeNull()
      expect(original.solver.iterations).toBeGreaterThan(
        screenScenario.suspendedIterations!,
      )
      expect(deferred.solver.solved).toBe(true)
      expect(deferred.solver.failed).toBe(false)
      expect(deferred.solver.iterations).toBe(
        screenScenario.deferredIterations!,
      )
      expect(screened.failedSolvers).toEqual(
        originalWins ? [] : [original.solver],
      )
      expect(screened.winningSolver).toBe(
        originalWins ? original.solver : deferred.solver,
      )
      expect(screened.growthAttempts).toBe(originalWins ? 0 : 1)
      expect(screened.scaleFactor).toBe(originalWins ? 1 : 2)
      expect(screened.solvedRoutes).toEqual(
        makeRoutes(screened.nodeWithPortPoints),
      )
      // The solved 2x centerlines have room at native copper dimensions. Only
      // their inverse transform introduces the physical inter-net conflict.
      expect(
        doPipeline9RoutesHaveCopperConflict({
          left: deferred.solver.solvedRoutes[0]!,
          right: deferred.solver.solvedRoutes[1]!,
          clearance: 0.1,
          layerCount: 2,
        }),
      ).toBe(false)
      expect(
        doPipeline9RoutesHaveCopperConflict({
          left: screened.solvedRoutes[0]!,
          right: screened.solvedRoutes[1]!,
          clearance: 0.1,
          layerCount: 2,
        }),
      ).toBe(true)
      expect(
        (screened as unknown as { deferredSolvedAttempt: unknown })
          .deferredSolvedAttempt,
      ).toBeNull()
    }
  }

  const aliasedConnMap = new ConnectivityMap({})
  aliasedConnMap.addConnections([["connection0", "connection1", "connection2"]])
  const aliased = createGrow(1, {
    nodeWithPortPoints: createNode(0.8, 1.2, 0.2),
    connMap: aliasedConnMap,
  })
  const aliasScenario = createScenario(1)
  runScenario(aliased, aliasScenario)
  expect(aliased.growthAttempts).toBe(1)
  expect(aliasScenario.deferredIterations).toBeNull()
  expect(aliased.failedSolvers).toHaveLength(0)

  const missingConnMap = createGrow(1, { connMap: undefined })
  const missingConnMapScenario = createScenario(null)
  runScenario(missingConnMap, missingConnMapScenario)
  expect(missingConnMap.failedSolvers).toEqual(
    missingConnMapScenario.records.map(({ solver }) => solver),
  )
  expect(missingConnMapScenario.suspendedIterations).toBeNull()

  for (const maximum of [0, 1, 3]) {
    const exhausted = createGrow(maximum)
    const scenario = createScenario(null)
    runScenario(exhausted, scenario)
    expect(exhausted.failed).toBe(true)
    expect(exhausted.failedSolvers).toHaveLength(maximum + 1)
    expect(new Set(exhausted.failedSolvers)).toHaveProperty("size", maximum + 1)
    expect(
      scenario.records.map(({ growthAttempts }) => growthAttempts),
    ).toEqual(Array.from({ length: maximum + 1 }, (_, index) => index))
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
    (
      spacious as unknown as {
        activeAttemptFrame: { spaciousNode: boolean }
      }
    ).activeAttemptFrame.spaciousNode,
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
