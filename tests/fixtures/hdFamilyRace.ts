import { HighDensitySolverA03 } from "@tscircuit/high-density-a01"
import type {
  HighDensityIntraNodeRoute,
  NodeWithPortPoints,
} from "../../lib/types/high-density-types"
import { IntraNodeRouteSolver } from "../../lib/solvers/HighDensitySolver/IntraNodeSolver"
import { PortfolioSingleIntraNodeSolver } from "../../lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import { GrowShrinkHighDensityIntraNodeSolver } from "../../lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver/GrowShrinkHighDensityIntraNodeSolver"

type Plan = { completeAfter: number; budget: number; throwAt?: number }
type PortfolioParams = ConstructorParameters<
  typeof PortfolioSingleIntraNodeSolver
>[0]

type HarnessOptions = {
  plans: Record<number, Plan>
  makeOtherBest?: boolean
  onStep?: (scale: number, portfolio: ScriptedPortfolio) => void
  validator?: (routes: HighDensityIntraNodeRoute[]) => boolean
  params?: Partial<
    ConstructorParameters<typeof GrowShrinkHighDensityIntraNodeSolver>[0]
  >
}

export const raceNode: NodeWithPortPoints = {
  capacityMeshNodeId: "crowded-boundary",
  center: { x: 0, y: 0 },
  width: 10,
  height: 10,
  availableZ: [0, 1, 2, 3],
  portPoints: Array.from({ length: 8 }, (_, i) => [
    {
      connectionName: `c${i}`,
      rootConnectionName: `net${i}`,
      x: -5,
      y: i * 0.15,
      z: 0,
    },
    {
      connectionName: `c${i}`,
      rootConnectionName: `net${i}`,
      x: 5,
      y: i * 0.15,
      z: 1,
    },
  ]).flat(),
}

class ScriptedA03 extends HighDensitySolverA03 {
  constructor(
    node: NodeWithPortPoints,
    readonly plan: Plan,
  ) {
    super({ nodeWithPortPoints: node, viaDiameter: 0.3 })
    this.MAX_ITERATIONS = plan.budget
  }

  override _setup(): void {
    this["solvedRoutes"] = []
    this["unsolvedSegs"] = []
    this.availableZ = [...this.nodeWithPortPoints.availableZ!]
    this.progress = 0
    this.error = null
    this.stats.setupCount = (this.stats.setupCount ?? 0) + 1
  }

  override _step(): void {
    if (this.iterations === this.plan.throwAt) {
      throw new Error("scripted A03 failure")
    }
    if (this.iterations >= this.plan.completeAfter) {
      this.solved = true
      this.progress = 1
    }
  }

  override getOutput(): HighDensityIntraNodeRoute[] {
    const routes: HighDensityIntraNodeRoute[] = []
    const ports = this.nodeWithPortPoints.portPoints
    for (let i = 0; i < ports.length; i += 2) {
      const start = ports[i]!
      const end = ports[i + 1]!
      const via = { x: (start.x + end.x) / 2, y: start.y }
      routes.push({
        connectionName: start.connectionName,
        rootConnectionName: start.rootConnectionName,
        traceThickness: 0.1,
        viaDiameter: 0.3,
        route: [start, { ...via, z: start.z }, { ...via, z: end.z }, end],
        vias: [via],
      })
    }
    return routes
  }
}

class ScriptedOther extends IntraNodeRouteSolver {
  constructor(node: NodeWithPortPoints) {
    super({ nodeWithPortPoints: node })
    this.MAX_ITERATIONS = 2
  }

  override _step(): void {
    this.progress = 0
    this.stats.visits = (this.stats.visits ?? 0) + 1
    this.stats.observedLimit = this.MAX_ITERATIONS
    this.stats.observedIterations = this.iterations
    this.stats.neverAccepts = true
  }
}

export class ScriptedPortfolio extends PortfolioSingleIntraNodeSolver {
  readonly native: ScriptedA03
  readonly other: ScriptedOther
  onSolveCalls = 0

  constructor(
    params: PortfolioParams,
    readonly scale: number,
    readonly options: HarnessOptions,
  ) {
    super(params)
    const plan = options.plans[scale]
    if (!plan) throw new Error(`Missing scripted scale ${scale}`)
    this.native = new ScriptedA03(params.nodeWithPortPoints, plan)
    this.native.setup()
    this.other = new ScriptedOther(params.nodeWithPortPoints)
    this.MIN_SUBSTEPS = 1
    this.adaptiveSearchExpanded = true
    this.supervisedSolvers = [
      { solver: this.native, hyperParameters: {}, f: 0, g: 0, h: 0 },
      { solver: this.other, hyperParameters: {}, f: 1000, g: 1000, h: 0 },
    ]
  }

  override _step(): void {
    super._step()
    if (this.options.makeOtherBest && !this.solved) {
      this.supervisedSolvers![1]!.f = -100
    }
    this.options.onStep?.(this.scale, this)
  }

  override onSolve(
    candidate: Parameters<PortfolioSingleIntraNodeSolver["onSolve"]>[0],
  ): void {
    this.onSolveCalls++
    super.onSolve(candidate)
    this.stats.observedOnSolve = true
    this.stats.observedWinner = candidate.solver.getSolverName()
    this.stats.observedOutputCount = this.solvedRoutes.length
  }
}

export function createRaceHarness(options: HarnessOptions): {
  solver: GrowShrinkHighDensityIntraNodeSolver
  portfolios: Map<number, ScriptedPortfolio>
  created: number[]
} {
  const solver = new GrowShrinkHighDensityIntraNodeSolver({
    nodeWithPortPoints: structuredClone(raceNode),
    traceWidth: 0.1,
    viaDiameter: 0.3,
    obstacleMargin: 0.15,
    rejectOverlappingTerminals: true,
    growShrinkSolutionValidator: options.validator,
    ...options.params,
  })
  const portfolios = new Map<number, ScriptedPortfolio>()
  const created: number[] = []
  solver["createActiveSubSolver"] = function (): void {
    const scale = this.scaleFactor
    const node = this.nodeWithPortPoints
    const scaled = {
      ...node,
      width: node.width * scale,
      height: node.height * scale,
      portPoints: node.portPoints.map((point) => ({
        ...point,
        x: point.x * scale,
        y: point.y * scale,
      })),
    }
    const portfolio = new ScriptedPortfolio(
      { ...this.constructorParams, nodeWithPortPoints: scaled },
      scale,
      options,
    )
    this.activeSubSolver = portfolio
    portfolios.set(scale, portfolio)
    created.push(scale)
  }
  return { solver, portfolios, created }
}
