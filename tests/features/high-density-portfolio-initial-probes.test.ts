import { expect, test } from "bun:test"
import type { BaseSolver } from "lib/solvers/BaseSolver"
import { CachedIntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/CachedIntraNodeRouteSolver"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import {
  HyperParameterSupervisorSolver,
  type SupervisedSolver,
} from "lib/solvers/HyperParameterSupervisorSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

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

function createPortfolio(): PortfolioSingleIntraNodeSolver {
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
  })
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
  const defaults = originalEntries.filter(
    ({ solver }) => solver instanceof CachedIntraNodeRouteSolver,
  ).slice(0, 2)
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
    originalEntries.slice(originalPrefixEnd).filter(
      (candidate) => ![coarse, a01, a03].includes(candidate),
    ),
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

  const declared = new DeclaredOrderPortfolio(portfolio.constructorParams)
  declared.initializeSolvers()
  expect(
    declared.supervisedSolvers!.map(({ hyperParameters }) => hyperParameters),
  ).toEqual(
    originalEntries.map(({ hyperParameters }) => hyperParameters),
  )
  expect(declared.MAX_ITERATIONS).toBe(portfolio.MAX_ITERATIONS)
  expect(declared.stats.dynamicExpansionWorkBudget).toBe(expectedWorkBudget)
  expect(
    declared.supervisedSolvers!.map(({ solver }) => solver.MAX_ITERATIONS),
  ).toEqual(
    originalEntries.map(({ solver }) => solver.MAX_ITERATIONS),
  )
  const customFitness = new CustomFitnessPortfolio(portfolio.constructorParams)
  customFitness.initializeSolvers()
  expect(
    customFitness.supervisedSolvers!.map(
      ({ hyperParameters }) => hyperParameters,
    ),
  ).toEqual(
    originalEntries.map(({ hyperParameters }) => hyperParameters),
  )

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
