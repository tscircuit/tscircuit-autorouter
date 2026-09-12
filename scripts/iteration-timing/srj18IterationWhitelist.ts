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
export const srj18IterationWhitelist: IterationWhitelistEntry[] = [
  {
    solverName: "DuplicateCongestedPortSolver",
    phase: "step",
    localIteration: 1,
    reason:
      "Congestion setup routes connections synchronously and duplicates the graph; a material contributor to pipeline iteration 9255 (1.29s on Blacksmith).",
  },
  {
    solverName: "TinyHypergraphPortPointPathingSolver",
    phase: "initialization",
    localIteration: 0,
    reason:
      "Hypergraph construction, serialization and input-node preparation share pipeline iteration 9255 with the separately attributed congestion prepass.",
  },
  {
    solverName: "UniformPortDistributionSolver",
    phase: "initialization",
    localIteration: 0,
    reason:
      "Preparing pathing output, ownership pairs and shared edges took 1.04s in pipeline iteration 199302 on a repeated Blacksmith run.",
  },
  {
    solverName: "HighDensitySolver",
    phase: "initialization",
    localIteration: 0,
    reason:
      "Preparing nodes calls computeNodePf for every node, repeatedly rebuilding pathing output; pipeline iteration 199986 took 1.63s on Blacksmith.",
  },
]
