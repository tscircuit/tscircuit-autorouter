import { SpecializedIntraNodeSolverAdapter } from "lib/bindings/high-density/SpecializedIntraNodeSolverAdapter"
import { HighDensityIntraNodeRoute, NodeWithPortPoints } from "lib/types/high-density-types";
type Point = {
    x: number;
    y: number;
    z?: number;
};
type Route = {
    startPort: Point;
    endPort: Point;
    connectionName: string;
};
export class TwoCrossingRoutesHighDensitySolver extends SpecializedIntraNodeSolverAdapter {
  static override solverKind = "two-crossing"
  static override diagnosticFields = ["nodeWithPortPoints", "routes", "viaDiameter", "traceThickness", "obstacleMargin", "layerCount", "debugViaPositions", "escapeLayer", "solvedRoutes", "bounds"]
  override getSolverName(): string { return "TwoCrossingRoutesHighDensitySolver" }
  declare nodeWithPortPoints: NodeWithPortPoints
  declare routes: Route[]
  declare viaDiameter: number
  declare traceThickness: number
  declare obstacleMargin: number
  declare layerCount: number
  declare debugViaPositions: {
        via1: Point;
        via2: Point;
    }[]
  declare escapeLayer: number
  declare solvedRoutes: HighDensityIntraNodeRoute[]
  declare bounds: {
        minX: number;
        maxX: number;
        minY: number;
        maxY: number;
    }
  constructor(props: {
        nodeWithPortPoints: NodeWithPortPoints;
        viaDiameter?: number;
        traceThickness?: number;
        obstacleMargin?: number;
        layerCount?: number;
    }) { super(props) }
  handleRoutesDontCross(): void { this.call(() => this.binding.handleRoutesDontCross()) }
  getSolvedRoutes(): HighDensityIntraNodeRoute[] { return this.solvedRoutes }
}
