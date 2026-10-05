import type { CapacityMeshNode } from "lib/types"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import type { InputNodeWithPortPoints } from "lib/solvers/PortPointPathingSolver/PortPointPathingSolver"

type NodeLike = {
  capacityMeshNodeId: string
}

type NodeSolverOutput = {
  meshNodes?: CapacityMeshNode[]
}

type PortPointPathingOutput = {
  nodesWithPortPoints?: NodeWithPortPoints[]
  inputNodeWithPortPoints?: InputNodeWithPortPoints[]
}

type HighDensityRouteSolver = {
  unsolvedNodePortPoints?: NodeWithPortPoints[]
  allNodes?: NodeWithPortPoints[]
  unsolvedNodes?: NodeWithPortPoints[]
  nodeSolveMetadataById?: Map<
    string,
    {
      node: NodeWithPortPoints
    }
  >
}

type HighDensityDownloadSolver = {
  nodeTargetMerger?: {
    newNodes?: CapacityMeshNode[]
  }
  nodeSolver?: {
    finishedNodes?: CapacityMeshNode[]
    getOutput?: () => NodeSolverOutput
  }
  capacityNodes?: CapacityMeshNode[]
  highDensityNodePortPoints?: NodeWithPortPoints[]
  highDensityRouteSolver?: HighDensityRouteSolver
  uniformPortDistributionSolver?: {
    getOutput?: () => NodeWithPortPoints[]
  }
  multiSectionPortPointOptimizer?: {
    getNodesWithPortPoints?: () => NodeWithPortPoints[]
  }
  segmentToPointOptimizer?: {
    getNodesWithPortPoints?: () => NodeWithPortPoints[]
  }
  unravelMultiSectionSolver?: {
    getNodesWithPortPoints?: () => NodeWithPortPoints[]
  }
  portPointPathingSolver?: {
    getNodesWithPortPoints?: () => NodeWithPortPoints[]
    getOutput?: () => PortPointPathingOutput
  }
}

type HighDensityNodeDownloadData = {
  nodeId: string
  capacityMeshNode: CapacityMeshNode | null
  nodeWithPortPoints: NodeWithPortPoints | null
  inputNodeWithPortPoints: InputNodeWithPortPoints | null
}

const isRecord = (value: unknown): value is Record<string, any> =>
  value !== null && typeof value === "object"

type SolverLike = Record<string, any> & {
  getNodesWithPortPoints?: () => unknown
  getOutput?: () => unknown
  getConstructorParams?: () => unknown
}

const hasPortPoints = (
  value: unknown,
): value is {
  capacityMeshNodeId: string
  portPoints: unknown[]
} =>
  isRecord(value) &&
  typeof value.capacityMeshNodeId === "string" &&
  Array.isArray(value.portPoints)

const isInputPortPointNode = (
  value: unknown,
): value is InputNodeWithPortPoints =>
  hasPortPoints(value) &&
  value.portPoints.every(
    (portPoint) =>
      isRecord(portPoint) &&
      !("x" in portPoint) &&
      !("y" in portPoint) &&
      !("z" in portPoint),
  )

const isResolvedPortPointNode = (value: unknown): value is NodeWithPortPoints =>
  hasPortPoints(value) &&
  value.portPoints.some(
    (portPoint) =>
      isRecord(portPoint) &&
      typeof portPoint.x === "number" &&
      typeof portPoint.y === "number",
  )

const findNodeById = <T extends NodeLike>(
  nodeId: string,
  ...collections: Array<T[] | undefined>
): T | null => {
  for (const nodes of collections) {
    const match = nodes?.find((node) => node.capacityMeshNodeId === nodeId)
    if (match) {
      return match
    }
  }

  return null
}

const findHighDensityNodeById = (
  solver: HighDensityDownloadSolver,
  nodeId: string,
): NodeWithPortPoints | null => {
  const solverMetadataNode =
    solver.highDensityRouteSolver?.nodeSolveMetadataById?.get(nodeId)?.node
  if (solverMetadataNode) {
    return solverMetadataNode
  }

  return findNodeById(
    nodeId,
    solver.highDensityNodePortPoints,
    solver.highDensityRouteSolver?.unsolvedNodePortPoints,
    solver.highDensityRouteSolver?.allNodes,
    solver.highDensityRouteSolver?.unsolvedNodes,
  )
}

const safelyCall = <T>(fn: () => T): T | null => {
  try {
    return fn()
  } catch {
    return null
  }
}

