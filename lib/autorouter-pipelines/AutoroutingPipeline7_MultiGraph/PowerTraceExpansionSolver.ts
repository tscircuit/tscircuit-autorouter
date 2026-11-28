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

  constructor(
    public readonly inputSrj: SimpleRouteJson &
      Pick<PowerTraceExpanderInput, "boardOutline">,
    public readonly options: PowerTraceExpanderOptions = {},
  ) {
    super()
    this.powerTraceExpanderSolver = new PowerTraceExpanderSolver(
      {
        ...inputSrj,
        // The expander's input traces call the desired width nominalTraceWidth
        traces: inputSrj.traces?.map(
          ({ __desiredNominalTraceWidth, ...trace }) => ({
            ...trace,
            nominalTraceWidth: __desiredNominalTraceWidth,
          }),
        ),
        minViaEdgeToPadEdgeClearance: getViaToPadClearance(inputSrj),
      } as unknown as PowerTraceExpanderInput,
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
    typeof this.inputSrj,
    PowerTraceExpanderOptions,
  ] {
    return [this.inputSrj, this.options] as const
  }

  getOutput(): SimplifiedPcbTraces {
    if (!this.solved) {
      throw new Error("Cannot get power trace expansion output before solving")
    }

    return this.powerTraceExpanderSolver
      .getOutput()
      .map(
        ({ nominalTraceWidth: _desired, ...trace }) => trace,
      ) as SimplifiedPcbTraces
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
