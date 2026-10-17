import { BaseSolver } from "../BaseSolver"
import { SolverRuntime } from "../../solver-runtime/SolverRuntime"
import {
  isPromiseLike,
  type ParallelTaskBatch,
  type ParallelTaskOutcome,
} from "../../solver-runtime/ParallelTaskBatch"

export type ParallelSolverOptions = { runtime?: SolverRuntime }

/**
 * Each synchronous step evaluates one fixed batch, then commits it in input
 * order. Runtime scheduling and completion order cannot select the next state.
 * Override the batch hooks, not step() or _step().
 */
export abstract class ParallelSolver<
  Input,
  Output,
  Shared = undefined,
> extends BaseSolver {
  #runtime: SolverRuntime
  #stepping = false

  constructor(options: ParallelSolverOptions = {}) {
    super()
    this.#runtime = options.runtime ?? SolverRuntime.defaultRuntime
  }

  get runtime(): SolverRuntime {
    return this.#runtime
  }

  setRuntime(runtime: SolverRuntime): this {
    if (this.#stepping)
      throw new Error("Cannot change runtime during a solver step")
    this.#runtime = runtime
    return this
  }

  /** Return null when complete. Preparing a batch must not mutate solver state. */
  protected abstract getNextBatch(): ParallelTaskBatch<
    Input,
    Output,
    Shared
  > | null

  /** Called once in input order; return true when the solver is complete. */
  protected abstract commitBatch(outputs: readonly Output[]): boolean

  override _step(): void {
    this.#stepping = true
    try {
      const batch = this.getNextBatch()
      if (!batch) {
        this.solved = true
        return
      }
      if (isPromiseLike(batch))
        throw new TypeError("Batch preparation must be synchronous")
      const count = batch.inputs.length
      const submitted = Object.freeze({
        ...batch,
        inputs: Object.freeze([...batch.inputs]),
      })
      const returned = this.#runtime.runBatch(submitted)
      if (!Array.isArray(returned) || returned.length !== count) {
        throw new Error(
          "Runtime must synchronously return one outcome per task",
        )
      }
      const ordered: ParallelTaskOutcome<Output>[] = new Array(count)
      for (const outcome of returned) {
        if (
          !outcome ||
          !Number.isSafeInteger(outcome.taskIndex) ||
          outcome.taskIndex < 0 ||
          outcome.taskIndex >= count ||
          ordered[outcome.taskIndex] !== undefined ||
          (outcome.ok !== true && outcome.ok !== false) ||
          (outcome.ok &&
            (!Object.hasOwn(outcome, "output") ||
              isPromiseLike(outcome.output))) ||
          (!outcome.ok &&
            (!outcome.error ||
              typeof outcome.error.name !== "string" ||
              typeof outcome.error.message !== "string"))
        )
          throw new Error(
            "Runtime returned an invalid or duplicate task outcome",
          )
        ordered[outcome.taskIndex] = outcome
      }
      // Check every outcome before the single commit. No completion prefix or
      // first-arriving error can leak into coordinator state.
      const outputs = ordered.map((outcome) => {
        if (!outcome.ok) {
          const error = new Error(outcome.error.message)
          error.name = outcome.error.name
          throw error
        }
        return outcome.output
      })
      const complete = this.commitBatch(Object.freeze(outputs))
      if (typeof complete !== "boolean")
        throw new TypeError("Batch commits must synchronously return a boolean")
      this.solved = complete
    } finally {
      this.#stepping = false
    }
  }
}
