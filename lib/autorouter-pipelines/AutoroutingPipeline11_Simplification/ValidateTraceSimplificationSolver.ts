import { BaseSolver } from "@tscircuit/solver-utils"
import {
  AutoroutingDrcEngine,
  type AutoroutingDrcResult,
  type SimpleRouteJson as RepairSimpleRouteJson,
  type SimplifiedPcbTraces as RepairSimplifiedPcbTraces,
} from "high-density-repair03/lib"
import type { SimpleRouteJson } from "lib/types"
import type { PreparedPipeline11Simplification } from "./PrepareTraceSimplificationSolver"

export type ValidateTraceSimplificationSolverInput = {
  preparedInput: PreparedPipeline11Simplification
  outputSrj: SimpleRouteJson
}

type ValidationPhase = "baseline" | "output" | "compare"

const countErrorsByType = (
  result: AutoroutingDrcResult,
): Record<string, number> => {
  const counts: Record<string, number> = {}
  for (const error of result.errors) {
    counts[error.type] = (counts[error.type] ?? 0) + 1
  }
  return counts
}

/** Rejects simplification whenever it introduces an autorouting DRC category. */
export class ValidateTraceSimplificationSolver extends BaseSolver {
  private readonly drcEngine: AutoroutingDrcEngine
  private phase: ValidationPhase = "baseline"
  private baselineErrorCounts: Record<string, number> = {}
  private outputErrorCounts: Record<string, number> = {}

  constructor(
    public readonly inputProblem: ValidateTraceSimplificationSolverInput,
  ) {
    super()
    const preparedInput = inputProblem.preparedInput
    this.drcEngine = new AutoroutingDrcEngine(
      preparedInput.srj as RepairSimpleRouteJson,
      {
        connMap: preparedInput.connMap,
        traceClearance: preparedInput.srj.minTraceToPadEdgeClearance ?? 0.1,
        viaClearance: 0.1,
      },
    )
    this.MAX_ITERATIONS = 3
  }

  override getSolverName(): string {
    return "ValidateTraceSimplificationSolver"
  }

  override _step(): void {
    if (this.phase === "baseline") {
      this.baselineErrorCounts = this.evaluateErrorCounts(
        this.inputProblem.preparedInput.originalSrj,
      )
      this.phase = "output"
      this.progress = 1 / 3
      return
    }
    if (this.phase === "output") {
      this.outputErrorCounts = this.evaluateErrorCounts(
        this.inputProblem.outputSrj,
      )
      this.phase = "compare"
      this.progress = 2 / 3
      return
    }

    this.assertNoNewDrcErrors()
    this.stats = {
      baselineErrorCounts: this.baselineErrorCounts,
      outputErrorCounts: this.outputErrorCounts,
    }
    this.progress = 1
    this.solved = true
  }

  private evaluateErrorCounts(srj: SimpleRouteJson): Record<string, number> {
    const result = this.drcEngine.evaluate(
      (srj.traces ?? []) as RepairSimplifiedPcbTraces,
    )
    return countErrorsByType(result)
  }

  private assertNoNewDrcErrors(): void {
    const errorTypes = new Set([
      ...Object.keys(this.baselineErrorCounts),
      ...Object.keys(this.outputErrorCounts),
    ])
    const regressions = [...errorTypes].filter(
      (type) =>
        (this.outputErrorCounts[type] ?? 0) >
        (this.baselineErrorCounts[type] ?? 0),
    )
    if (regressions.length === 0) return

    const details = regressions
      .map(
        (type) =>
          `${type}: ${this.baselineErrorCounts[type] ?? 0} -> ${this.outputErrorCounts[type] ?? 0}`,
      )
      .join(", ")
    throw new Error(
      `Pipeline 11 simplification introduced DRC errors (${details})`,
    )
  }

  override getConstructorParams(): readonly [
    ValidateTraceSimplificationSolverInput,
  ] {
    return [this.inputProblem] as const
  }

  override getOutput(): SimpleRouteJson {
    if (!this.solved) {
      throw new Error("Cannot get Pipeline 11 output before DRC validation")
    }
    return structuredClone(this.inputProblem.outputSrj)
  }
}
