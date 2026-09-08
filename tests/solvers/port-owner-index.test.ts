import { expect, test } from "bun:test"
import type { InputNodeWithPortPoints } from "lib/solvers/PortPointPathingSolver/PortPointPathingSolver"
import { determineOwnerPair } from "lib/solvers/UniformPortDistributionSolver/determineOwnerPair"
import { getPortPointOwnerPairs } from "lib/solvers/UniformPortDistributionSolver/getPortPointOwnerPairs"

test("owner indexing preserves first-point and first-node ownership", (): void => {
  const inputNodes = [
    {
      capacityMeshNodeId: "a",
      portPoints: [
        { portPointId: "shared", connectionNodeIds: ["b", "a"] },
        { portPointId: "duplicate" },
        { portPointId: "duplicate", connectionNodeIds: ["wrong", "a"] },
        { portPointId: "malformed", connectionNodeIds: [] },
      ],
    },
    {
      capacityMeshNodeId: "b",
      portPoints: [
        { portPointId: "shared", connectionNodeIds: ["wrong", "b"] },
        { portPointId: "duplicate", connectionNodeIds: ["c", "b"] },
        { portPointId: "malformed", connectionNodeIds: ["a", "b"] },
        { portPointId: "empty-owner", connectionNodeIds: ["", "b"] },
      ],
    },
  ] as unknown as InputNodeWithPortPoints[]
  const indexed = getPortPointOwnerPairs(inputNodes)
  for (const currentNodeId of ["a", "b", "c"]) {
    for (const portPointId of [
      "shared",
      "duplicate",
      "malformed",
      "empty-owner",
      "missing",
    ]) {
      expect(
        indexed.get(portPointId) ?? [currentNodeId, currentNodeId],
      ).toEqual(determineOwnerPair({ portPointId, currentNodeId, inputNodes }))
    }
  }
  expect(indexed.get("shared")).toEqual(["a", "b"])
  expect(indexed.get("duplicate")).toEqual(["b", "c"])
})
