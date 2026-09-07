export type IterationWhitelistEntry = {
  solverName: string
  phase: "step" | "initialization"
  localIteration: number
  iterationEnd?: number
  reason: string
}

// Selected by serial discovery; see docs/srj18-iteration-timing.md.
export const SRJ18_FASTEST_SAMPLE = "sample005"
export const SRJ18_ITERATION_THRESHOLD_MS = 1_000
export const SRJ18_ITERATION_TARGET_MS = 100

// Exact deepest-solver iterations only. Ancestor names and solver-wide wildcards
// would hide new blocking work in their descendants.
export const srj18IterationWhitelist: IterationWhitelistEntry[] = []
