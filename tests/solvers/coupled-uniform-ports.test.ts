import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import {
  UniformPortDistributionSolver,
  type UniformPortDistributionSolverInput,
} from "lib/solvers/UniformPortDistributionSolver/UniformPortDistributionSolver"
import type {
  NodeWithPortPoints,
  PortPoint,
} from "lib/types/high-density-types"
import type { InputNodeWithPortPoints } from "lib/solvers/PortPointPathingSolver/PortPointPathingSolver"

function checkCopiesAndSpacing(nodes: NodeWithPortPoints[]): void {
  const positions = new Map<string, PortPoint>()
  for (const node of nodes) {
    for (const point of node.portPoints) {
      if (!point.portPointId) continue
      const previous = positions.get(point.portPointId)
      if (previous)
        expect([point.x, point.y, point.z]).toEqual([
          previous.x,
          previous.y,
          previous.z,
        ])
      positions.set(point.portPointId, point)
    }
    for (const first of node.portPoints)
      for (const second of node.portPoints) {
        if (
          first === second ||
          first.z !== second.z ||
          first.rootConnectionName === second.rootConnectionName
        )
          continue
        expect(
          Math.hypot(first.x - second.x, first.y - second.y),
        ).toBeGreaterThanOrEqual(0.195 - 1e-10)
      }
  }
}

function createTwoFaceInput(): UniformPortDistributionSolverInput {
  const a = {
    portPointId: "A",
    x: 0,
    y: -0.05,
    z: 0,
    connectionName: "A",
    rootConnectionName: "A",
  }
  const b = {
    portPointId: "B",
    x: 0.1,
    y: 0.05,
    z: 0,
    connectionName: "B",
    rootConnectionName: "B",
  }
  const nodes = [
    {
      capacityMeshNodeId: "left",
      center: { x: -0.5, y: -0.05 },
      width: 1,
      height: 0.1,
      availableZ: [0],
      portPoints: [{ ...a }],
      portPointsInPairs: [],
    },
    {
      capacityMeshNodeId: "middle",
      center: { x: 0.05, y: 0 },
      width: 0.1,
      height: 0.2,
      availableZ: [0],
      portPoints: [{ ...a }, { ...b }],
      portPointsInPairs: [[{ ...a }, { ...b }]],
    },
    {
      capacityMeshNodeId: "right",
      center: { x: 0.6, y: 0.05 },
      width: 1,
      height: 0.1,
      availableZ: [0],
      portPoints: [{ ...b }],
      portPointsInPairs: [],
    },
  ] as NodeWithPortPoints[]
  const inputNodes: InputNodeWithPortPoints[] = nodes.map((node) => ({
    ...node,
    availableZ: node.availableZ!,
    portPoints: node.portPoints.map((port) => ({
      ...port,
      portPointId: port.portPointId!,
      distToCentermostPortOnZ: 0,
      connectionNodeIds: (port.portPointId === "A"
        ? ["left", "middle"]
        : ["middle", "right"]) as [string, string],
    })),
  }))
  return {
    nodeWithPortPoints: nodes,
    inputNodesWithPortPoints: inputNodes,
    obstacles: [],
    layerCount: 1,
    preserveSolitaryPorts: false,
    useLayerAwareGeometry: true,
    routingTraceWidth: 0.1,
    physicalSrj: {
      layerCount: 1,
      minTraceWidth: 0.1,
      bounds: { minX: -10, maxX: 10, minY: -10, maxY: 10 },
      obstacles: [],
      connections: [
        { name: "A", pointsToConnect: [] },
        { name: "B", pointsToConnect: [] },
      ],
      traces: [],
    },
  }
}

test("physical Uniform couples movable faces, preserves shared copies and never publishes an unresolved placement", (): void => {
  const fixture = JSON.parse(
    readFileSync(
      new URL(
        "../fixtures/sample24/coupled-uniform-endpoints.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as UniformPortDistributionSolverInput
  const snapshot = structuredClone(fixture)
  const actual = new UniformPortDistributionSolver(fixture)
  actual.solve()
  expect(actual.solved).toBe(true)
  expect(actual.failed).toBe(false)
  checkCopiesAndSpacing(actual.getOutput())
  expect(fixture).toEqual(snapshot)
  const both = createTwoFaceInput(),
    bothSnapshot = structuredClone(both)
  const solver = new UniformPortDistributionSolver(both)
  solver.solve()
  expect(solver.solved).toBe(true)
  checkCopiesAndSpacing(solver.getOutput())
  const middle = solver
    .getOutput()
    .find((node) => node.capacityMeshNodeId === "middle")!
  expect(middle.portPoints[0]!.y).toBeLessThan(-0.05)
  expect(middle.portPoints[1]!.y).toBeGreaterThan(0.05)
  expect(both).toEqual(bothSnapshot)
  const limited = new UniformPortDistributionSolver(createTwoFaceInput())
  limited.MAX_ITERATIONS = 1
  expect(() => limited.solve()).toThrow("UNRESOLVED")
  expect(limited.failed).toBe(true)
  expect(limited.solved).toBe(false)
  expect(limited.getOutput()).toEqual([])
})
