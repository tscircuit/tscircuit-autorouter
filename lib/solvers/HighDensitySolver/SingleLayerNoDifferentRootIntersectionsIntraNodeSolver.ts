import { SpecializedIntraNodeSolverAdapter } from "../../bindings/high-density/SpecializedIntraNodeSolverAdapter"
import type { HighDensityIntraNodeRoute, NodeWithPortPoints } from "lib/types/high-density-types";
export class SingleLayerNoDifferentRootIntersectionsIntraNodeSolver extends SpecializedIntraNodeSolverAdapter {
  static override solverKind = "single-layer"
  static override diagnosticFields = ["nodeWithPortPoints", "traceWidth", "viaDiameter", "solvedRoutes"]
  override getSolverName(): string { return "SingleLayerNoDifferentRootIntersectionsIntraNodeSolver" }
  declare nodeWithPortPoints: NodeWithPortPoints
  declare traceWidth: number
  declare viaDiameter: number
  declare solvedRoutes: HighDensityIntraNodeRoute[]
  constructor(props: {
        nodeWithPortPoints: NodeWithPortPoints;
        traceWidth?: number;
        viaDiameter?: number;
    }) { super(props) }
  static isApplicable(node: NodeWithPortPoints): boolean { return this.applicable("single-layer", node) }
}
