import type {
  UniformName,
  UniformSharedEdge,
  UniformInputNodeWithPortPoints,
  UniformPortDistributionInput,
  UniformBounds,
  UniformNumber,
} from "../../../rust/capacity-autorouter-bindings/pkg/capacity_autorouter_bindings.js"
import type { InputNodeWithPortPoints } from "../../solvers/PortPointPathingSolver/PortPointPathingSolver"
import type {
  Bounds,
  SharedEdge,
} from "../../solvers/UniformPortDistributionSolver/types"
import type { UniformPortDistributionSolverInput } from "../../solvers/UniformPortDistributionSolver/UniformPortDistributionSolver"

export type EncodedName = UniformName

export function encodeNumber(value: number): UniformNumber {
  if (Object.is(value, -0)) return "-0"
  if (Number.isNaN(value)) return "NaN"
  if (value === Infinity) return "Infinity"
  if (value === -Infinity) return "-Infinity"
  return value
}

export function decodeNumber(value: UniformNumber): number {
  if (value === "-0") return -0
  if (value === "NaN") return NaN
  if (value === "Infinity") return Infinity
  if (value === "-Infinity") return -Infinity
  return value
}

export function encodeBounds(bounds: Bounds): UniformBounds {
  return {
    minX: encodeNumber(bounds.minX),
    maxX: encodeNumber(bounds.maxX),
    minY: encodeNumber(bounds.minY),
    maxY: encodeNumber(bounds.maxY),
  }
}

export function decodeBounds(bounds: UniformBounds): Bounds {
  return {
    minX: decodeNumber(bounds.minX),
    maxX: decodeNumber(bounds.maxX),
    minY: decodeNumber(bounds.minY),
    maxY: decodeNumber(bounds.maxY),
  }
}

export function encodeName(value: string): EncodedName {
  if (
    !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(
      value,
    )
  )
    return value
  const units: number[] = []
  for (let index = 0; index < value.length; index++)
    units.push(value.charCodeAt(index))
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

export function encodeInputNodes(
  nodes: InputNodeWithPortPoints[],
): UniformInputNodeWithPortPoints[] {
  return nodes.map((node) => ({
    portPoints: node.portPoints.map((point) => ({
      portPointId:
        point.portPointId == null ? null : encodeName(point.portPointId),
      connectionNodeIds: point.connectionNodeIds?.map(encodeName) ?? null,
    })),
  }))
}

export function encodeConstructorInput(
  input: UniformPortDistributionSolverInput,
): UniformPortDistributionInput {
  return {
    nodeWithPortPoints: input.nodeWithPortPoints.map((node) => ({
      capacityMeshNodeId: encodeName(node.capacityMeshNodeId),
      center: {
        x: encodeNumber(node.center.x),
        y: encodeNumber(node.center.y),
      },
      width: encodeNumber(node.width),
      height: encodeNumber(node.height),
      portPoints: node.portPoints.map((point) => ({
        portPointId:
          point.portPointId == null ? null : encodeName(point.portPointId),
        x: encodeNumber(point.x),
        y: encodeNumber(point.y),
      })),
    })),
    inputNodesWithPortPoints: encodeInputNodes(input.inputNodesWithPortPoints),
  }
}

export function decodeSharedEdge(edge: UniformSharedEdge): SharedEdge {
  return {
    ...edge,
    ownerNodeIds: [
      decodeName(edge.ownerNodeIds[0]),
      decodeName(edge.ownerNodeIds[1]),
    ],
    x1: decodeNumber(edge.x1),
    y1: decodeNumber(edge.y1),
    x2: decodeNumber(edge.x2),
    y2: decodeNumber(edge.y2),
    center: { x: decodeNumber(edge.center.x), y: decodeNumber(edge.center.y) },
    length: decodeNumber(edge.length),
    ownerPairKey: decodeName(edge.ownerPairKey),
    nodeSideByOwnerId: Object.fromEntries(
      edge.nodeSideByOwnerId.map(([name, side]) => [decodeName(name), side]),
    ),
  }
}
