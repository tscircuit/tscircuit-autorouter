import { expect, test } from "bun:test"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import { getIntraNodeCrossings } from "lib/utils/getIntraNodeCrossings"
import nodeFixture from "tests/fixtures/ecp5-vref-fanout-node.json" with {
  type: "json",
}

test("shared VREF branches do not require vias to avoid one another", (): void => {
  const node = nodeFixture as NodeWithPortPoints
  expect(getIntraNodeCrossings(node).numSameLayerCrossings).toBe(0)

  const differentNets: NodeWithPortPoints = {
    ...node,
    portPoints: node.portPoints.map((port) => ({
      ...port,
      rootConnectionName: port.connectionName,
    })),
  }
  expect(getIntraNodeCrossings(differentNets).numSameLayerCrossings).toBe(3)
  const unspecifiedNets: NodeWithPortPoints = {
    ...node,
    portPoints: node.portPoints.map((port) => ({
      ...port,
      rootConnectionName: undefined,
    })),
  }
  expect(getIntraNodeCrossings(unspecifiedNets)).toEqual(
    getIntraNodeCrossings(differentNets),
  )
  const transitions: NodeWithPortPoints = {
    ...node,
    portPoints: node.portPoints.map((port, index) => ({
      ...port,
      z: index % 2,
    })),
  }
  expect(getIntraNodeCrossings(transitions)).toEqual({
    numSameLayerCrossings: 0,
    numEntryExitLayerChanges: 3,
    numTransitionPairCrossings: 0,
  })
})
