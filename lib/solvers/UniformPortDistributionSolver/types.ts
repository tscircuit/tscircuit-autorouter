import { PortPoint } from "lib/types/high-density-types"

export type Side = "left" | "right" | "top" | "bottom"
export type OwnerPair = [string, string]
export type OwnerPairKey = string & { readonly __brand: "OwnerPairKey" }
export type PortPointId = string & { readonly __brand: "PortPointId" }
export type EdgeOrientation = "vertical" | "horizontal"

export type CoordinateInterval = {
  min: number
  max: number
}

type BoundaryPortKeepoutBase = {
  keepoutId: string
  z: number
  connectedTo: string[]
  portPathingReservation: "sampled-coordinate" | "full-edge"
  removablePreloadedTraceSection?: {
    traceId: string
    startRoutePosition: number
    endRoutePosition: number
  }
}

export type BoundaryPortCapsuleKeepout = BoundaryPortKeepoutBase & {
  shape: "capsule"
  start: { x: number; y: number }
  end: { x: number; y: number }
  copperRadius: number
}

export type BoundaryPortRectKeepout = BoundaryPortKeepoutBase & {
  shape: "rect"
  center: { x: number; y: number }
  width: number
  height: number
}

export type BoundaryPortKeepout =
  | BoundaryPortCapsuleKeepout
  | BoundaryPortRectKeepout

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
