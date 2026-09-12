import { Candidate } from "./types1";
import { MultiHeadPolyLineIntraNodeSolver2 } from "./MultiHeadPolyLineIntraNodeSolver2_Optimized";
export class MultiHeadPolyLineIntraNodeSolver3 extends MultiHeadPolyLineIntraNodeSolver2 {
  static override solverKind = "multi-head3"
  static override diagnosticFields = [...MultiHeadPolyLineIntraNodeSolver2.diagnosticFields]
  override getSolverName(): string { return "MultiHeadPolyLineIntraNodeSolver3" }
  constructor(props: ConstructorParameters<typeof MultiHeadPolyLineIntraNodeSolver2>[0]) { super(props) }
  createInitialCandidateFromSeed(shuffleSeed: number): Candidate | null { return this.invoke<Candidate | null>("createInitialCandidateFromSeed", [shuffleSeed]) }
  setupInitialPolyLines(): void { this.invoke<null>("setupInitialPolyLines", []) }
}
