/** A fixed logical batch. Its contents and boundaries must not depend on threads. */
export type ParallelTaskBatch<Input, Output, Shared = undefined> = {
  /** Loadable task module used by a worker runtime; algorithms stay transport-independent. */
  worker?: { moduleUrl: string; exportName: string }
  inputs: readonly Input[]
  shared: Shared
  /** Pure synchronous task logic. Shared backing storage must stay read-only. */
  runTask: (input: Input, context: { readonly shared: Shared }) => Output
}

/** Runtimes may return outcomes in any order; taskIndex is the input position. */
export type ParallelTaskOutcome<Output> =
  | { taskIndex: number; ok: true; output: Output }
  | { taskIndex: number; ok: false; error: { name: string; message: string } }

export function isPromiseLike(value: unknown): boolean {
  return (
    ((typeof value === "object" && value !== null) ||
      typeof value === "function") &&
    typeof (value as { then?: unknown }).then === "function"
  )
}
