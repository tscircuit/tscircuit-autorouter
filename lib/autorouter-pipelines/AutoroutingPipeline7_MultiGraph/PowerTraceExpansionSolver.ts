import {
  type PowerTraceExpanderInput,
  type PowerTraceExpanderOptions,
  PowerTraceExpanderSolver,
} from "@tscircuit/power-trace-expander"
import type { GraphicsObject } from "graphics-debug"
import type { SimpleRouteJson, SimplifiedPcbTraces } from "lib/types"
import { addViaArraysToWideTraces } from "lib/utils/add-via-arrays-to-wide-traces"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { getViaDimensions } from "lib/utils/getViaDimensions"
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
    if (options.onlyConnectionNames?.length === 0) {
      this.MAX_ITERATIONS = 1
      this.progress = 1
      this.solved = true
      this.stats = { selectedTraceCount: 0, bypassed: true }
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

    return addViaArraysToWideTraces({
      traces: this.powerTraceExpanderSolver.getOutput() as SimplifiedPcbTraces,
      defaultViaDiameter: getViaDimensions(this.inputSrj).padDiameter,
    })
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
