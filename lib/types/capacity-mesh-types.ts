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
  _isComponentTopologyNode?: boolean
  _connectedTo?: string[]
  /**
   * Canonical net ids for fixed, preloaded copper occupying this node.
   *
   * This is kept separate from `_connectedTo` because those ids are resolved
   * through the active point-pair connectivity map. A generated point-pair
   * name can collide with an unrelated original fixed-net name.
   */
  _preloadedFixedNetIds?: string[]

  _parent?: CapacityMeshNode
}

export interface CapacityMeshEdge {
  capacityMeshEdgeId: string
  nodeIds: [CapacityMeshNodeId, CapacityMeshNodeId]
  isOffboardEdge?: boolean
  offboardNetName?: string
}
