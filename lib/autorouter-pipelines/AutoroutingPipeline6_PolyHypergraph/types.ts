import type {
  NodeWithPortPoints,
  PortPoint,
} from "lib/types/high-density-types";
import type { Point, ProjectedRect } from "./geometry";

export type PolyPortPoint = PortPoint & {
  originalPoint?: Point;
  projectedPoint?: Point;
};

export type PolyNodeWithPortPoints = Omit<NodeWithPortPoints, "portPoints"> & {
  polygon: Point[];
  portPoints: PolyPortPoint[];
  projectedRect?: ProjectedRect;
};
