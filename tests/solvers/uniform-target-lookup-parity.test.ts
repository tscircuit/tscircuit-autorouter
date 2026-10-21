import { expect, test } from "bun:test"
import type { CapacityMeshNodeId } from "lib/types"
import type { PortPoint } from "lib/types/high-density-types"
import type {
  InputNodeWithPortPoints,
  InputPortPoint,
} from "lib/solvers/PortPointPathingSolver/PortPointPathingSolver"
import { UniformPortDistributionSolver } from "lib/solvers/UniformPortDistributionSolver/UniformPortDistributionSolver"
import { shouldIgnorePortPoint } from "lib/solvers/UniformPortDistributionSolver/shouldIgnorePortPoint"
import type { OwnerPair } from "lib/solvers/UniformPortDistributionSolver/types"
import { shouldIgnorePortPointReference } from "../fixtures/shouldIgnorePortPointReference"

test("indexed target checks preserve exhaustive first-match behavior", (): void => {
  const makePoint = ({
    id,
    owners,
  }: {
    id: string
    owners: OwnerPair
  }): InputPortPoint => ({
    portPointId: id,
    connectionNodeIds: owners,
    x: 0,
    y: 0,
    z: 0,
    distToCentermostPortOnZ: 0,
  })
  const makeNode = ({
    id,
    target,
    points,
  }: {
    id: CapacityMeshNodeId
    target?: boolean
    points: InputPortPoint[]
  }): InputNodeWithPortPoints => ({
    capacityMeshNodeId: id,
    _containsTarget: target,
    center: { x: 0, y: 0 },
    width: 1,
    height: 1,
    availableZ: [0],
    portPoints: points,
  })
  for (let mask = 0; mask < 32; mask++) {
    const inputNodes = [
      makeNode({
        id: "a",
        target: Boolean(mask & 1),
        points: [
          makePoint({ id: "shared", owners: ["b", "target"] }),
          makePoint({ id: "shared", owners: ["target", "target"] }),
          makePoint({ id: "missing", owners: ["unknown", "unknown"] }),
        ],
      }),
      makeNode({
        id: "b",
        target: Boolean(mask & 2),
        points: [makePoint({ id: "shared", owners: ["a", "missing"] })],
      }),
      makeNode({ id: "target", target: Boolean(mask & 4), points: [] }),
      makeNode({
        id: "a",
        target: Boolean(mask & 8),
        points: [makePoint({ id: "shared", owners: ["target", "target"] })],
      }),
    ]
    if (mask & 16) inputNodes.reverse()
    const solver = new UniformPortDistributionSolver({
      inputNodesWithPortPoints: inputNodes,
      nodeWithPortPoints: [],
      obstacles: [],
    })
    const { inputNodesById } = solver
    for (const id of ["shared", "missing", "absent", undefined]) {
      const portPoint: PortPoint = {
        portPointId: id,
        connectionName: "net",
        x: 0,
        y: 0,
        z: 0,
      }
      for (const ownerNodeIds of [
        ["a", "b"],
        ["a", "a"],
        ["unknown", "a"],
        ["unknown", "unknown"],
      ] as OwnerPair[]) {
        expect(
          shouldIgnorePortPoint({ portPoint, ownerNodeIds, inputNodesById }),
        ).toBe(
          shouldIgnorePortPointReference({ portPoint, ownerNodeIds, inputNodes }),
        )
      }
    }
    solver.solve()
    expect(inputNodesById.size).toBe(0)
  }
})
