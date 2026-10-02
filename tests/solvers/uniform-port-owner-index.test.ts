import { expect, test } from "bun:test"
import type {
  InputNodeWithPortPoints,
  InputPortPoint,
} from "lib/solvers/PortPointPathingSolver/PortPointPathingSolver"
import {
  determineOwnerPair,
  indexPortPointOwnerNodes,
} from "lib/solvers/UniformPortDistributionSolver/determineOwnerPair"

test("indexed port ownership preserves first-match and missing-owner behavior", (): void => {
  const makePoint = (
    id: string,
    owners?: [string, string],
  ): InputPortPoint => ({
    portPointId: id,
    x: 0,
    y: 0,
    z: 0,
    // Exercise legacy inputs with missing ownership metadata.
    connectionNodeIds: owners!,
    distToCentermostPortOnZ: 0,
  })
  const inputNodes: InputNodeWithPortPoints[] = [
    {
      capacityMeshNodeId: "a",
      center: { x: 0, y: 0 },
      width: 1,
      height: 1,
      availableZ: [0],
      portPoints: [
        makePoint("shared", ["b", "a"]),
        makePoint("duplicate"),
        makePoint("duplicate", ["wrong", "owner"]),
        makePoint("unowned"),
        makePoint("invalid", ["", "a"]),
      ],
    },
    {
      capacityMeshNodeId: "b",
      center: { x: 1, y: 0 },
      width: 1,
      height: 1,
      availableZ: [0],
      portPoints: [
        makePoint("shared", ["wrong", "owner"]),
        makePoint("duplicate", ["c", "b"]),
        makePoint("invalid", ["a", "b"]),
      ],
    },
  ]
  const connectionNodeIdsByPortPointId = indexPortPointOwnerNodes(inputNodes)
  for (const currentNodeId of ["a", "b", "c"]) {
    for (const portPointId of [
      "shared",
      "duplicate",
      "unowned",
      "invalid",
      "missing",
      undefined,
    ]) {
      const params = { currentNodeId, portPointId, inputNodes }
      expect(
        determineOwnerPair({ ...params, connectionNodeIdsByPortPointId }),
      ).toEqual(determineOwnerPair(params))
    }
  }
  expect(connectionNodeIdsByPortPointId.get("shared")).toEqual(["b", "a"])
  expect(connectionNodeIdsByPortPointId.get("duplicate")).toEqual(["c", "b"])
})
