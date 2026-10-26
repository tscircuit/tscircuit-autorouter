import { expect, test } from "bun:test"
import type { InputNodeWithPortPoints } from "lib/solvers/PortPointPathingSolver/PortPointPathingSolver"
import { PhysicalSharedEdgePlacement } from "lib/solvers/UniformPortDistributionSolver/PhysicalSharedEdgePlacement"
import {
  UniformPortDistributionSolver,
  type UniformPortDistributionSolverInput,
} from "lib/solvers/UniformPortDistributionSolver/UniformPortDistributionSolver"
import type { Obstacle, SimpleRouteJson } from "lib/types"
import type {
  NodeWithPortPoints,
  PortPoint,
} from "lib/types/high-density-types"

function createInput(
  y: number,
  withPhysicalGeometry: boolean,
): UniformPortDistributionSolverInput {
  const port: PortPoint = {
    portPointId: "shared",
    x: 0,
    y,
    z: 0,
    connectionName: "signal",
    rootConnectionName: "signal-root",
  }
  const nodes: NodeWithPortPoints[] = [-0.5, 0.5].map((x, index) => ({
    capacityMeshNodeId: index === 0 ? "left" : "right",
    center: { x, y: 0 },
    width: 1,
    height: 2,
    availableZ: [0],
    portPoints: [{ ...port }],
    portPointsInPairs: [],
  }))
  const inputNodes: InputNodeWithPortPoints[] = nodes.map((node) => ({
    ...node,
    availableZ: [0],
    portPoints: [
      {
        ...port,
        portPointId: "shared",
        distToCentermostPortOnZ: 0,
        connectionNodeIds: ["left", "right"] as [string, string],
      },
    ],
  }))
  const obstacles: Obstacle[] = [
    {
      type: "rect",
      center: { x: 0.1, y: 0 },
      width: 0.2,
      height: 0.4,
      layers: ["top"],
      connectedTo: [],
    },
  ]
  const physicalSrj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
    obstacles,
    connections: [
      {
        name: "signal",
        __rootConnectionNames: ["signal-root"],
        pointsToConnect: [],
      },
    ],
  }
  return {
    nodeWithPortPoints: nodes,
    inputNodesWithPortPoints: inputNodes,
    obstacles,
    layerCount: 2,
    useLayerAwareGeometry: true,
    preserveSolitaryPorts: true,
    routingTraceWidth: 0.1,
    ...(withPhysicalGeometry ? { physicalSrj } : {}),
  }
}

test("solitary physical ports preserve legal positions and move clear of raw barriers", (): void => {
  const validInput = createInput(0.6, true)
  const valid = new UniformPortDistributionSolver(validInput)
  valid.solve()
  expect(valid.solved).toBeTrue()
  expect(valid.getOutput().map((node) => node.portPoints[0])).toEqual(
    validInput.nodeWithPortPoints.map((node) => node.portPoints[0]),
  )

  const legacyInput = createInput(0, false)
  const legacy = new UniformPortDistributionSolver(legacyInput)
  legacy.solve()
  expect(legacy.solved).toBeTrue()
  expect(legacy.getOutput().map((node) => node.portPoints[0])).toEqual(
    legacyInput.nodeWithPortPoints.map((node) => node.portPoints[0]),
  )

  const invalidInput = createInput(0, true)
  const original = structuredClone(invalidInput)
  const physical = new PhysicalSharedEdgePlacement(
    invalidInput.physicalSrj!,
    0.1,
  )
  expect(
    physical.isPortClear(invalidInput.nodeWithPortPoints[0]!.portPoints[0]!),
  ).toBeFalse()
  const invalid = new UniformPortDistributionSolver(invalidInput)
  invalid.solve()
  expect(invalid.solved).toBeTrue()
  const copies = invalid.getOutput().map((node) => node.portPoints[0]!)
  expect(copies[0]).toEqual(copies[1])
  const moved = copies[0]!
  expect([moved.portPointId, moved.x, moved.z]).toEqual(["shared", 0, 0])
  expect(Math.abs(moved.y) - 0.2).toBeGreaterThanOrEqual(0.05 - 1e-8)
  expect(Math.abs(moved.y)).toBeLessThanOrEqual(1)
  expect(physical.isPortClear(moved)).toBeTrue()
  expect(invalidInput).toEqual(original)
})
