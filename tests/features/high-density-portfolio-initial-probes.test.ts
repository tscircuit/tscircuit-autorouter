import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { AutoroutingPipelineSolver9_Networked } from "lib/autorouter-pipelines/AutoroutingPipeline9_Networked/AutoroutingPipelineSolver9_Networked"
import { Pipeline9NetworkedHighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Networked/Pipeline9NetworkedHighDensitySolver"
import type { Pipeline9NetworkedHighDensityNodeInput } from "lib/autorouter-pipelines/AutoroutingPipeline9_Networked/pipeline9NetworkedTypes"
import { solvePipeline9NetworkedHighDensityNode } from "lib/autorouter-pipelines/AutoroutingPipeline9_Networked/solvePipeline9NetworkedHighDensityNode"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import {
  createPipeline9RegularNodeSolver,
  Pipeline9HighDensitySolver,
  type Pipeline9HighDensitySolverParams,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { Pipeline9RegionalFallbackSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9RegionalFallbackSolver"
import type { BaseSolver } from "lib/solvers/BaseSolver"
import { CachedIntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/CachedIntraNodeRouteSolver"
import { HighDensitySolver } from "lib/solvers/HighDensitySolver/HighDensitySolver"
import { CachedPortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/CachedPortfolioSingleIntraNodeSolver"
import { GrowShrinkHighDensityIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import {
  HyperParameterSupervisorSolver,
  type SupervisedSolver,
} from "lib/solvers/HyperParameterSupervisorSolver"
import type { ChangedPreloadedTraceSection } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import type { SimpleRouteJson } from "lib/types/srj-types"

type Candidate = SupervisedSolver<BaseSolver>
type CapturedCandidate = {
  entry: Candidate
  solver: BaseSolver
  iterations: number
  maxIterations: number
  g: number
  h: number
  f: number
}

class DeclaredOrderPortfolio extends PortfolioSingleIntraNodeSolver {
  override getCombinationDefs(): string[][] {
    const definitions = super.getCombinationDefs()
    // A custom declaration must retain its ordering even when its values
    // happen to match the built-in portfolio.
    return definitions.map((definition) => [...definition])
  }
}

class CustomFitnessPortfolio extends PortfolioSingleIntraNodeSolver {
  override computeF(g: number, h: number): number {
    const greedyMultiplier = this.GREEDY_MULTIPLIER
    const weightedProgress = h * greedyMultiplier
    // Preserve a subclass's deliberate fitness policy and declaration order.
    const fitness = g + weightedProgress
    return fitness
  }
}

function createPortfolio(
  prioritizeInitialPortfolioProbes: boolean | undefined = true,
): PortfolioSingleIntraNodeSolver {
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "initial-probe-node",
    center: { x: 0, y: 0 },
    width: 2,
    height: 2,
    availableZ: [0, 1],
    portPoints: [
      { x: -1, y: -0.5, z: 0, connectionName: "a" },
      { x: 1, y: -0.5, z: 0, connectionName: "a" },
      { x: -1, y: 0.5, z: 0, connectionName: "b" },
      { x: 1, y: 0.5, z: 0, connectionName: "b" },
    ],
  }
  return new PortfolioSingleIntraNodeSolver({
    nodeWithPortPoints: node,
    traceWidth: 0.15,
    viaDiameter: 0.3,
    obstacleMargin: 0.1,
    effort: 1,
    prioritizeInitialPortfolioProbes,
  })
}

function getOwnerParams(
  withPreload: boolean,
  networked: boolean,
): Pipeline9HighDensitySolverParams {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.15,
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    obstacles: [],
    connections: [],
    traces: withPreload
      ? [
          {
            type: "pcb_trace",
            pcb_trace_id: "original-preload",
            connection_name: "fixed",
            route: [
              {
                route_type: "wire",
                x: -1,
                y: 0,
                width: 0.1,
                layer: "bottom",
              },
              {
                route_type: "wire",
                x: 1,
                y: 0,
                width: 0.1,
                layer: "bottom",
              },
            ],
          },
        ]
      : [],
  }
  const pipeline = networked
    ? new AutoroutingPipelineSolver9_Networked(srj)
    : new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj)
  // Script only the completed pathing output. The original preload is wholly
  // changed, so filtered fixedHdRoutes is empty despite the original copper.
  const changedPreloadedTraceSections: ChangedPreloadedTraceSection[] =
    withPreload
      ? [
          {
            connectionName:
              "preloaded_trace_0" as ChangedPreloadedTraceSection["connectionName"],
            traceId: "original-preload",
            startRoutePosition: 0,
            endRoutePosition: 1,
            connection: { name: "fixed", pointsToConnect: [] },
          },
        ]
      : []
  pipeline.portPointPathingSolver = {
    getOutput: () => ({
      nodesWithPortPoints: [createPortfolio().nodeWithPortPoints],
      inputNodeWithPortPoints: [],
      changedPreloadedTraceSections,
    }),
    computeNodePfMap: () => new Map(),
  } as unknown as NonNullable<typeof pipeline.portPointPathingSolver>
  const step = pipeline.pipelineDef.find(
    ({ solverName }) => solverName === "highDensityRouteSolver",
  )
  if (!step) throw new Error("Pipeline9 must retain its high-density stage")
  return step.getConstructorParams(
    pipeline,
  )[0] as Pipeline9HighDensitySolverParams
}

function scriptCandidates(
  portfolio: PortfolioSingleIntraNodeSolver,
  sequence: BaseSolver[],
  winner: BaseSolver | null,
): void {
  for (const { solver } of portfolio.supervisedSolvers!) {
    solver.solved = false
    solver.failed = !(solver instanceof CachedIntraNodeRouteSolver)
    solver.progress = 0
    solver.iterations = 0
    solver._step = function (): void {
      if (this.iterations === 1) sequence.push(this)
      if (this === winner) {
        this.solved = true
        ;(this as CachedIntraNodeRouteSolver).solvedRoutes = []
      } else {
        this.progress = 0
      }
    }
  }
  for (const candidate of portfolio.supervisedSolvers!) {
    candidate.g = portfolio.computeG(candidate.solver as never)
    candidate.h = 0
    candidate.f = candidate.g
  }
}

test("early HD probes preserve candidates, work and search limits", () => {
  const portfolio = createPortfolio()
  let originalEntries: Candidate[] = []
  let capturedCandidates: CapturedCandidate[] = []
  const supervisorPrototype = HyperParameterSupervisorSolver.prototype
  const originalInitialize = supervisorPrototype.initializeSolvers
  supervisorPrototype.initializeSolvers = function (): void {
    originalInitialize.call(this)
    if (this === portfolio) {
      originalEntries = [...this.supervisedSolvers!] as Candidate[]
      capturedCandidates = originalEntries.map((entry) => ({
        entry,
        solver: entry.solver,
        iterations: entry.solver.iterations,
        maxIterations: entry.solver.MAX_ITERATIONS,
        g: entry.g,
        h: entry.h,
        f: entry.f,
      }))
    }
  }
  try {
    portfolio.initializeSolvers()
  } finally {
    supervisorPrototype.initializeSolvers = originalInitialize
  }

  const candidates = portfolio.supervisedSolvers! as Candidate[]
  expect(candidates).toHaveLength(originalEntries.length)
  expect(new Set(candidates)).toEqual(new Set(originalEntries))
  const defaults = originalEntries
    .filter(({ solver }) => solver instanceof CachedIntraNodeRouteSolver)
    .slice(0, 2)
  const coarse = originalEntries.find(
    ({ hyperParameters }) => hyperParameters.CELL_SIZE_FACTOR === 2,
  )!
  const a01 = originalEntries.find(
    ({ hyperParameters }) => hyperParameters.HIGH_DENSITY_A01,
  )!
  const a03 = originalEntries.find(
    ({ hyperParameters }) => hyperParameters.HIGH_DENSITY_A03,
  )!
  const originalPrefixEnd = originalEntries.indexOf(defaults[1]!) + 1
  expect(candidates.slice(0, originalPrefixEnd)).toEqual(
    originalEntries.slice(0, originalPrefixEnd),
  )
  expect(candidates.slice(originalPrefixEnd, originalPrefixEnd + 3)).toEqual([
    coarse,
    a01,
    a03,
  ])
  expect(candidates.slice(originalPrefixEnd + 3)).toEqual(
    originalEntries
      .slice(originalPrefixEnd)
      .filter((candidate) => ![coarse, a01, a03].includes(candidate)),
  )
  for (const original of capturedCandidates) {
    expect(original.entry.solver).toBe(original.solver)
    expect(original.solver.iterations).toBe(original.iterations)
    expect(original.entry.g).toBe(original.g)
    expect(original.entry.h).toBe(original.h)
    expect(original.entry.f).toBe(original.f)
    // Native setup can size external limits; every legacy candidate keeps
    // the original cap captured before setup as well as before reordering.
    if (original.solver instanceof CachedIntraNodeRouteSolver) {
      expect(original.solver.MAX_ITERATIONS).toBe(original.maxIterations)
    }
  }
  expect(portfolio.MIN_SUBSTEPS).toBe(100)
  const expectedWorkBudget = Math.max(
    ...originalEntries.map(({ solver }) => solver.MAX_ITERATIONS),
  )
  expect(portfolio.stats.dynamicExpansionWorkBudget).toBe(expectedWorkBudget)

  const declared = new DeclaredOrderPortfolio({
    ...portfolio.constructorParams,
    prioritizeInitialPortfolioProbes: true,
  })
  declared.initializeSolvers()
  expect(
    declared.supervisedSolvers!.map(({ hyperParameters }) => hyperParameters),
  ).toEqual(originalEntries.map(({ hyperParameters }) => hyperParameters))
  expect(declared.MAX_ITERATIONS).toBe(portfolio.MAX_ITERATIONS)
  expect(declared.stats.dynamicExpansionWorkBudget).toBe(expectedWorkBudget)
  expect(
    declared.supervisedSolvers!.map(({ solver }) => solver.MAX_ITERATIONS),
  ).toEqual(originalEntries.map(({ solver }) => solver.MAX_ITERATIONS))
  const customFitness = new CustomFitnessPortfolio({
    ...portfolio.constructorParams,
    prioritizeInitialPortfolioProbes: true,
  })
  customFitness.initializeSolvers()
  expect(
    customFitness.supervisedSolvers!.map(
      ({ hyperParameters }) => hyperParameters,
    ),
  ).toEqual(originalEntries.map(({ hyperParameters }) => hyperParameters))

  const cachedPortfolio = new CachedPortfolioSingleIntraNodeSolver({
    ...portfolio.constructorParams,
    prioritizeInitialPortfolioProbes: true,
    cacheProvider: null,
  })
  cachedPortfolio.initializeSolvers()
  expect(
    cachedPortfolio.supervisedSolvers!.map(
      ({ hyperParameters }) => hyperParameters,
    ),
  ).toEqual(originalEntries.map(({ hyperParameters }) => hyperParameters))
  const defaultCachedPortfolio = new CachedPortfolioSingleIntraNodeSolver({
    ...portfolio.constructorParams,
    cacheProvider: null,
  })
  expect(cachedPortfolio.computeCacheKeyAndTransform().cacheKey).toBe(
    defaultCachedPortfolio.computeCacheKeyAndTransform().cacheKey,
  )
  expect(
    "prioritizeInitialPortfolioProbes" in portfolio.constructorParams,
  ).toBe(false)
  for (const permission of [undefined, false]) {
    const defaultPortfolio = new PortfolioSingleIntraNodeSolver({
      ...portfolio.constructorParams,
      ...(permission === undefined
        ? {}
        : { prioritizeInitialPortfolioProbes: permission }),
    })
    defaultPortfolio.initializeSolvers()
    if (permission === undefined) {
      expect(defaultPortfolio.constructorParams).not.toHaveProperty(
        "prioritizeInitialPortfolioProbes",
      )
    }
    expect(defaultPortfolio.prioritizeInitialPortfolioProbes).toBe(false)
    expect(
      defaultPortfolio.supervisedSolvers!.map(
        ({ hyperParameters }) => hyperParameters,
      ),
    ).toEqual(originalEntries.map(({ hyperParameters }) => hyperParameters))
    expect(defaultPortfolio.MAX_ITERATIONS).toBe(portfolio.MAX_ITERATIONS)
    expect(defaultPortfolio.stats.dynamicExpansionWorkBudget).toBe(
      expectedWorkBudget,
    )
    const nativeLeaves = defaultPortfolio.supervisedSolvers!.filter(
      ({ solver }) => solver instanceof CachedIntraNodeRouteSolver,
    )
    for (const candidate of candidates) {
      if (!(candidate.solver instanceof CachedIntraNodeRouteSolver)) continue
      const nativeCandidate = nativeLeaves.find(
        ({ hyperParameters }) =>
          JSON.stringify(hyperParameters) ===
          JSON.stringify(candidate.hyperParameters),
      )
      if (!(nativeCandidate?.solver instanceof CachedIntraNodeRouteSolver)) {
        throw new Error("Every cached leaf must retain its native counterpart")
      }
      expect(candidate.solver.computeCacheKeyAndTransform().cacheKey).toBe(
        nativeCandidate.solver.computeCacheKeyAndTransform().cacheKey,
      )
      expect(candidate.solver.MAX_ITERATIONS).toBe(
        nativeCandidate.solver.MAX_ITERATIONS,
      )
    }
  }

  for (const networked of [false, true]) {
    const traceFreeParams = getOwnerParams(false, networked)
    expect(traceFreeParams.prioritizeInitialPortfolioProbes).toBe(true)
    const changedPreloadParams = getOwnerParams(true, networked)
    expect(changedPreloadParams.fixedHdRoutes).toHaveLength(0)
    expect(changedPreloadParams.prioritizeInitialPortfolioProbes).toBe(false)
  }
  const ownerParams = getOwnerParams(false, false)
  const directPipeline9 = new Pipeline9HighDensitySolver({
    ...ownerParams,
    prioritizeInitialPortfolioProbes: undefined,
  })
  expect(directPipeline9.prioritizeInitialPortfolioProbes).toBe(false)
  const regularParams = {
    nodeWithPortPoints: portfolio.nodeWithPortPoints,
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
  expect(defaultRegular.prioritizeInitialPortfolioProbes).toBe(false)
  const regular = createPipeline9RegularNodeSolver({
    ...regularParams,
    prioritizeInitialPortfolioProbes: true,
  })
  regular.step()
  const growth = regular.activeSubSolver
  if (!(growth instanceof GrowShrinkHighDensityIntraNodeSolver)) {
    throw new Error(
      "Pipeline9 regular factory must construct its growth solver",
    )
  }
  expect(growth.constructorParams.prioritizeInitialPortfolioProbes).toBe(true)
  const nativeGrowth = growth as unknown as {
    createActiveSubSolver: () => void
  }
  nativeGrowth.createActiveSubSolver()
  const child = growth.activeSubSolver
  if (!(child instanceof PortfolioSingleIntraNodeSolver)) {
    throw new Error("The regular growth attempt must own its native portfolio")
  }
  expect(child.prioritizeInitialPortfolioProbes).toBe(true)
  expect("prioritizeInitialPortfolioProbes" in child.constructorParams).toBe(
    false,
  )
  const regional = new Pipeline9RegionalFallbackSolver(regularParams)
  expect(regional.highDensitySolver.prioritizeInitialPortfolioProbes).toBe(
    false,
  )
  const capturedRemotePermissions: boolean[] = []
  const nativeSolve = HighDensitySolver.prototype.solve
  HighDensitySolver.prototype.solve = function (): void {
    capturedRemotePermissions.push(this.prioritizeInitialPortfolioProbes)
    // Capture the factory configuration without running a board solver.
    expect(this.MAX_ITERATIONS).toBeGreaterThan(0)
    this.solved = true
    this.progress = 1
    this.failed = false
  }
  try {
    for (const permission of [undefined, false, true]) {
      const remote = new Pipeline9NetworkedHighDensitySolver({
        ...ownerParams,
        autorouterVersion: "probe-policy-test",
        prioritizeInitialPortfolioProbes: permission,
      })
      const input = (
        remote as unknown as {
          createNodeInput: (
            node: NodeWithPortPoints,
          ) => Pipeline9NetworkedHighDensityNodeInput
        }
      ).createNodeInput(portfolio.nodeWithPortPoints)
      expect(input.prioritizeInitialPortfolioProbes).toBe(permission ?? false)
      const { prioritizeInitialPortfolioProbes: _, ...legacyInput } = input
      solvePipeline9NetworkedHighDensityNode(
        permission === undefined ? legacyInput : input,
      )
    }
  } finally {
    HighDensitySolver.prototype.solve = nativeSolve
  }
  expect(capturedRemotePermissions).toEqual([false, false, true])

  const quickSequence: BaseSolver[] = []
  scriptCandidates(portfolio, quickSequence, defaults[0]!.solver)
  portfolio.step()
  expect(portfolio.solved).toBe(true)
  expect<BaseSolver | undefined>(portfolio.winningSolver).toBe(
    defaults[0]!.solver,
  )
  expect(quickSequence).toEqual([defaults[0]!.solver])
  expect(coarse.solver.iterations).toBe(0)
  expect(a01.solver.iterations).toBe(0)
  expect(a03.solver.iterations).toBe(0)
  expect(portfolio.adaptiveSearchExpanded).toBe(false)

  const failing = createPortfolio()
  failing.initializeSolvers()
  const failingEntries = failing.supervisedSolvers! as Candidate[]
  const sequence: BaseSolver[] = []
  scriptCandidates(failing, sequence, null)
  for (const candidate of failingEntries) {
    if (
      candidate.hyperParameters.HIGH_DENSITY_A01 ||
      candidate.hyperParameters.HIGH_DENSITY_A03
    ) {
      candidate.solver.failed = false
      candidate.solver._step = function (): void {
        expect(this.iterations).toBe(1)
        expect(this.solved).toBe(false)
        expect(this.failed).toBe(false)
        sequence.push(this)
        this.failed = true
      }
    }
  }
  const eligible = failingEntries.filter(({ solver }) => !solver.failed)
  for (let index = 0; index < 6; index++) failing.step()
  expect(sequence.slice(0, 6)).toEqual(
    eligible.slice(0, 6).map(({ solver }) => solver),
  )
  expect(eligible[0]!.solver.iterations).toBe(100)
  expect(eligible[1]!.solver.iterations).toBe(100)
  expect(eligible[2]!.solver.iterations).toBe(100)
  expect(eligible[3]!.solver.iterations).toBe(1)
  expect(eligible[4]!.solver.iterations).toBe(1)
  expect(failing.failed).toBe(false)
  expect(failing.adaptiveSearchExpanded).toBe(false)

  // The original threshold still expands the same five extra orderings
  // after accounting for an actual native batch of an external candidate.
  const expanding = createPortfolio()
  expanding.initializeSolvers()
  const initialCandidateCount = expanding.supervisedSolvers!.length
  const active = expanding.supervisedSolvers!.find(
    ({ hyperParameters }) => hyperParameters.HIGH_DENSITY_A01,
  )!.solver
  active.iterations = expectedWorkBudget - 100
  active._step = function (): void {
    expect(this).toBe(active)
    expect(this.failed).toBe(false)
    expect(this.iterations).toBeLessThanOrEqual(this.MAX_ITERATIONS)
    this.progress = 0
  }
  for (const { solver } of expanding.supervisedSolvers!) {
    if (solver !== active) solver.failed = true
  }
  expanding.step()
  expect(expanding.adaptiveSearchExpanded).toBe(true)
  expect(expanding.stats.candidateWorkAtExpansion).toBe(expectedWorkBudget)
  expect(expanding.supervisedSolvers).toHaveLength(initialCandidateCount + 5)
  expect(
    expanding.supervisedSolvers!.filter(
      ({ hyperParameters }) => hyperParameters.HIGH_DENSITY_A01,
    ),
  ).toHaveLength(6)
  expect(expanding.MIN_SUBSTEPS).toBe(100)
  expect(expanding.stats.dynamicExpansionWorkBudget).toBe(expectedWorkBudget)
})
