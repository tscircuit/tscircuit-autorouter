import {
  isPromiseLike,
  type ParallelTaskBatch,
  type ParallelTaskOutcome,
} from "./ParallelTaskBatch"
import { cloneTaskData } from "./cloneTaskData"

/**
 * A synchronous batch barrier. Return every indexed outcome before returning.
 * Tasks cannot modify solver state; only the coordinator commits their outputs.
 */
export interface SolverRuntime {
  runBatch<Input, Output, Shared>(
    batch: ParallelTaskBatch<Input, Output, Shared>,
  ): readonly ParallelTaskOutcome<Output>[]
  dispose(): void
}

export class SingleThreadSolverRuntime implements SolverRuntime {
  #disposed = false

  runBatch<Input, Output, Shared>(
    batch: ParallelTaskBatch<Input, Output, Shared>,
  ): readonly ParallelTaskOutcome<Output>[] {
    if (this.#disposed) throw new Error("Solver runtime has been disposed")
    // Snapshot every input before executing any task, as a parallel backend must.
    const snapshots = batch.inputs.map((input) => {
      try {
        return {
          ok: true as const,
          data: cloneTaskData({ input, shared: batch.shared }),
        }
      } catch (error) {
        return { ok: false as const, error }
      }
    })
    return snapshots.map((snapshot, taskIndex) => {
      try {
        if (!snapshot.ok) throw snapshot.error
        const output = batch.runTask(snapshot.data.input, {
          shared: snapshot.data.shared,
        })
        if (isPromiseLike(output)) {
          throw new TypeError("Parallel solver tasks must return synchronously")
        }
        return { taskIndex, ok: true, output: cloneTaskData(output) }
      } catch (error) {
        return {
          taskIndex,
          ok: false,
          error: serializeError(error),
        }
      }
    })
  }

  dispose(): void {
    this.#disposed = true
  }
}

function serializeError(error: unknown): { name: string; message: string } {
  try {
    return error instanceof Error
      ? { name: error.name, message: error.message }
      : { name: "Error", message: String(error) }
  } catch {
    return { name: "Error", message: "Task threw an unserializable error" }
  }
}

/** New solvers capture this default. It does not affect existing instances. */
export const SolverRuntime: { defaultRuntime: SolverRuntime } = {
  defaultRuntime: new SingleThreadSolverRuntime(),
}
