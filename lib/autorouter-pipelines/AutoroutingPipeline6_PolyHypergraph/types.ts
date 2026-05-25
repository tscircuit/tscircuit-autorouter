import type {
  NodeWithPortPoints,
  PortPoint,
} from "lib/types/high-density-types"
import type { Point, ProjectedRect } from "./geometry"

export type PolyPortPoint = PortPoint & {
  originalPoint?: Point
  projectedPoint?: Point
}

export type PolyPortPointInPair = [PolyPortPoint, PolyPortPoint]

export type PolyNodeWithPortPoints = Omit<
  NodeWithPortPoints,
  "portPointsInPairs"
> & {
  polygon: Point[]
  portPointsInPairs: PolyPortPointInPair[]
  projectedRect?: ProjectedRect
}
