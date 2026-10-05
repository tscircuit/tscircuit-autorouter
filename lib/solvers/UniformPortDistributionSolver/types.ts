import { PortPoint } from "lib/types/high-density-types"

export type Side = "left" | "right" | "top" | "bottom"
export type OwnerPair = [string, string]
export type OwnerPairKey = string
export type EdgeOrientation = "vertical" | "horizontal"

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

export type PortPointWithOwnerPair = PortPoint & {
  ownerNodeIds: OwnerPair
  ownerPairKey: OwnerPairKey
}

export type SharedEdge = {
  ownerNodeIds: OwnerPair
  ownerPairKey: OwnerPairKey
  orientation: EdgeOrientation
  x1: number
  y1: number
  x2: number
  y2: number
  center: { x: number; y: number }
  length: number
  nodeSideByOwnerId: Record<string, Side>
}
