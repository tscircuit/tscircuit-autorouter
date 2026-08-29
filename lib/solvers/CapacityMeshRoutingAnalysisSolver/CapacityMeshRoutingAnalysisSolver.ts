import type { GraphicsObject } from "graphics-debug"
import {
  AutoroutingPipelineSolver7_MultiGraph,
  type AutoroutingPipelineSolverOptions,
} from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import type {
  CapacityMeshNode,
  SimpleRouteJson,
} from "lib/types"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import { BaseSolver } from "../BaseSolver"
import { CapacityPathingSolver } from "../CapacityPathingSolver/CapacityPathingSolver"
import { CapacityEdgeToPortSegmentSolver } from "../CapacityMeshSolver/CapacityEdgeToPortSegmentSolver"
import { CapacitySegmentToPointSolver } from "../CapacityMeshSolver/CapacitySegmentToPointSolver"

type RoutingAnalysisPhase =
  | "topology"
  | "capacityPathing"
  | "edgeToPortSegments"
  | "segmentToPoints"
  | "done"

/**
 * Routes every connection through the capacity mesh without rejecting
 * over-capacity nodes. Over-capacity traffic is the signal this analysis is
 * intended to measure; obstacle and layer connectivity constraints still
 * apply.
 */
class UnboundedCapacityPathingSolver extends CapacityPathingSolver {
  override doesNodeHaveCapacityForTrace(
    _node: CapacityMeshNode,
    _prevNode: CapacityMeshNode,
  ): boolean {
    return true
  }
}

/**
 * Produces coarse global-routing traffic for routing-difficulty analysis.
 * This deliberately stops before detailed port-point and high-density
 * routing, which require a conflict-free physical route rather than a demand
 * estimate.
 */
export class CapacityMeshRoutingAnalysisSolver extends BaseSolver {
  private phase: RoutingAnalysisPhase = "topology"
  readonly topologySolver: AutoroutingPipelineSolver7_MultiGraph
  capacityPathingSolver?: UnboundedCapacityPathingSolver
  edgeToPortSegmentSolver?: CapacityEdgeToPortSegmentSolver
  segmentToPointSolver?: CapacitySegmentToPointSolver

  constructor(
    private readonly simpleRouteJson: SimpleRouteJson,
    private readonly options: AutoroutingPipelineSolverOptions = {},
  ) {
    super()
    this.topologySolver = new AutoroutingPipelineSolver7_MultiGraph(
      simpleRouteJson,
      options,
    )
    this.activeSubSolver = this.topologySolver
    this.MAX_ITERATIONS = this.topologySolver.MAX_ITERATIONS + 1_200_000
  }

  override getSolverName(): string {
    return "CapacityMeshRoutingAnalysisSolver"
  }

  getCurrentPhase(): RoutingAnalysisPhase {
    return this.phase
  }

  private failFrom(solver: BaseSolver): void {
    this.error = solver.error
    this.failed = true
    this.activeSubSolver = null
  }

  override _step(): void {
    if (this.phase === "topology") {
      if (
        this.topologySolver.getCurrentPhase() === "portPointPathingSolver"
      ) {
        this.capacityPathingSolver = new UnboundedCapacityPathingSolver({
          simpleRouteJson: this.topologySolver.srjWithPointPairs!,
          nodes: this.topologySolver.capacityNodes!,
          edges: this.topologySolver.capacityEdges!,
          colorMap: this.topologySolver.colorMap,
        })
        this.phase = "capacityPathing"
        this.activeSubSolver = this.capacityPathingSolver
        return
      }

      this.topologySolver.step()
      if (this.topologySolver.failed) this.failFrom(this.topologySolver)
      return
    }

    if (this.phase === "capacityPathing") {
      this.capacityPathingSolver!.step()
      if (this.capacityPathingSolver!.failed) {
        this.failFrom(this.capacityPathingSolver!)
        return
      }
      if (!this.capacityPathingSolver!.solved) return

      this.edgeToPortSegmentSolver = new CapacityEdgeToPortSegmentSolver({
        nodes: this.topologySolver.capacityNodes!,
        edges: this.topologySolver.capacityEdges!,
        capacityPaths: this.capacityPathingSolver!.getCapacityPaths(),
        colorMap: this.topologySolver.colorMap,
      })
      this.phase = "edgeToPortSegments"
      this.activeSubSolver = this.edgeToPortSegmentSolver
      return
    }

    if (this.phase === "edgeToPortSegments") {
      this.edgeToPortSegmentSolver!.step()
      if (this.edgeToPortSegmentSolver!.failed) {
        this.failFrom(this.edgeToPortSegmentSolver!)
        return
      }
      if (!this.edgeToPortSegmentSolver!.solved) return

      this.segmentToPointSolver = new CapacitySegmentToPointSolver({
        segments: [
          ...this.edgeToPortSegmentSolver!.nodePortSegments.values(),
        ].flat(),
        colorMap: this.topologySolver.colorMap,
        nodes: this.topologySolver.capacityNodes!,
      })
      this.phase = "segmentToPoints"
      this.activeSubSolver = this.segmentToPointSolver
      return
    }

    if (this.phase === "segmentToPoints") {
      this.segmentToPointSolver!.step()
      if (this.segmentToPointSolver!.failed) {
        this.failFrom(this.segmentToPointSolver!)
        return
      }
      if (!this.segmentToPointSolver!.solved) return

      this.phase = "done"
      this.activeSubSolver = null
      this.solved = true
    }
  }

  getOutput(): NodeWithPortPoints[] {
    if (!this.solved || !this.segmentToPointSolver) {
      throw new Error(
        "CapacityMeshRoutingAnalysisSolver must finish before getOutput()",
      )
    }
    return this.segmentToPointSolver.getNodesWithPortPoints()
  }

  override getConstructorParams() {
    return [this.simpleRouteJson, this.options] as const
  }

  override visualize(): GraphicsObject {
    return this.activeSubSolver?.visualize() ?? { points: [], lines: [] }
  }
}
