/** Shallow materialization only: geometry decisions and ordering live in Rust. */
export function spreadUniformPortPoint<T extends object>(
  point: T,
  x: number,
  y: number,
): T & { x: number; y: number } {
  return { ...point, x, y }
}

export function spreadUniformNode<T extends object>(
  node: T,
  portPoints?: unknown,
  portPointsInPairs?: unknown,
): T {
  if (arguments.length === 1) return { ...node }
  return { ...node, portPoints, portPointsInPairs }
}

/** Standard collection access stays with the owning JS array, including any
 * caller-provided find implementation. Rust owns the surrounding decisions. */
export function findUniformInputNode<T extends { capacityMeshNodeId: string }>(
  nodes: T[],
  ownerNodeId: string,
): T | undefined {
  return nodes.find((node) => node.capacityMeshNodeId === ownerNodeId)
}

export function findUniformInputPoint<T extends { portPointId?: string }>(
  points: T[],
  portPoint: { portPointId?: string },
): T | undefined {
  return points.find((point) => point.portPointId === portPoint.portPointId)
}

/** Preserve repeated property reads and their order; native code performs the
 * arithmetic after receiving these scalars. A fresh buffer is reentrant. */
export function readUniformObstacleScalars(obstacle: {
  center: { x: number; y: number }
  width: number
  height: number
}): Float64Array {
  return new Float64Array([
    obstacle.center.x,
    obstacle.width,
    obstacle.center.x,
    obstacle.width,
    obstacle.center.y,
    obstacle.height,
    obstacle.center.y,
    obstacle.height,
  ])
}
