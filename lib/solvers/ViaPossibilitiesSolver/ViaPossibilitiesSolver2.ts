import { SpecializedIntraNodeSolverAdapter } from "lib/bindings/high-density/SpecializedIntraNodeSolverAdapter"
import { Bounds, Point3 } from "@tscircuit/math-utils";
import { NodeWithPortPoints } from "lib/types/high-density-types";
import { PortPairMap } from "lib/utils/getPortPairs";
export type ConnectionName = string;
export interface Segment {
    start: Point3;
    end: Point3;
    connectionName: string;
}
export interface ViaPossibilities2HyperParameters {
    SHUFFLE_SEED?: number;
}
export class ViaPossibilitiesSolver2 extends SpecializedIntraNodeSolverAdapter {
  static override solverKind = "via-possibilities2"
  static override diagnosticFields = ["stats", "bounds", "maxViaCount", "portPairMap", "colorMap", "nodeWidth", "availableZ", "hyperParameters", "VIA_INTERSECTION_BUFFER_DISTANCE", "PLACEHOLDER_WALL_BUFFER_DISTANCE", "NEW_HEAD_WALL_BUFFER_DISTANCE", "viaDiameter", "unprocessedConnections", "completedPaths", "placeholderPaths", "currentHead", "currentConnectionName", "currentPath", "currentViaCount"]
  override getSolverName(): string { return "ViaPossibilitiesSolver2" }
  declare bounds: Bounds
  declare maxViaCount: number
  declare portPairMap: PortPairMap
  declare colorMap: Record<string, string>
  declare nodeWidth: number
  declare availableZ: number[]
  declare hyperParameters: ViaPossibilities2HyperParameters
  declare VIA_INTERSECTION_BUFFER_DISTANCE: number
  declare PLACEHOLDER_WALL_BUFFER_DISTANCE: number
  declare NEW_HEAD_WALL_BUFFER_DISTANCE: number
  declare viaDiameter: number
  declare unprocessedConnections: ConnectionName[]
  declare completedPaths: Map<ConnectionName, Point3[]>
  declare placeholderPaths: Map<ConnectionName, Point3[]>
  declare currentHead: Point3
  declare currentConnectionName: ConnectionName
  declare currentPath: Point3[]
  declare currentViaCount: number
  constructor(props: {
        nodeWithPortPoints: NodeWithPortPoints;
        colorMap?: Record<string, string>;
        hyperParameters?: ViaPossibilities2HyperParameters;
        viaDiameter?: number;
    }) { super(props) }
  _padByNewHeadWallBuffer(point: Point3): {
        x: number;
        y: number;
        z: number;
    } { return this.invoke<{
        x: number;
        y: number;
        z: number;
    }>("_padByNewHeadWallBuffer", [point]) }
  _padByPlaceholderWallBuffer(point: Point3): {
        x: number;
        y: number;
        z: number;
    } { return this.invoke<{
        x: number;
        y: number;
        z: number;
    }>("_padByPlaceholderWallBuffer", [point]) }
}
