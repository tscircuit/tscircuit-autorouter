import { PolyLine2 } from "./types2";
import { MultiHeadPolyLineIntraNodeSolver } from "./MultiHeadPolyLineIntraNodeSolver";
export class MultiHeadPolyLineIntraNodeSolver2 extends MultiHeadPolyLineIntraNodeSolver {
  static override solverKind = "multi-head2"
  static override diagnosticFields = [...MultiHeadPolyLineIntraNodeSolver.diagnosticFields]
  override getSolverName(): string { return "MultiHeadPolyLineIntraNodeSolver2" }
  computeG(polyLines: any, candidate: any): any { return this.invoke<any>("computeG", [polyLines, candidate]) }
  computeH(candidate: any): number { return this.invoke<number>("computeH", [candidate]) }
  applyForcesToPolyLines(polyLines: PolyLine2[]): {
        lastStepMoved: boolean;
        magForceApplied: number;
    } { return this.invoke<{
        lastStepMoved: boolean;
        magForceApplied: number;
    }>("applyForcesToPolyLines", [polyLines]) }
}
