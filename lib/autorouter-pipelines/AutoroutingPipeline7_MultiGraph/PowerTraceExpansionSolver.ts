import {
  PowerTraceExpanderSolver,
  type PowerTraceExpanderInput,
  type PowerTraceExpanderOptions,
} from "@tscircuit/power-trace-expander"
import type { GraphicsObject } from "graphics-debug"
import type { SimpleRouteJson, SimplifiedPcbTraces } from "lib/types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { BaseSolver } from "../../solvers/BaseSolver"

export class PowerTraceExpansionSolver extends BaseSolver {
  readonly powerTraceExpanderSolver: PowerTraceExpanderSolver

  constructor(
    public readonly inputSrj: SimpleRouteJson,
    public readonly options: PowerTraceExpanderOptions = {},
  ) {
    super()
    this.powerTraceExpanderSolver = new PowerTraceExpanderSolver(
      inputSrj as unknown as PowerTraceExpanderInput,
      options,
    )
    this.MAX_ITERATIONS = this.powerTraceExpanderSolver.MAX_ITERATIONS + 1
  }

  override _step(): void {
    this.powerTraceExpanderSolver.step()
    this.progress = this.powerTraceExpanderSolver.progress
    this.stats = this.powerTraceExpanderSolver.stats

    if (this.powerTraceExpanderSolver.failed) {
      this.error = this.powerTraceExpanderSolver.error
      this.failed = true
      return
    }

    if (this.powerTraceExpanderSolver.solved) this.solved = true
  }

  override getConstructorParams(): readonly [
    SimpleRouteJson,
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
        traces:
          this.powerTraceExpanderSolver.getOutput() as SimplifiedPcbTraces,
      },
      { traceColorMode: "layer" },
    )
  }
}
