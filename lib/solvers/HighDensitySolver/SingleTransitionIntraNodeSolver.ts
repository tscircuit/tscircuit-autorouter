import { SpecializedIntraNodeSolverAdapter } from "../../bindings/high-density/SpecializedIntraNodeSolverAdapter"
import { HighDensityIntraNodeRoute, NodeWithPortPoints, PortPoint } from "lib/types/high-density-types";
type Route = {
    A: PortPoint;
    B: PortPoint;
    connectionName: string;
};
type NodeBounds = {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
};
export class SingleTransitionIntraNodeSolver extends SpecializedIntraNodeSolverAdapter {
  static override solverKind = "single-transition"
  static override diagnosticFields = ["nodeWithPortPoints", "routes", "viaDiameter", "traceThickness", "obstacleMargin", "solvedRoutes", "bounds"]
  override getSolverName(): string { return "SingleTransitionIntraNodeSolver" }
  declare nodeWithPortPoints: NodeWithPortPoints
  declare routes: Route[]
  declare viaDiameter: number
  declare traceThickness: number
  declare obstacleMargin: number
  declare solvedRoutes: HighDensityIntraNodeRoute[]
  declare bounds: NodeBounds
  constructor(props: {
        nodeWithPortPoints: NodeWithPortPoints;
        viaDiameter?: number;
        traceThickness?: number;
        obstacleMargin?: number;
    }) { super(props) }
}
