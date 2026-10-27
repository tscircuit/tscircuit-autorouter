import { SolverRuntime } from "@tscircuit/solver-utils"
import { BaseSolver } from "../../../BaseSolver"
import { RouteProposalSolver, type RouteProposal, type RoutingSnapshot } from "./RouteProposalSolver"
import { unpackRoutingInput, type PackedRoutingInput } from "./packedRoutingInput"
import { unpackRoutingSnapshot, type PackedRoutingSnapshot } from "./packedRoutingSnapshot"

export type SnapshotRouteBatchInput = {
  graph: PackedRoutingInput
  snapshot: PackedRoutingSnapshot
  routeIds: number[]
}

// One bounded workspace per execution isolate. Every task is self-contained;
// cache misses work on any worker and do not require worker affinity.
let workspace: { id: string; solver: RouteProposalSolver; wave?: number; snapshot?: RoutingSnapshot } | undefined

export class SnapshotRouteBatchSolver extends BaseSolver {
  static readonly solverName = "SnapshotRouteBatchSolver"
  private output?: RouteProposal[]

  constructor(private readonly input: SnapshotRouteBatchInput) {
    super()
  }

  override _step(): void {
    if (workspace?.id !== this.input.graph.id) {
      workspace = {id: this.input.graph.id, solver: new RouteProposalSolver(unpackRoutingInput(this.input.graph))}
    }
    if (workspace.wave !== this.input.snapshot.wave) {
      workspace.snapshot = unpackRoutingSnapshot(this.input.snapshot)
      workspace.wave = this.input.snapshot.wave
    }
    workspace.solver.setSnapshot(workspace.snapshot!)
    this.output = this.input.routeIds.map(routeId => workspace!.solver.search(routeId))
    this.solved = true
  }

  getOutput(): RouteProposal[] {
    if (!this.output) {
      throw new Error("Snapshot route batch has not completed")
    }
    return this.output
  }
}

SolverRuntime.registerSolver(SnapshotRouteBatchSolver)
