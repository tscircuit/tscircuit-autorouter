import { PortfolioSingleIntraNodeSolver } from "../../lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import { GrowShrinkHighDensityIntraNodeSolver } from "../../lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver/GrowShrinkHighDensityIntraNodeSolver"
import type { HyperParameterDef } from "../../lib/solvers/HyperParameterSupervisorSolver"

export const POLICY_NAMES = [
  "baseline",
  "bounded-growth",
  "coarse-first",
  "stagnation-growth",
  "reduced-breadth",
] as const

export type PolicyName = (typeof POLICY_NAMES)[number]
export type PolicyTarget =
  | PortfolioSingleIntraNodeSolver
  | GrowShrinkHighDensityIntraNodeSolver

export type PolicyOptions = {
  shouldApply?: (solver: PolicyTarget) => boolean
}

export type PolicyEvent = {
  type: "scale-start" | "scale-end" | "coarse-head-start" | "candidate-pruned"
  policy: PolicyName
  portfolioId: number
  nodeId: string
  scale: number | null
  atMs: number
  elapsedMs?: number
  work?: number
  bestCompleted?: number
  solved?: boolean
  failed?: boolean
  reason?: string | null
  shuffleSeed?: number
}

export type InstalledPolicy = {
  metadata: (typeof POLICY_METADATA)[PolicyName]
  events: PolicyEvent[]
  restore: () => void
}

export const POLICY_METADATA = {
  baseline: {
    name: "baseline",
    title: "Unchanged portfolio",
    description: "Original candidate set, fitness scheduling, and growth policy.",
  },
  "bounded-growth": {
    name: "bounded-growth",
    title: "Bound work before growing",
    description: "End an unsolved scale after 2,000,000 aggregate candidate iterations; retain the existing resize schedule and solution validation.",
    aggregateWorkBudget: 2_000_000,
  },
  "coarse-first": {
    name: "coarse-first",
    title: "Give the coarse grid a head start",
    description: "Give the existing CELL_SIZE_FACTOR=2, VIA_PENALTY_FACTOR_2=10 candidate up to 50,000 inner iterations before normal fitness scheduling.",
    headStartIterations: 50_000,
  },
  "stagnation-growth": {
    name: "stagnation-growth",
    title: "Grow after completed-connection progress stalls",
    description: "After 1,000,000 aggregate candidate iterations, end an unsolved scale if its best completed-connection count has not improved for 500,000 iterations. Check every 64 portfolio steps.",
    warmupWork: 1_000_000,
    stagnationWork: 500_000,
    checkEveryPortfolioSteps: 64,
  },
  "reduced-breadth": {
    name: "reduced-breadth",
    title: "Try fewer route orderings",
    description: "Keep grid shuffle seeds 0–1 and 100–103, and A01 seeds 0–1. Preserve all solver families and geometry parameters.",
    gridOrderingCount: 2,
    extraGridOrderingCount: 4,
    a01OrderingCount: 2,
  },
} as const

type Candidate = NonNullable<
  PortfolioSingleIntraNodeSolver["supervisedSolvers"]
>[number]

type PortfolioRuntimePrototype = {
  _step: (this: PortfolioSingleIntraNodeSolver) => void
  getSupervisedSolverWithBestFitness: (
    this: PortfolioSingleIntraNodeSolver,
  ) => Candidate | null
  getHyperParameterDefs: (
    this: PortfolioSingleIntraNodeSolver,
  ) => HyperParameterDef[]
  addSupervisedCandidate: (
    this: PortfolioSingleIntraNodeSolver,
    hyperParameters: Record<string, unknown>,
  ) => void
}

type GrowRuntimePrototype = {
  createActiveSubSolver: (
    this: GrowShrinkHighDensityIntraNodeSolver,
  ) => void
}

type PortfolioState = {
  id: number
  nodeId: string
  scale: number | null
  eligible: boolean
  startedAt: number
  lastCheckIteration: number
  bestCompleted: number
  lastImprovementWork: number
  headStartRecorded: boolean
  ended: boolean
}

let activeInstallation: PolicyName | null = null

function totalCandidateWork(portfolio: PortfolioSingleIntraNodeSolver): number {
  let work = 0
  for (const entry of portfolio.supervisedSolvers ?? []) {
    work += entry.solver.iterations
  }
  return work
}

