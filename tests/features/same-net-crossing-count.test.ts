import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import { getIntraNodeCrossings } from "lib/utils/getIntraNodeCrossings"
import nodeFixture from "tests/fixtures/ecp5-vref-fanout-node.json" with {
  type: "json",
}

test("branches the connectivity map joins are not counted as crossings", (): void => {
  const node = nodeFixture as NodeWithPortPoints
  const [vrefC2, vrefC3, vrefR2] = [
    ...new Set(node.portPoints.map((port) => port.connectionName)),
  ]
  const noCrossings = {
    numSameLayerCrossings: 0,
    numEntryExitLayerChanges: 0,
    numTransitionPairCrossings: 0,
  }

  expect(getIntraNodeCrossings(node).numSameLayerCrossings).toBe(3)
  expect(
    getIntraNodeCrossings(
      node,
      new ConnectivityMap({ vref: [vrefC2!, vrefC3!, vrefR2!] }),
    ),
  ).toEqual(noCrossings)
  expect(
    getIntraNodeCrossings(
      node,
      new ConnectivityMap({ vref: [vrefC2!, vrefC3!], other: [vrefR2!] }),
    ),
  ).toEqual({ ...noCrossings, numSameLayerCrossings: 2 })

  const layerChanges: NodeWithPortPoints = {
    ...node,
    portPoints: node.portPoints.map((port, index) => ({
      ...port,
      z: index % 2,
    })),
  }
  expect(getIntraNodeCrossings(layerChanges)).toEqual({
    numSameLayerCrossings: 0,
    numEntryExitLayerChanges: 3,
    numTransitionPairCrossings: 3,
  })
  expect(
    getIntraNodeCrossings(
      layerChanges,
      new ConnectivityMap({ vref: [vrefC2!, vrefC3!, vrefR2!] }),
    ),
  ).toEqual({ ...noCrossings, numEntryExitLayerChanges: 3 })
})
