export type CapacityMeshNodeId = string

export interface CapacityMesh {
  nodes: CapacityMeshNode[]
  edges: CapacityMeshEdge[]
}

export interface CapacityMeshNode {
  capacityMeshNodeId: string
  center: { x: number; y: number }
  width: number
  height: number
  layer: string
  availableZ: number[]

  _depth?: number

  _completelyInsideObstacle?: boolean
  _containsObstacle?: boolean
  _parentObstacleIds?: string[]
  _containsTarget?: boolean
  _targetConnectionName?: string
  _strawNode?: boolean
  _strawParentCapacityMeshNodeId?: CapacityMeshNodeId
  _isVirtualOffboard?: boolean
  _offboardNetName?: string

  _adjacentNodeIds?: CapacityMeshNodeId[]

  _offBoardConnectionId?: string
  _offBoardConnectedCapacityMeshNodeIds?: CapacityMeshNodeId[]

  _qfpRegionType?: "center" | "pad" | "pad-gap" | "corner"
  _isNarrowQfpPadGap?: boolean
  _soicRegionType?: "center" | "pad" | "pad-gap"

  _parent?: CapacityMeshNode
}

export interface CapacityMeshEdge {
  capacityMeshEdgeId: string
  nodeIds: [CapacityMeshNodeId, CapacityMeshNodeId]
  isOffboardEdge?: boolean
  offboardNetName?: string
}
