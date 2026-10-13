import { expect, test } from "bun:test"
import type { InputNodeWithPortPoints } from "lib/solvers/PortPointPathingSolver/PortPointPathingSolver"
import {
  indexInputNodesById,
  shouldIgnorePortPoint,
} from "lib/solvers/UniformPortDistributionSolver/shouldIgnorePortPoint"
import type { PortPoint } from "lib/types/high-density-types"

test("indexed target lookups preserve first-node precedence", () => {
  const nodeGeometry = {
    center: { x: 0, y: 0 },
    width: 1,
    height: 1,
    availableZ: [0],
  }
  const inputNodes: InputNodeWithPortPoints[] = [
    {
      ...nodeGeometry,
      capacityMeshNodeId: "owner",
      portPoints: [
        {
          portPointId: "shared",
          x: 0,
          y: 0,
          z: 0,
          connectionNodeIds: ["plain", "plain"],
          distToCentermostPortOnZ: 0,
        },
      ],
    },
    {
      ...nodeGeometry,
      capacityMeshNodeId: "owner",
      portPoints: [],
      _containsTarget: true,
    },
    {
      ...nodeGeometry,
      capacityMeshNodeId: "plain",
      portPoints: [],
    },
  ]
  const portPoint: PortPoint = {
    portPointId: "shared",
    connectionName: "signal",
    x: 0,
    y: 0,
    z: 0,
  }

  expect(
    shouldIgnorePortPoint({
      portPoint,
      ownerNodeIds: ["owner", "plain"],
      inputNodeById: indexInputNodesById(inputNodes),
    }),
  ).toBeFalse()
})
