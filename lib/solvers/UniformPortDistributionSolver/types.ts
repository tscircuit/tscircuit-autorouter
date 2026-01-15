import { PortPoint } from "lib/types/high-density-types"

export type Side = "left" | "right" | "top" | "bottom"

export type Bounds = {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

export interface NodeAndSide {
  nodeId: string
  side: Side
}

export type PortPointWithSide = PortPoint & {
  side: Side
  ownerNodeId: string
}
