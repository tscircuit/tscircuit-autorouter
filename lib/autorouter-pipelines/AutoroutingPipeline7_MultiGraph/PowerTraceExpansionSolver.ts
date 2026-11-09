import {
  type PowerTraceExpanderInput,
  type PowerTraceExpanderOptions,
  PowerTraceExpanderSolver,
} from "@tscircuit/power-trace-expander"
import type { GraphicsObject } from "graphics-debug"
import type { SimpleRouteJson, SimplifiedPcbTraces } from "lib/types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { getViaToPadClearance } from "lib/utils/getViaToPadClearance"
import { BaseSolver } from "../../solvers/BaseSolver"

export class PowerTraceExpansionSolver extends BaseSolver {
  readonly powerTraceExpanderSolver: PowerTraceExpanderSolver
  private readonly preservedTraces: SimplifiedPcbTraces

  constructor(
    public readonly inputSrj: SimpleRouteJson,
    public readonly options: PowerTraceExpanderOptions = {},
    private readonly preserveConnectionNames?: readonly string[],
  ) {
    super()
    const preservedNames = new Set(preserveConnectionNames)
    const traces = inputSrj.traces ?? []
    this.preservedTraces = traces.filter((trace) =>
      preservedNames.has(trace.connection_name),
    )
    const preparedInput: SimpleRouteJson & {
      fixedTraces?: SimplifiedPcbTraces
    } = {
      ...inputSrj,
      minViaEdgeToPadEdgeClearance: getViaToPadClearance(inputSrj),
    }
    if (this.preservedTraces.length > 0) {
      preparedInput.traces = traces.filter(
        (trace) => !preservedNames.has(trace.connection_name),
      )
      preparedInput.fixedTraces = [
        ...(preparedInput.fixedTraces ?? []),
        ...this.preservedTraces,
      ]
    }
    this.powerTraceExpanderSolver = new PowerTraceExpanderSolver(
      preparedInput as unknown as PowerTraceExpanderInput,
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

  override getConstructorParams():
    | readonly [SimpleRouteJson, PowerTraceExpanderOptions]
    | readonly [SimpleRouteJson, PowerTraceExpanderOptions, readonly string[]] {
    if (this.preserveConnectionNames === undefined) {
      return [this.inputSrj, this.options] as const
    }
    return [this.inputSrj, this.options, this.preserveConnectionNames] as const
  }

  getOutput(): SimplifiedPcbTraces {
    if (!this.solved) {
      throw new Error("Cannot get power trace expansion output before solving")
    }

    return [
      ...this.preservedTraces,
      ...(this.powerTraceExpanderSolver.getOutput() as SimplifiedPcbTraces),
    ]
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
