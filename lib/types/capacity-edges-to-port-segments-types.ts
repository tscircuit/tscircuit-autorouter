export interface NodePortSegment {
  capacityMeshNodeId: string
  nodePortSegmentId?: string
  start: { x: number; y: number }
  end: { x: number; y: number }
  availableZ: number[]
  connectionNames: string[]
  rootConnectionNames?: string[]
}
