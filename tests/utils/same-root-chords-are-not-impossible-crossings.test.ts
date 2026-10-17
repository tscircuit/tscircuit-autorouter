import { expect, test } from "bun:test"
import { hasImpossibleSameLayerCrossingGeometry } from "lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver/invalidSameLayerCrossingGeometry"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import { getIntraNodeCrossingsUsingCircle } from "lib/utils/getIntraNodeCrossingsUsingCircle"

test("same-net MST branches may cross and join on one layer", (): void => {
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "same-net-crossing",
    center: { x: 0, y: 0 },
    width: 2,
    height: 2,
    availableZ: [5],
    portPoints: [
      { x: -1, y: -0.5, z: 5, connectionName: "a", rootConnectionName: "root" },
      { x: 1, y: 0.5, z: 5, connectionName: "a", rootConnectionName: "root" },
      { x: -1, y: 0.5, z: 5, connectionName: "b", rootConnectionName: "root" },
      { x: 1, y: -0.5, z: 5, connectionName: "b", rootConnectionName: "root" },
    ],
  }
  expect(
    getIntraNodeCrossingsUsingCircle(node, { ignoreSameRootCrossings: true })
      .numSameLayerCrossings,
  ).toBe(0)
  expect(hasImpossibleSameLayerCrossingGeometry(node)).toBeFalse()
  for (const port of node.portPoints.filter(
    (point) => point.connectionName === "b",
  )) {
    port.rootConnectionName = "foreign"
  }
  expect(getIntraNodeCrossingsUsingCircle(node).numSameLayerCrossings).toBe(1)
  expect(hasImpossibleSameLayerCrossingGeometry(node)).toBeTrue()
})
