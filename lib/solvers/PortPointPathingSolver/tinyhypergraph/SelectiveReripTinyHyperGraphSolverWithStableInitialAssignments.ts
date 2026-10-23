import { ParallelSelectiveReripTinyHyperGraphSolver } from "tiny-hypergraph/lib/parallel-selective-rerip-tiny-hypergraph-solver"

/** Keep the consumer name while the shared solver owns stable assignments. */
export class SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments extends ParallelSelectiveReripTinyHyperGraphSolver {}
