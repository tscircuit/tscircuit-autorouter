import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import { hasImpossibleSameLayerCrossingGeometry } from "lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver/has-impossible-same-layer-crossing-geometry"
import { getIntraNodeCrossingsUsingCircle } from "lib/utils/getIntraNodeCrossingsUsingCircle"

test("electrically connected roots are not classified as an impossible crossing", () => {
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "cn_same_net_crossing",
    center: { x: 0, y: 0 },
    width: 2,
    height: 2,
    availableZ: [0],
    portPoints: [
      {
        connectionName: "source_trace_21",
        rootConnectionName: "source_trace_21",
        x: -1,
        y: 0,
        z: 0,
      },
      {
        connectionName: "source_trace_21",
        rootConnectionName: "source_trace_21",
        x: 1,
        y: 0,
        z: 0,
      },
      {
        connectionName: "source_trace_4_mst2",
        rootConnectionName: "source_trace_4",
        x: 0,
        y: -1,
        z: 0,
      },
      {
        connectionName: "source_trace_4_mst2",
        rootConnectionName: "source_trace_4",
        x: 0,
        y: 1,
        z: 0,
      },
    ],
  }

  const connMap = new ConnectivityMap({
    connectivity_net11: ["source_trace_21", "source_trace_4"],
  })

  expect(getIntraNodeCrossingsUsingCircle(node, connMap)).toEqual({
    numSameLayerCrossings: 0,
    numEntryExitLayerChanges: 0,
    numTransitionPairCrossings: 0,
  })
  expect(hasImpossibleSameLayerCrossingGeometry(node, connMap)).toBe(false)
})