function bestCompletedConnections(
  portfolio: PortfolioSingleIntraNodeSolver,
): number {
  let best = 0
  for (const { solver } of portfolio.supervisedSolvers ?? []) {
    const candidate = solver as unknown as {
      solvedConnectionsMap?: Map<unknown, unknown>
      solvedRoutes?: unknown[]
    }
    let completed = 0
    // A01/A03 also expose provisional route objects: only their committed map
    // counts as completed work. Counting solvedRoutes there would hide rips.
    if (candidate.solvedConnectionsMap instanceof Map) {
      for (const routes of candidate.solvedConnectionsMap.values()) {
        if (!Array.isArray(routes)) {
          throw new Error("Expected route arrays in solvedConnectionsMap")
        }
        completed += routes.length
      }
    } else if (candidate.solvedRoutes !== undefined) {
      completed = candidate.solvedRoutes.length
    }
    best = Math.max(best, completed)
  }
  return best
}

/**
 * Install exactly one process-local experimental policy before constructing or
 * stepping the measured solvers. Restore after the run. These reversible hooks
 * deliberately leave the production checkout unchanged. Existing growth,
 * shrink-back, route validation, and terminal failure logic remain in charge.
 */
export function installPolicy(
  name: PolicyName,
  options: PolicyOptions = {},
): InstalledPolicy {
  if (!POLICY_NAMES.includes(name)) {
    throw new Error(`Unknown search policy: ${name}`)
  }
  if (activeInstallation !== null) {
    throw new Error(`Search policy ${activeInstallation} is already installed`)
  }
  activeInstallation = name

  // TypeScript-private methods compile to ordinary prototype methods here.
  // Keep their casts at this experimental boundary rather than changing source.
  const portfolioPrototype = PortfolioSingleIntraNodeSolver.prototype as unknown as PortfolioRuntimePrototype
  const growPrototype = GrowShrinkHighDensityIntraNodeSolver.prototype as unknown as GrowRuntimePrototype
  const original = {
    step: portfolioPrototype._step,
    select: portfolioPrototype.getSupervisedSolverWithBestFitness,
    definitions: portfolioPrototype.getHyperParameterDefs,
    addCandidate: portfolioPrototype.addSupervisedCandidate,
    create: growPrototype.createActiveSubSolver,
  }
  const events: PolicyEvent[] = []
  const states = new WeakMap<PortfolioSingleIntraNodeSolver, PortfolioState>()
  let nextPortfolioId = 0
  let restored = false

  function stateFor(
    portfolio: PortfolioSingleIntraNodeSolver,
    grow?: GrowShrinkHighDensityIntraNodeSolver,
  ): PortfolioState {
    const existing = states.get(portfolio)
    if (existing) return existing
    const state: PortfolioState = {
      id: nextPortfolioId++,
      nodeId: portfolio.nodeWithPortPoints.capacityMeshNodeId,
      scale: grow ? grow.scaleFactor : null,
      eligible: options.shouldApply ? options.shouldApply(grow ?? portfolio) : true,
      startedAt: performance.now(),
      lastCheckIteration: 0,
      bestCompleted: 0,
      lastImprovementWork: 0,
      headStartRecorded: false,
      ended: false,
    }
    states.set(portfolio, state)
    events.push({
      type: "scale-start",
      policy: name,
      portfolioId: state.id,
      nodeId: state.nodeId,
      scale: state.scale,
      atMs: state.startedAt,
    })
    return state
  }

  function endScale(
    portfolio: PortfolioSingleIntraNodeSolver,
    state: PortfolioState,
  ): void {
    if (state.ended || (!portfolio.solved && !portfolio.failed)) return
    state.ended = true
    const atMs = performance.now()
    const work = totalCandidateWork(portfolio)
    const bestCompleted = bestCompletedConnections(portfolio)
    portfolio.stats.experimentalSearchPolicy = {
      name,
      eligible: state.eligible,
      candidateWork: work,
      bestCompleted,
    }
    events.push({
      type: "scale-end",
      policy: name,
      portfolioId: state.id,
      nodeId: state.nodeId,
      scale: state.scale,
      atMs,
      elapsedMs: atMs - state.startedAt,
      work,
      bestCompleted,
      solved: portfolio.solved,
      failed: portfolio.failed,
      reason: portfolio.error,
    })
  }

  growPrototype.createActiveSubSolver = function (): void {
    original.create.call(this)
    if (!this.activeSubSolver) {
      throw new Error("Grow/shrink did not create its portfolio")
    }
    stateFor(this.activeSubSolver, this)
  }

  portfolioPrototype._step = function (): void {
    const state = stateFor(this)
    original.step.call(this)

    if (state.eligible && !this.solved && !this.failed) {
      if (name === "bounded-growth") {
        const work = totalCandidateWork(this)
        if (work >= POLICY_METADATA[name].aggregateWorkBudget) {
          this.failed = true
          this.error = `Experimental aggregate work budget exhausted at ${work} candidate iterations`
        }
      } else if (
        name === "stagnation-growth" &&
        this.iterations - state.lastCheckIteration >= POLICY_METADATA[name].checkEveryPortfolioSteps
      ) {
        state.lastCheckIteration = this.iterations
        const work = totalCandidateWork(this)
        const completed = bestCompletedConnections(this)
        if (completed > state.bestCompleted) {
          state.bestCompleted = completed
          state.lastImprovementWork = work
        }
        if (
          work >= POLICY_METADATA[name].warmupWork &&
          work - state.lastImprovementWork >= POLICY_METADATA[name].stagnationWork
        ) {
          this.failed = true
          this.error = `Experimental progress budget exhausted after ${work - state.lastImprovementWork} candidate iterations without improving beyond ${state.bestCompleted} completed connections`
        }
      }
    }
    endScale(this, state)
  }

  portfolioPrototype.getSupervisedSolverWithBestFitness = function (): Candidate | null {
    const state = stateFor(this)
    if (name !== "coarse-first" || !state.eligible) {
      return original.select.call(this)
    }
    // Preserve the original rule that a completed candidate wins immediately.
    const solved = this.supervisedSolvers?.find(({ solver }) => solver.solved)
    if (solved) return solved
    const coarse = this.supervisedSolvers?.find(({ hyperParameters }) =>
      hyperParameters.CELL_SIZE_FACTOR === 2 &&
      hyperParameters.VIA_PENALTY_FACTOR_2 === 10,
    )
    if (
      coarse &&
      !coarse.solver.failed &&
      coarse.solver.iterations < POLICY_METADATA[name].headStartIterations
    ) {
      if (!state.headStartRecorded) {
        state.headStartRecorded = true
        events.push({
          type: "coarse-head-start",
          policy: name,
          portfolioId: state.id,
          nodeId: state.nodeId,
          scale: state.scale,
          atMs: performance.now(),
        })
      }
      return coarse
    }
    return original.select.call(this)
  }

  portfolioPrototype.getHyperParameterDefs = function (): HyperParameterDef[] {
    const definitions = original.definitions.call(this)
    const state = stateFor(this)
    if (name !== "reduced-breadth" || !state.eligible) return definitions
    return definitions.map((definition) => {
      if (definition.name === "orderings6") {
        return {
          ...definition,
          possibleValues: definition.possibleValues.slice(0, POLICY_METADATA[name].gridOrderingCount),
        }
      }
      if (definition.name === "orderings50") {
        return {
          ...definition,
          possibleValues: definition.possibleValues.slice(0, POLICY_METADATA[name].extraGridOrderingCount),
        }
      }
      return definition
    })
  }

  portfolioPrototype.addSupervisedCandidate = function (
    hyperParameters: Record<string, unknown>,
  ): void {
    const state = stateFor(this)
    if (
      name === "reduced-breadth" &&
      state.eligible &&
      hyperParameters.HIGH_DENSITY_A01 === true
    ) {
      const seed = hyperParameters.SHUFFLE_SEED
      if (typeof seed !== "number") {
        throw new Error("Adaptive A01 candidate is missing its shuffle seed")
      }
      if (seed >= POLICY_METADATA[name].a01OrderingCount) {
        events.push({
          type: "candidate-pruned",
          policy: name,
          portfolioId: state.id,
          nodeId: state.nodeId,
          scale: state.scale,
          atMs: performance.now(),
          shuffleSeed: seed,
        })
        return
      }
    }
    original.addCandidate.call(this, hyperParameters)
  }

  return {
    metadata: POLICY_METADATA[name],
    events,
    restore(): void {
      if (restored) return
      restored = true
      portfolioPrototype._step = original.step
      portfolioPrototype.getSupervisedSolverWithBestFitness = original.select
      portfolioPrototype.getHyperParameterDefs = original.definitions
      portfolioPrototype.addSupervisedCandidate = original.addCandidate
      growPrototype.createActiveSubSolver = original.create
      activeInstallation = null
    },
  }
}
