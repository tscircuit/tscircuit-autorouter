import {
  type PowerTraceExpanderInput,
  type PowerTraceExpanderOptions,
  PowerTraceExpanderSolver,
} from "@tscircuit/power-trace-expander"
import type { GraphicsObject } from "graphics-debug"
import type { SimpleRouteJson, SimplifiedPcbTraces } from "lib/types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { canUseUnrestrictedLayerMoves } from "lib/utils/routing-layer-constraints"
import { BaseSolver } from "../../solvers/BaseSolver"

export class PowerTraceExpansionSolver extends BaseSolver {
  readonly powerTraceExpanderSolver: PowerTraceExpanderSolver

  constructor(
    public readonly inputSrj: SimpleRouteJson,
    public readonly options: PowerTraceExpanderOptions = {},
  ) {
    super()
    if (
      options.allowNewVias !== false &&
      !canUseUnrestrictedLayerMoves(inputSrj)
    ) {
      throw new Error(
        "Power trace expansion cannot add vias when routingLayers excludes board layers",
      )
    }
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
