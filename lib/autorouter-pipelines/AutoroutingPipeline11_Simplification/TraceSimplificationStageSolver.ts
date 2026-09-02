import { BaseSolver } from "@tscircuit/solver-utils"
import type { GraphicsObject } from "graphics-debug"
import { TraceSimplificationSolver } from "lib/solvers/TraceSimplificationSolver/TraceSimplificationSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getViaDimensions } from "lib/utils/getViaDimensions"
import type { PreparedPipeline11Simplification } from "./PrepareTraceSimplificationSolver"

export type TraceSimplificationStageSolverInput = {
  preparedInput: PreparedPipeline11Simplification
}

/** Adapts the incremental cleanup solver to the conventional pipeline API. */
export class TraceSimplificationStageSolver extends BaseSolver {
  readonly traceSimplificationSolver: TraceSimplificationSolver

  constructor(
    public readonly inputProblem: TraceSimplificationStageSolverInput,
  ) {
    super()
    const preparedInput = inputProblem.preparedInput
    const viaDimensions = getViaDimensions(preparedInput.srj)
    this.traceSimplificationSolver = new TraceSimplificationSolver({
      hdRoutes: preparedInput.mutableHdRoutes,
      otherHdRoutes: preparedInput.immutableHdRoutes,
      obstacles: preparedInput.srj.obstacles,
      connMap: preparedInput.connMap,
      colorMap: preparedInput.colorMap,
      outline: preparedInput.srj.outline,
      defaultViaDiameter: viaDimensions.padDiameter,
      layerCount: preparedInput.srj.layerCount,
      minTraceToPadEdgeClearance: preparedInput.srj.minTraceToPadEdgeClearance,
      minBoardEdgeClearance: preparedInput.srj.minBoardEdgeClearance,
      netByConnectionName: preparedInput.netByConnectionName,
      enableCrossingViaReduction:
        preparedInput.options.enableCrossingViaReduction ?? true,
      preserveRouteEndpoints: true,
    })
    this.traceSimplificationSolver.MAX_SIMPLIFICATION_PIPELINE_LOOPS =
      preparedInput.options.iterations ?? 2
    this.activeSubSolver = this
      .traceSimplificationSolver as unknown as BaseSolver
    this.MAX_ITERATIONS = this.traceSimplificationSolver.MAX_ITERATIONS + 1
  }

  override getSolverName(): string {
    return "TraceSimplificationStageSolver"
  }

  /** Advances exactly one incremental unit of the wrapped solver. */
  override _step(): void {
    this.traceSimplificationSolver.step()
    this.progress = this.traceSimplificationSolver.progress
    this.stats = { ...this.traceSimplificationSolver.stats }

    if (this.traceSimplificationSolver.failed) {
      this.error =
        this.traceSimplificationSolver.error ?? "Trace simplification failed"
      this.failed = true
      this.activeSubSolver = null
      return
    }
    if (this.traceSimplificationSolver.solved) {
      this.progress = 1
      this.solved = true
      this.activeSubSolver = null
    }
  }

  override getConstructorParams(): readonly [
    TraceSimplificationStageSolverInput,
  ] {
    return [this.inputProblem] as const
  }

  override getOutput(): HighDensityRoute[] {
    if (!this.solved) {
      throw new Error("Cannot get simplified routes before cleanup completes")
    }
    return structuredClone(this.traceSimplificationSolver.simplifiedHdRoutes)
  }

  override visualize(): GraphicsObject {
    return this.traceSimplificationSolver.visualize()
  }

  override preview(): GraphicsObject {
    return this.traceSimplificationSolver.preview()
  }
}
