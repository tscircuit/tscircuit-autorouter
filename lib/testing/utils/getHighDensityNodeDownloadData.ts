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

export const getHighDensityNodeDownloadData = (
  solver: HighDensityDownloadSolver,
  nodeId: string,
): HighDensityNodeDownloadData => {
  const nodeSolverOutput = solver.nodeSolver?.getOutput?.()
  const portPointPathingOutput = solver.portPointPathingSolver?.getOutput?.()

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
      findHighDensityNodeById(solver, nodeId) ??
      findNodeById(
        nodeId,
        solver.uniformPortDistributionSolver?.getOutput?.(),
        solver.multiSectionPortPointOptimizer?.getNodesWithPortPoints?.(),
        solver.segmentToPointOptimizer?.getNodesWithPortPoints?.(),
        solver.unravelMultiSectionSolver?.getNodesWithPortPoints?.(),
        solver.portPointPathingSolver?.getNodesWithPortPoints?.(),
        portPointPathingOutput?.nodesWithPortPoints,
      ),
    inputNodeWithPortPoints: findNodeById(
      nodeId,
      portPointPathingOutput?.inputNodeWithPortPoints,
    ),
  }
}
