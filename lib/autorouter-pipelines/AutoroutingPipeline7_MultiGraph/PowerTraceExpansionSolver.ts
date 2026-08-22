import {
  type PowerTraceExpanderInput,
  type PowerTraceExpanderOptions,
  PowerTraceExpanderSolver,
} from "@tscircuit/power-trace-expander"
import type { GraphicsObject } from "graphics-debug"
import type { SimpleRouteJson, SimplifiedPcbTraces } from "lib/types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { getGeneratedThroughViaCollision } from "lib/utils/getGeneratedThroughViaCollision"
import { materializeGeneratedThroughVias } from "lib/utils/materializeGeneratedThroughVias"
import { BaseSolver } from "../../solvers/BaseSolver"
import type { Pipeline7PowerTraceExpansionInput } from "./prepare-pipeline7-power-trace-expansion-input"

export class PowerTraceExpansionSolver extends BaseSolver {
  readonly powerTraceExpanderSolver: PowerTraceExpanderSolver
  private materializedOutput?: SimplifiedPcbTraces

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
      this.stats = { selectedTraceCount: 0, bypassed: true }
      this.finishWithOutput([...(inputSrj.traces ?? [])])
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

    if (solver.solved) {
      this.finishWithOutput(solver.getOutput() as SimplifiedPcbTraces)
    }
  }

  private finishWithOutput(rawOutput: SimplifiedPcbTraces): void {
    const expansionInput = this
      .inputSrj as Partial<Pipeline7PowerTraceExpansionInput>
    const materializedOutput = materializeGeneratedThroughVias({
      inputTraces: this.inputSrj.traces ?? [],
      outputTraces: rawOutput,
      layerCount: this.inputSrj.layerCount,
      allowBlindAndBuriedVias: this.inputSrj.allowBlindAndBuriedVias,
    })
    const completeOutput = [
      ...(expansionInput.fixedTraces ?? []),
      ...materializedOutput,
    ]
    const collision = getGeneratedThroughViaCollision({
      srj: this.inputSrj,
      preservedInputTraces:
        expansionInput.authoredInputTraces ?? this.inputSrj.traces ?? [],
      outputTraces: completeOutput,
    })
    if (collision) {
      this.error = collision
      this.failed = true
      return
    }
    this.materializedOutput = materializedOutput
    this.solved = true
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

    return this.materializedOutput ?? []
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