const findPortPointNodeInUnknownValue = <
  T extends {
    capacityMeshNodeId: string
    portPoints: unknown[]
  },
>(
  nodeId: string,
  value: unknown,
  predicate: (value: unknown) => value is T,
  seen = new WeakSet<object>(),
): T | null => {
  if (Array.isArray(value)) {
    for (const item of value) {
      const match = findPortPointNodeInUnknownValue(
        nodeId,
        item,
        predicate,
        seen,
      )
      if (match) return match
    }
    return null
  }

  if (!isRecord(value)) {
    return null
  }

  const solverLike = value as SolverLike

  if (value instanceof Map) {
    if (seen.has(value)) {
      return null
    }
    seen.add(value)

    for (const [key, item] of value.entries()) {
      const directMatch =
        predicate(item) && item.capacityMeshNodeId === nodeId
          ? item
          : isRecord(item) &&
              predicate(item.node) &&
              item.node.capacityMeshNodeId === nodeId
            ? item.node
            : null
      if (directMatch) return directMatch

      const keyMatch = findPortPointNodeInUnknownValue(
        nodeId,
        key,
        predicate,
        seen,
      )
      if (keyMatch) return keyMatch

      const valueMatch = findPortPointNodeInUnknownValue(
        nodeId,
        item,
        predicate,
        seen,
      )
      if (valueMatch) return valueMatch
    }
    return null
  }

  if (seen.has(value)) {
    return null
  }
  seen.add(value)

  if (predicate(value) && value.capacityMeshNodeId === nodeId) {
    return value
  }

  if (typeof solverLike.getNodesWithPortPoints === "function") {
    const nodesWithPortPoints = safelyCall(() =>
      solverLike.getNodesWithPortPoints!(),
    )
    if (nodesWithPortPoints !== null) {
      const match = findPortPointNodeInUnknownValue(
        nodeId,
        nodesWithPortPoints,
        predicate,
        seen,
      )
      if (match) return match
    }
  }

  if (typeof solverLike.getOutput === "function") {
    const output = safelyCall(() => solverLike.getOutput!())
    if (output !== null) {
      const match = findPortPointNodeInUnknownValue(
        nodeId,
        output,
        predicate,
        seen,
      )
      if (match) return match
    }
  }

  if (typeof solverLike.getConstructorParams === "function") {
    const constructorParams = safelyCall(() =>
      solverLike.getConstructorParams!(),
    )
    if (constructorParams !== null) {
      const match = findPortPointNodeInUnknownValue(
        nodeId,
        constructorParams,
        predicate,
        seen,
      )
      if (match) return match
    }
  }

  for (const propertyValue of Object.values(value)) {
    const match = findPortPointNodeInUnknownValue(
      nodeId,
      propertyValue,
      predicate,
      seen,
    )
    if (match) {
      return match
    }
  }

  return null
}

export const getHighDensityNodeDownloadData = (
  solver: HighDensityDownloadSolver,
  nodeId: string,
): HighDensityNodeDownloadData => {
  const nodeSolverOutput = solver.nodeSolver?.getOutput?.()
  const portPointPathingOutput = solver.portPointPathingSolver?.getOutput?.()
  const knownResolvedPortPointNode =
    findHighDensityNodeById(solver, nodeId) ??
    findNodeById(
      nodeId,
      solver.uniformPortDistributionSolver?.getOutput?.(),
      solver.multiSectionPortPointOptimizer?.getNodesWithPortPoints?.(),
      solver.segmentToPointOptimizer?.getNodesWithPortPoints?.(),
      solver.unravelMultiSectionSolver?.getNodesWithPortPoints?.(),
      solver.portPointPathingSolver?.getNodesWithPortPoints?.(),
      portPointPathingOutput?.nodesWithPortPoints,
    )
  const knownInputPortPointNode = findNodeById(
    nodeId,
    portPointPathingOutput?.inputNodeWithPortPoints,
  )

  return {
    nodeId,
    capacityMeshNode: findNodeById(
      nodeId,
      solver.nodeTargetMerger?.newNodes,
      solver.nodeSolver?.finishedNodes,
      nodeSolverOutput?.meshNodes,
      solver.capacityNodes,
    ),
    nodeWithPortPoints:
      knownResolvedPortPointNode ??
      findPortPointNodeInUnknownValue(nodeId, solver, isResolvedPortPointNode),
    inputNodeWithPortPoints:
      knownInputPortPointNode ??
      findPortPointNodeInUnknownValue(nodeId, solver, isInputPortPointNode),
  }
}
