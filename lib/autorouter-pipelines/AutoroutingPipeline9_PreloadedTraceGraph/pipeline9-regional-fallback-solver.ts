import { HighDensityForceImproveSolver } from "high-density-repair01/lib/HighDensityForceImproveSolver";
import type { GraphicsObject } from "graphics-debug";
import { BaseSolver } from "lib/solvers/BaseSolver";
import { HighDensitySolver } from "lib/solvers/HighDensitySolver/HighDensitySolver";
import { Pipeline4HighDensityRepairSolver } from "lib/solvers/HighDensityRepairSolver/Pipeline4HighDensityRepairSolver";
import type {
  HighDensityRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types";
import type { Obstacle } from "lib/types/srj-types";
import type { ConnectivityMap } from "circuit-json-to-connectivity-map";

type Pipeline9RegionalFallbackSolverParams = {
  nodeWithPortPoints: NodeWithPortPoints;
  colorMap: Record<string, string>;
  connMap: ConnectivityMap;
  viaDiameter: number;
  traceWidth: number;
  obstacleMargin: number;
  effort: number;
  obstacles: Obstacle[];
  layerCount: number;
};

type RegionalFallbackPhase = "route" | "improve" | "repair" | "done";

/** Runs the regular high-density cleanup pipeline for a B01 fallback region. */
export class Pipeline9RegionalFallbackSolver extends BaseSolver {
  readonly params: Pipeline9RegionalFallbackSolverParams;
  readonly highDensitySolver: HighDensitySolver;
  forceImproveSolver?: HighDensityForceImproveSolver;
  repairSolver?: Pipeline4HighDensityRepairSolver;
  private phase: RegionalFallbackPhase = "route";

  constructor(params: Pipeline9RegionalFallbackSolverParams) {
    super();
    this.params = params;
    this.highDensitySolver = new HighDensitySolver({
      nodePortPoints: [params.nodeWithPortPoints],
      colorMap: params.colorMap,
      connMap: params.connMap,
      viaDiameter: params.viaDiameter,
      traceWidth: params.traceWidth,
      obstacleMargin: params.obstacleMargin,
      effort: params.effort,
      obstacles: params.obstacles,
      layerCount: params.layerCount,
      useGrowShrinkHighDensityIntraNodeSolver: true,
      preserveTerminalPcbPortIds: false,
      growShrinkFallbackToInvalidGeometryOnFailure: false,
    });
    this.activeSubSolver = this.highDensitySolver;
    this.MAX_ITERATIONS = 100e6 * params.effort;
  }

  override getSolverName(): string {
    return "Pipeline9RegionalFallbackSolver";
  }

  override _step(): void {
    if (this.phase === "route") {
      this.highDensitySolver.step();
      if (this.highDensitySolver.failed) {
        this.error = this.highDensitySolver.error;
        this.failed = true;
        return;
      }
      if (!this.highDensitySolver.solved) return;
      this.forceImproveSolver = new HighDensityForceImproveSolver({
        nodeWithPortPoints: [this.params.nodeWithPortPoints],
        hdRoutes: this.highDensitySolver.routes,
        colorMap: this.params.colorMap,
        totalStepsPerNode: Math.max(12, Math.round(20 * this.params.effort)),
        nodeAssignmentMargin: this.params.obstacleMargin,
      });
      this.activeSubSolver = this.forceImproveSolver;
      this.phase = "improve";
      return;
    }

    if (this.phase === "improve") {
      this.forceImproveSolver!.step();
      if (this.forceImproveSolver!.failed) {
        this.error = this.forceImproveSolver!.error;
        this.failed = true;
        return;
      }
      if (!this.forceImproveSolver!.solved) return;
      this.repairSolver = new Pipeline4HighDensityRepairSolver({
        nodeWithPortPoints: [this.params.nodeWithPortPoints],
        hdRoutes: this.forceImproveSolver!.getOutput(),
        obstacles: this.params.obstacles,
        colorMap: this.params.colorMap,
        repairMargin: this.params.obstacleMargin,
        maxSampleEntries: 80,
      });
      this.activeSubSolver = this.repairSolver;
      this.phase = "repair";
      return;
    }

    if (this.phase === "repair") {
      this.repairSolver!.step();
      if (this.repairSolver!.failed) {
        this.error = this.repairSolver!.error;
        this.failed = true;
        return;
      }
      if (!this.repairSolver!.solved) return;
      this.activeSubSolver = null;
      this.phase = "done";
      this.solved = true;
      return;
    }
  }

  getOutput(): HighDensityRoute[] {
    return (
      this.repairSolver?.getOutput() ??
      this.forceImproveSolver?.getOutput() ??
      this.highDensitySolver.routes
    );
  }

  override visualize(): GraphicsObject {
    return (
      this.repairSolver?.visualize() ??
      this.forceImproveSolver?.visualize() ??
      this.highDensitySolver.visualize()
    );
  }
}
