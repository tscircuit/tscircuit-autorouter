import {
  FixedCopperClearanceIndex,
  type FixedCopperRectangle,
} from "lib/data-structures/FixedCopperClearanceIndex"
import type {
  InputNodeWithPortPoints,
  InputPortPoint,
} from "lib/solvers/PortPointPathingSolver/PortPointPathingSolver"
import type {
  UniformPortDistributionSolverInput,
  UniformPortPhysicalClearanceContext,
} from "lib/solvers/UniformPortDistributionSolver/UniformPortDistributionSolver"
import type {
  NodeWithPortPoints,
  PortPoint,
} from "lib/types/high-density-types"

type NamedPortPoint = PortPoint & { portPointId: string }

type UniformPhysicalClearanceTestInput = UniformPortDistributionSolverInput & {
  physicalClearanceContext: UniformPortPhysicalClearanceContext
}

export const createUniformPhysicalClearanceInput = (params: {
  orientation: "horizontal" | "vertical"
  axisStart: number
  axisEnd: number
  sharedCoordinate: number
  portPoints: readonly NamedPortPoint[]
  rectangles: readonly FixedCopperRectangle[]
  canonicalNetIdByConnectionName: ReadonlyMap<string, string>
  traceWidth: number
  traceToPadClearance: number
  traceToTraceClearance: number
}): UniformPhysicalClearanceTestInput => {
  const axisCenter = (params.axisStart + params.axisEnd) / 2
  const axisLength = params.axisEnd - params.axisStart
  const nodeWithPortPoints: NodeWithPortPoints[] = []
  const inputNodesWithPortPoints: InputNodeWithPortPoints[] = []
  const ownerNodeIds: [string, string] = ["first-owner", "second-owner"]
  for (let index = 0; index < ownerNodeIds.length; index++) {
    const perpendicularCenter = params.sharedCoordinate + index - 0.5
    const center = {
      x: params.orientation === "horizontal" ? axisCenter : perpendicularCenter,
      y: params.orientation === "horizontal" ? perpendicularCenter : axisCenter,
    }
    const width = params.orientation === "horizontal" ? axisLength : 1
    const height = params.orientation === "horizontal" ? 1 : axisLength
    nodeWithPortPoints.push({
      capacityMeshNodeId: ownerNodeIds[index],
      center,
      width,
      height,
      availableZ: [0, 1],
      portPoints: structuredClone([...params.portPoints]),
    })
    const inputPortPoints = params.portPoints.map((point): InputPortPoint => {
      return {
        portPointId: point.portPointId,
        x: point.x,
        y: point.y,
        z: point.z,
        connectionNodeIds: [...ownerNodeIds],
        distToCentermostPortOnZ: 0,
      }
    })
    inputNodesWithPortPoints.push({
      capacityMeshNodeId: ownerNodeIds[index],
      center: { ...center },
      width,
      height,
      availableZ: [0, 1],
      portPoints: inputPortPoints,
    })
  }
  return {
    nodeWithPortPoints,
    inputNodesWithPortPoints,
    obstacles: [],
    physicalClearanceContext: {
      rectangles: params.rectangles,
      traceClearanceIndex: new FixedCopperClearanceIndex({
        rectangles: params.rectangles,
        layerCount: 2,
        minClearance: params.traceToPadClearance,
      }),
      layerCount: 2,
      traceWidth: params.traceWidth,
      traceToPadClearance: params.traceToPadClearance,
      traceToTraceClearance: params.traceToTraceClearance,
      canonicalNetIdByConnectionName: params.canonicalNetIdByConnectionName,
    },
  }
}
