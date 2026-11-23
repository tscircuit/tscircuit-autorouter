import {
  type PowerTraceExpanderInput,
  type PowerTraceExpanderOptions,
  PowerTraceExpanderSolver,
} from "@tscircuit/power-trace-expander"
import type { GraphicsObject } from "graphics-debug"
import type { SimpleRouteJson, SimplifiedPcbTraces } from "lib/types"
import { assertPreloadedTracesStayOnAllowedLayers } from "lib/utils/assertPreloadedTracesStayOnAllowedLayers"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { getViaToPadClearance } from "lib/utils/getViaToPadClearance"
import { BaseSolver } from "../../solvers/BaseSolver"

/** Board-world route points in mm, right-handed: +X right, +Y up, +Z above.
 * Original trace domains remain authoritative after output geometry changes. */
export type PowerTraceExpansionSolverInput = SimpleRouteJson & {
  fixedTraces?: SimplifiedPcbTraces
  originalPreloadedTraces?: SimplifiedPcbTraces
}

export class PowerTraceExpansionSolver extends BaseSolver {
  readonly powerTraceExpanderSolver: PowerTraceExpanderSolver
  private readonly originalPreloadedTraces?: SimplifiedPcbTraces

  constructor(
    public readonly inputSrj: PowerTraceExpansionSolverInput,
    public readonly options: PowerTraceExpanderOptions = {},
  ) {
    super()
    const { originalPreloadedTraces, ...powerTraceInput } = inputSrj
    this.originalPreloadedTraces = originalPreloadedTraces
    this.powerTraceExpanderSolver = new PowerTraceExpanderSolver(
      {
        ...powerTraceInput,
        minViaEdgeToPadEdgeClearance: getViaToPadClearance(inputSrj),
      } as unknown as PowerTraceExpanderInput,
      options,
    )
    if (options.onlyConnectionNames?.length === 0) {
      this.MAX_ITERATIONS = 1
      this.progress = 1
      this.stats = { selectedTraceCount: 0, bypassed: true }
      this.finish()
      return
    }

    this.MAX_ITERATIONS = this.powerTraceExpanderSolver.MAX_ITERATIONS + 1
  }

  override _step(): void {
    const solver = this.powerTraceExpanderSolver
    solver.step()
    this.progress = solver.progress
    this.stats = solver.stats

    if (solver.failed) {
      this.error = solver.error
      this.failed = true
      return
    }

    if (solver.solved) this.finish()
  }

  private finish(): void {
    if (this.originalPreloadedTraces) {
      assertPreloadedTracesStayOnAllowedLayers({
        traces: [
          ...(this.powerTraceExpanderSolver.getOutput() as SimplifiedPcbTraces),
          ...(this.inputSrj.fixedTraces ?? []),
        ],
        preloadedTraces: this.originalPreloadedTraces,
        layerCount: this.inputSrj.layerCount,
      })
    }
    this.solved = true
  }

  override getConstructorParams(): readonly [
    PowerTraceExpansionSolverInput,
    PowerTraceExpanderOptions,
  ] {
    return [this.inputSrj, this.options] as const
  }

  getOutput(): SimplifiedPcbTraces {
    if (!this.solved) {
      throw new Error("Cannot get power trace expansion output before solving")
    }

    return this.powerTraceExpanderSolver.getOutput() as SimplifiedPcbTraces
  }

  override visualize(): GraphicsObject {
    return convertSrjToGraphicsObject(
      {
        ...this.inputSrj,
        traces: this.getOutput(),
      },
      { traceColorMode: "layer" },
    )
  }
}
