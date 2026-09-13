import { PolyLine2 } from "./types2"
import { MultiHeadPolyLineIntraNodeSolver } from "./MultiHeadPolyLineIntraNodeSolver"
export class MultiHeadPolyLineIntraNodeSolver2 extends MultiHeadPolyLineIntraNodeSolver {
  static override solverKind = "multi-head2"
  static override diagnosticFields = [
    ...MultiHeadPolyLineIntraNodeSolver.diagnosticFields,
  ]
  override getSolverName(): string {
    return "MultiHeadPolyLineIntraNodeSolver2"
  }
  computeG(polyLines: any, candidate: any): any {
    return this.call(
      () => this.binding.computeG(polyLines, candidate),
      [polyLines, candidate],
    )
  }
  computeH(candidate: any): number {
    return this.call(() => this.binding.computeH(candidate), [candidate])
  }
  applyForcesToPolyLines(polyLines: PolyLine2[]): {
    lastStepMoved: boolean
    magForceApplied: number
  } {
    return this.call(
      () => this.binding.applyForcesToPolyLines(polyLines),
      [polyLines],
    )
  }
}
