import type { CapacityMeshNodeId } from "./capacity-mesh-types"

export type CapacityPathId = string

export interface CapacityPath {
  capacityPathId: CapacityPathId
  connectionName: string
  originalConnectionName?: string
  isPortalFragment?: boolean
  nodeIds: CapacityMeshNodeId[]
  portalSegments?: CapacityPortalSegment[]
}

export interface CapacityPortalSegment {
  connectionName: string
  fromNodeId: CapacityMeshNodeId
  toNodeId: CapacityMeshNodeId
  portalNodeId: CapacityMeshNodeId
}
