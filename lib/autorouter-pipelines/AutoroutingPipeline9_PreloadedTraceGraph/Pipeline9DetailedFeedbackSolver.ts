import { BaseSolver } from "lib/solvers/BaseSolver"
import { TinyHypergraphPortPointPathingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import { UniformPortDistributionSolver, type UniformPortDistributionSolverInput } from "lib/solvers/UniformPortDistributionSolver/UniformPortDistributionSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import { Pipeline9HighDensitySolver, type Pipeline9HighDensitySolverParams } from "./Pipeline9HighDensitySolver"
import { arePipeline9RoutesOnSameNet, doPipeline9RoutesHaveCopperConflict } from "./pipeline9FixedRouteCopper"

export type DetailedFeedbackParams = {
  initialPathingSolver: TinyHypergraphPortPointPathingSolver
  initialDistributionSolver: UniformPortDistributionSolver
  highDensityParams: Omit<Pipeline9HighDensitySolverParams, "nodePortPoints" | "nodePfById">
  distributionParams: Omit<UniformPortDistributionSolverInput, "nodeWithPortPoints" | "inputNodesWithPortPoints">
  probeStepsPerNode?: number
  hasPreloadedCopper?: boolean
}

/** A bounded planning portfolio. An unfinished probe is UNKNOWN, never UNSAT. */
export class Pipeline9DetailedFeedbackSolver extends BaseSolver {
  selectedPathingSolver: TinyHypergraphPortPointPathingSolver
  selectedDistributionSolver: UniformPortDistributionSolver
  readonly workStats = { probeSetupMs: 0, replanSetupMs: 0, distributionSetupMs: 0,
    nativeConstructorIterations: 0, reusedPreparedTopology: false, plannerSetupMs: 0 }
  private readonly candidates: NodeWithPortPoints[]
  private readonly nodePfById: Map<string, number | null>
  private readonly prices = new Map<string, number>()
  private readonly probeLimit: number
  private probe?: Pipeline9HighDensitySolver
  private probeNode?: NodeWithPortPoints
  private replan?: TinyHypergraphPortPointPathingSolver
  private distribution?: UniformPortDistributionSolver
  private phase: "probe" | "replan" | "distribution" = "probe"

  constructor(readonly params: DetailedFeedbackParams) {
    super()
    const started = performance.now()
    if (!params.initialPathingSolver.solved || params.initialPathingSolver.failed ||
      !params.initialDistributionSolver.solved || params.initialDistributionSolver.failed)
      throw new Error("Detailed feedback requires completed upstream assignments")
    this.selectedPathingSolver = params.initialPathingSolver
    this.selectedDistributionSolver = params.initialDistributionSolver
    this.probeLimit = params.probeStepsPerNode ?? 512
    if (!Number.isSafeInteger(this.probeLimit) || this.probeLimit < 1) throw new Error("Invalid detailed-feedback probe budget")
    const nodes = params.initialDistributionSolver.getOutput()
    const pf = params.initialPathingSolver.computeNodePfMap()
    this.nodePfById = pf
    this.candidates = nodes.filter((node) => node.portPoints.length >= 4 &&
      new Set(node.portPoints.map((point) => point.rootConnectionName ?? point.connectionName)).size >= 2)
      .map((node, index) => ({ node, index, score: Math.max(0, pf.get(node.capacityMeshNodeId) ?? 0) *
        node.portPoints.length ** 2 + node.portPoints.length }))
      .sort((a, b) => b.score - a.score || a.index - b.index).slice(0, 4).map(({ node }) => node)
    const workBudget = Math.max(0, Math.floor(Math.min(4_000_000 * params.highDensityParams.effort,
      100e6 * params.highDensityParams.effort / 20)))
    this.stats = { active: true, probeNodeCount: 0, probeWork: 0, unknownProbes: 0,
      physicalConflicts: 0, feedbackRegions: 0, replansStarted: 0, replanWork: 0,
      replansCompleted: 0, changedAssignments: 0, setupWork: 0, chargedWork: 0,
      workBudget, budgetExhausted: false, selectedReplan: false,
      fixedCopperIneligible: params.hasPreloadedCopper === true || params.highDensityParams.fixedHdRoutes.length > 0 }
    this.MAX_ITERATIONS = Math.max(1, workBudget + 32)
    // Work units charge explicit setup slots plus native step counts. They
    // are not identical CPU-cost units; the benchmark charges all wall time.
    this.charge("setupWork", params.initialPathingSolver.getDetailedFeedbackSetupWork().slots +
      nodes.reduce((sum, node) => sum + 1 + node.portPoints.length, 0))
    if (this.stats.fixedCopperIneligible || !this.candidates.length || this.stats.budgetExhausted) this.solved = true
    this.workStats.plannerSetupMs = performance.now() - started
  }

  private charge(counter: "setupWork" | "probeWork" | "replanWork", work: number): void {
    if (!Number.isSafeInteger(work) || work < 0) throw new Error("Invalid detailed-feedback work receipt")
    this.stats[counter] += work
    this.stats.chargedWork += work
    this.stats.budgetExhausted = this.stats.chargedWork >= this.stats.workBudget
  }

  private assignments(nodes: NodeWithPortPoints[]): Map<string, string> {
    return new Map(nodes.map((node) => [node.capacityMeshNodeId, JSON.stringify(
      (node.portPointsInPairs ?? []).map((pair) => pair.map((point) => [point.connectionName,
        point.rootConnectionName, point.x, point.y, point.z]).sort()).sort(),
    )]))
  }

  private finishDistribution(): void {
    if (!this.replan || !this.distribution) throw new Error("Missing completed detailed-feedback proposal")
    const before = this.assignments(this.params.initialPathingSolver.getOutput().nodesWithPortPoints)
    const after = this.assignments(this.replan.getOutput().nodesWithPortPoints)
    this.charge("setupWork", before.size + after.size)
    if (this.stats.budgetExhausted) { this.solved = true; return }
    this.stats.changedAssignments = [...new Set([...before.keys(), ...after.keys()])]
      .filter((id) => before.get(id) !== after.get(id)).length
    this.selectedPathingSolver = this.replan
    this.selectedDistributionSolver = this.distribution
    this.stats.selectedReplan = true
    this.solved = true
  }

  private finishProbe(unknown: boolean): void {
    if (!this.probe || !this.probeNode) throw new Error("Missing detailed-feedback probe")
    let conflict = false
    if (!unknown) {
      for (let i = 0; i < this.probe.routes.length; i++) for (let j = i + 1; j < this.probe.routes.length; j++) {
        const left = this.probe.routes[i]!, right = this.probe.routes[j]!
        const pairWork = (left.route.length + left.vias.length + 1) *
          (right.route.length + right.vias.length + 1)
        if (this.stats.chargedWork + pairWork >= this.stats.workBudget) {
          this.stats.budgetExhausted = true
          this.solved = true
          return
        }
        this.charge("setupWork", pairWork)
        if (!arePipeline9RoutesOnSameNet(left, right, this.params.highDensityParams.connMap) &&
          doPipeline9RoutesHaveCopperConflict({ left, right,
            clearance: this.params.highDensityParams.obstacleMargin, ...this.params.highDensityParams })) conflict = true
      }
    }
    if (unknown || conflict) {
      if (unknown) this.stats.unknownProbes++
      if (conflict) this.stats.physicalConflicts++
      this.prices.set(this.probeNode.capacityMeshNodeId, unknown ? 8 : 16)
      this.stats.feedbackRegions = this.prices.size
    }
    this.probe = undefined
    this.probeNode = undefined
    this.activeSubSolver = null
  }

  override _step(): void {
    if (this.stats.budgetExhausted) { this.solved = true; return }
    if (this.phase === "probe") {
      if (this.probe) {
        this.probe.step()
        this.charge("probeWork", 1)
        // A real solver failure is not converted into another routing policy.
        if (this.probe.failed) { this.failed = true; this.error = this.probe.error; return }
        if (this.probe.solved) this.finishProbe(false)
        else if (this.probe.iterations >= this.probeLimit) this.finishProbe(true)
        return
      }
      const node = this.candidates.shift()
      if (node) {
        const setup = 1 + node.portPoints.length ** 2 + this.params.highDensityParams.obstacles.length
        if (this.stats.chargedWork + setup + this.probeLimit >= this.stats.workBudget) { this.stats.budgetExhausted = true; this.solved = true; return }
        this.charge("setupWork", setup)
        const started = performance.now()
        this.probeNode = node
        this.probe = new Pipeline9HighDensitySolver({ ...this.params.highDensityParams,
          nodePortPoints: [structuredClone(node)], nodePfById: this.nodePfById })
        this.workStats.probeSetupMs += performance.now() - started
        this.stats.probeNodeCount++
        this.activeSubSolver = this.probe
        return
      }
      if (!this.prices.size) { this.solved = true; return }
      const setup = this.params.initialPathingSolver.getDetailedFeedbackSetupWork()
      if (this.stats.chargedWork + setup.slots * 2 >= this.stats.workBudget) {
        this.stats.budgetExhausted = true; this.solved = true; return
      }
      this.charge("setupWork", setup.slots * 2)
      const started = performance.now()
      this.replan = this.params.initialPathingSolver.createDetailedFeedbackReplan(this.prices)
      this.workStats.replanSetupMs += performance.now() - started
      this.workStats.reusedPreparedTopology = true
      this.stats.replansStarted++
      this.activeSubSolver = this.replan
      this.phase = "replan"
      return
    }
    if (this.phase === "replan") {
      if (!this.replan) throw new Error("Missing detailed-feedback master")
      this.replan.step()
      this.charge("replanWork", 1)
      if (this.replan.failed) { this.failed = true; this.error = this.replan.error; return }
      if (!this.replan.solved) return
      this.stats.replansCompleted++
      const output = this.replan.getOutput()
      this.charge("setupWork", output.nodesWithPortPoints.reduce((sum, node) => sum + 1 + node.portPoints.length, 0))
      if (this.stats.budgetExhausted) { this.solved = true; return }
      const started = performance.now()
      this.distribution = new UniformPortDistributionSolver({ ...this.params.distributionParams,
        nodeWithPortPoints: output.nodesWithPortPoints, inputNodesWithPortPoints: output.inputNodeWithPortPoints })
      this.workStats.distributionSetupMs += performance.now() - started
      this.activeSubSolver = this.distribution
      this.phase = "distribution"
      return
    }
    if (!this.distribution) throw new Error("Missing detailed-feedback distribution")
    this.distribution.step()
    this.charge("replanWork", 1)
    if (this.distribution.failed) { this.failed = true; this.error = this.distribution.error; return }
    if (this.distribution.solved) this.finishDistribution()
  }
}
