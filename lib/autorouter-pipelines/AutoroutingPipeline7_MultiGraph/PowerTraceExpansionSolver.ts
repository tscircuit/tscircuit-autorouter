import {
  type PowerTraceExpanderInput,
  type PowerTraceExpanderOptions,
  PowerTraceExpanderSolver,
} from "@tscircuit/power-trace-expander"
import type { GraphicsObject } from "graphics-debug"
import type { SimpleRouteJson, SimplifiedPcbTraces } from "lib/types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { BaseSolver } from "../../solvers/BaseSolver"

export class PowerTraceExpansionSolver extends BaseSolver {
  readonly powerTraceExpanderSolver?: PowerTraceExpanderSolver

  constructor(
    public readonly inputSrj: SimpleRouteJson,
    public readonly options: PowerTraceExpanderOptions = {},
  ) {
    super()
    if (options.onlyConnectionNames?.length === 0) {
      this.MAX_ITERATIONS = 1
      this.progress = 1
      this.solved = true
      this.stats = { selectedTraceCount: 0, bypassed: true }
      return
    }

    this.powerTraceExpanderSolver = new PowerTraceExpanderSolver(
      inputSrj as unknown as PowerTraceExpanderInput,
      options,
    )
    this.MAX_ITERATIONS = this.powerTraceExpanderSolver.MAX_ITERATIONS + 1
  }

  override _step(): void {
    const solver = this.powerTraceExpanderSolver
    if (!solver) {
      throw new Error(
        "Power trace expansion bypass was stepped after completion",
      )
    }
    solver.step()
    this.progress = solver.progress
    this.stats = solver.stats

    if (solver.failed) {
      this.error = solver.error
      this.failed = true
      return
    }

    if (solver.solved) this.solved = true
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

    return this.powerTraceExpanderSolver
      ? (this.powerTraceExpanderSolver.getOutput() as SimplifiedPcbTraces)
      : [...(this.inputSrj.traces ?? [])]
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
