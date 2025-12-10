import type { CapacityMeshNodeId } from "./capacity-mesh-types"

export type CapacityPathId = string

export interface CapacityPath {
  capacityPathId: CapacityPathId
  connectionName: string
  rootConnectionName?: string
  nodeIds: CapacityMeshNodeId[]
  /** True if this path was created by splitting at an offboard edge */
  isFragmentedPath?: boolean
  /** MST pair connection name before fragmentation */
  mstPairConnectionName?: string
}
