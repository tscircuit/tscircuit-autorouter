/** A task's serializable input, result, and immutable shared context. */
export type SolverTaskDefinition<
  Input = unknown,
  Output = unknown,
  Shared = undefined,
> = {
  input: Input
  output: Output
  shared: Shared
}

/** Named shared allocations. The caller publishes their contents before use. */
export type SolverSharedMemory = Readonly<Record<string, SharedArrayBuffer>>

/**
 * Task catalogs belong to the solvers that implement their handlers. A single
 * executor can implement the intersection of several solvers' catalogs.
 */
export type SolverTaskCatalog<Tasks> = {
  [Kind in keyof Tasks]: SolverTaskDefinition<unknown, unknown, unknown>
}

export type SolverTaskContext<Shared> = {
  /**
   * Immutable input shared by related tasks. This can contain SharedArrayBuffers
   * or views backed by them; structured cloning shares their backing storage.
   * TypeScript readonly does not protect the underlying bytes from writes.
   */
  readonly shared: Shared
}

/**
 * Execution resources supplied by the host, independent of solver algorithms.
 *
 * Handlers are registered by task kind in the host/worker entrypoint, never sent
 * as callbacks. Inputs, shared context, and outputs must be structured-cloneable.
 * Ordinary input/output data must have structured-clone isolation in both inline
 * and worker implementations. Shared backing storage intentionally remains shared.
 *
 * Completion order is unspecified. Solvers retain responsibility for consuming
 * results and errors in their original logical order, preserving seeds, search
 * budgets, cache visibility, and candidate selection. Waiting is not solver work.
 */
export interface SolverExecutor<Tasks extends SolverTaskCatalog<Tasks>> {
  execute<Kind extends keyof Tasks & string>(
    kind: Kind,
    input: Tasks[Kind]["input"],
    context: SolverTaskContext<Tasks[Kind]["shared"]>,
  ): Promise<Tasks[Kind]["output"]>

  /**
   * Stop accepting work, settle outstanding requests, and release owned workers.
   * The host that created the executor owns disposal; child solvers do not.
   */
  dispose(): Promise<void>
}

/**
 * Extended as autorouter task handlers are introduced. No task kinds are enabled
 * by this interface-only change. Other solver packages can use their own catalog
 * with the structurally compatible SolverExecutor contract.
 */
export interface AutorouterTaskMap {}

export type AutorouterExecutor = SolverExecutor<AutorouterTaskMap>
