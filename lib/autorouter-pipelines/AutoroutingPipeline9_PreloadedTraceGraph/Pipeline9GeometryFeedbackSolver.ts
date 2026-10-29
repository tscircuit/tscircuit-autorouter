import { BaseSolver } from "lib/solvers/BaseSolver"
import type { SharedEdgeSegment } from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import { TinyHypergraphPortPointPathingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import { UniformPortDistributionSolver } from "lib/solvers/UniformPortDistributionSolver/UniformPortDistributionSolver"
import type { CapacityMeshNode, SimpleRouteJson } from "lib/types"
import {
  auditPipeline9GeometryFeedback,
  type Pipeline9GeometryFeedbackStats,
} from "./auditPipeline9GeometryFeedback"

type GeometryFeedbackInput = {
  srj: SimpleRouteJson
  nodes: CapacityMeshNode[]
  primaryPathingSolver: TinyHypergraphPortPointPathingSolver
  primaryUniformSolver: UniformPortDistributionSolver
  primaryEffort: number
  getSegments: () => SharedEdgeSegment[]
  createPathingSolver: (
    sourcePortLayerKeys: ReadonlySet<string>,
    remainingEffortRatio: number,
  ) => TinyHypergraphPortPointPathingSolver
  createUniformSolver: (
    pathingSolver: TinyHypergraphPortPointPathingSolver,
  ) => UniformPortDistributionSolver
  stats: Pipeline9GeometryFeedbackStats
}

/** One proof-driven planning refinement, completed before any detailed search. */
export class Pipeline9GeometryFeedbackSolver extends BaseSolver {
  pathingSolver: TinyHypergraphPortPointPathingSolver
  uniformSolver: UniformPortDistributionSolver
  private phase: "audit" | "pathing" | "uniform" | "verify" = "audit"

  constructor(private input: GeometryFeedbackInput) {
    super()
    this.pathingSolver = input.primaryPathingSolver
    this.uniformSolver = input.primaryUniformSolver
    if (!this.pathingSolver.solved || this.pathingSolver.failed ||
      !this.uniformSolver.solved || this.uniformSolver.failed) {
      throw new Error("Geometry feedback requires a completed primary global assignment")
    }
    input.stats.primaryIterations = this.pathingSolver.iterations
    input.stats.primaryIterationBudget = this.pathingSolver.MAX_ITERATIONS
    input.stats.constructorCalls = 1
    this.MAX_ITERATIONS = Math.max(1,
      this.pathingSolver.MAX_ITERATIONS - this.pathingSolver.iterations) +
      this.uniformSolver.MAX_ITERATIONS + 4
  }

  _step(): void {
    const stats = this.input.stats
    if (this.phase === "audit" || this.phase === "verify") {
      const audit = auditPipeline9GeometryFeedback({
        srj: this.input.srj, nodes: this.input.nodes,
        segments: this.input.getSegments(),
        assignedNodes: this.uniformSolver.getOutput(), stats,
      })
      if (audit.usedCertificateCount === 0) {
        this.solved = true
        return
      }
      if (this.phase === "verify") {
        this.error = "Geometry feedback invariant: refined assignment still uses a certified blocked boundary"
        this.failed = true
        return
      }
      const remaining = this.pathingSolver.MAX_ITERATIONS - this.pathingSolver.iterations
      const ratio = remaining / this.pathingSolver.MAX_ITERATIONS
      // Native effort has a 0.01 floor. Do not let it create more work than the
      // remaining primary budget when almost all of that budget was consumed.
      if (remaining <= 0 || this.input.primaryEffort * ratio < 0.01) {
        this.error = "Geometry feedback proved an infeasible assignment with no remaining global planning budget"
        this.failed = true
        return
      }
      const keys = new Set(audit.certificates.flatMap((certificate) => certificate.sourcePortLayerKeys))
      stats.cuts = keys.size
      stats.replans = 1
      stats.replanIterationBudget = remaining
      stats.constructorCalls++
      this.pathingSolver = this.input.createPathingSolver(keys, ratio)
      this.pathingSolver.MAX_ITERATIONS = Math.min(this.pathingSolver.MAX_ITERATIONS, remaining)
      this.phase = "pathing"
      return
    }
    if (this.phase === "pathing") {
      this.pathingSolver.step()
      stats.replanIterations = this.pathingSolver.iterations
      if (this.pathingSolver.failed) {
        this.failed = true
        this.error = `Certified geometry refinement failed: ${this.pathingSolver.error}`
      } else if (this.pathingSolver.solved) {
        this.uniformSolver = this.input.createUniformSolver(this.pathingSolver)
        this.phase = "uniform"
      }
      return
    }
    this.uniformSolver.step()
    if (this.uniformSolver.failed) {
      this.failed = true
      this.error = `Certified geometry refinement redistribution failed: ${this.uniformSolver.error}`
    } else if (this.uniformSolver.solved) {
      this.phase = "verify"
    }
  }
}
