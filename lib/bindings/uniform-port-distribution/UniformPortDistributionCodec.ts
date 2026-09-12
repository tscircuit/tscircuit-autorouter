import type { InputNodeWithPortPoints } from "../../solvers/PortPointPathingSolver/PortPointPathingSolver"
import type { Bounds, OwnerPair, SharedEdge, Side } from "../../solvers/UniformPortDistributionSolver/types"
import type { UniformPortDistributionSolverInput } from "../../solvers/UniformPortDistributionSolver/UniformPortDistributionSolver"

export type EncodedName = string | { __utf16: number[] }
export type EncodedSharedEdge = Omit<SharedEdge, "ownerNodeIds" | "ownerPairKey" | "nodeSideByOwnerId"> & {
  ownerNodeIds: [EncodedName, EncodedName]
  ownerPairKey: EncodedName
  nodeSideByOwnerId: Array<[EncodedName, Side]>
}
export type UniformPortDistributionState = {
  nodeBounds: Array<[EncodedName, Bounds]>
  ownerPairPortPoints: Array<[EncodedName, Array<{
    nodeIndex: number
    pointIndex: number
    ownerNodeIds: [EncodedName, EncodedName]
    ownerPairKey: EncodedName
  }>]>
  sharedEdges: Array<[EncodedName, EncodedSharedEdge]>
  ownerPairsToProcess: EncodedName[]
}
type EncodedInputNode = {
  portPoints: Array<{ portPointId: EncodedName | undefined; connectionNodeIds: EncodedName[] | undefined }>
}
type EncodedConstructorInput = {
  nodeWithPortPoints: Array<{
    capacityMeshNodeId: EncodedName
    center: { x: number; y: number }
    width: number
    height: number
    portPoints: Array<{ portPointId: EncodedName | undefined; x: number; y: number }>
  }>
  inputNodesWithPortPoints: EncodedInputNode[]
}

export function encodeName(value: string): EncodedName {
  if (!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) return value
  const units: number[] = []
  for (let index = 0; index < value.length; index++) units.push(value.charCodeAt(index))
  return { __utf16: units }
}

export function decodeName(value: EncodedName): string {
  if (typeof value === "string") return value
  let text = ""
  for (let start = 0; start < value.__utf16.length; start += 4096) {
    text += String.fromCharCode(...value.__utf16.slice(start, start + 4096))
  }
  return text
}

export function encodeInputNodes(nodes: InputNodeWithPortPoints[]): EncodedInputNode[] {
  return nodes.map(node => ({
    portPoints: node.portPoints.map(point => ({
      portPointId: point.portPointId == null ? undefined : encodeName(point.portPointId),
      connectionNodeIds: point.connectionNodeIds?.map(encodeName),
    })),
  }))
}

export function encodeConstructorInput(input: UniformPortDistributionSolverInput): EncodedConstructorInput {
  return {
    nodeWithPortPoints: input.nodeWithPortPoints.map(node => ({
      capacityMeshNodeId: encodeName(node.capacityMeshNodeId),
      center: node.center,
      width: node.width,
      height: node.height,
      portPoints: node.portPoints.map(point => ({
        portPointId: point.portPointId == null ? undefined : encodeName(point.portPointId),
        x: point.x,
        y: point.y,
      })),
    })),
    inputNodesWithPortPoints: encodeInputNodes(input.inputNodesWithPortPoints),
  }
}

export function decodeSharedEdge(edge: EncodedSharedEdge): SharedEdge {
  return {
    ...edge,
    ownerNodeIds: edge.ownerNodeIds.map(decodeName) as OwnerPair,
    ownerPairKey: decodeName(edge.ownerPairKey),
    nodeSideByOwnerId: Object.fromEntries(edge.nodeSideByOwnerId.map(([name, side]) => [decodeName(name), side])),
  }
}
