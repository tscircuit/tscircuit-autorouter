import { expect, spyOn, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { getConnectedPadSides } from "lib/solvers/HighDensityRepairSolver/getConnectedPadSides"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"

test("pad-side checks resolve nets only for pads containing the terminal", (): void => {
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "cell",
    center: { x: 0, y: 0 },
    width: 4,
    height: 4,
    availableZ: [0, 1],
    portPoints: [],
  }
  const route: HighDensityRoute = {
    connectionName: "signal",
    route: [
      { x: -2, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
    ],
    traceThickness: 0.1,
    viaDiameter: 0.5,
    vias: [],
  }
  const pad: Obstacle & { __zLayers: number[] } = {
    type: "rect",
    center: { x: -2, y: 0 },
    width: 0.4,
    height: 0.4,
    layers: ["top"],
    __zLayers: [0],
    connectedTo: ["signal-pad"],
  }
  const connMap = new ConnectivityMap({ net: ["signal", "signal-pad"] })
  const netLookup = spyOn(connMap, "areIdsConnected")
  try {
    const distantPads = [
      { ...pad, center: { x: -3, y: 0 } },
      { ...pad, center: { x: -2, y: 1 } },
      { ...pad, __zLayers: [1] },
    ]
    expect(getConnectedPadSides(node, route, distantPads, connMap)).toEqual([])
    expect(netLookup).not.toHaveBeenCalled()

    expect(
      getConnectedPadSides(node, route, [...distantPads, pad], connMap),
    ).toEqual(["left"])
    expect(netLookup).toHaveBeenCalledTimes(1)

    netLookup.mockClear()
    expect(
      getConnectedPadSides(
        node,
        route,
        [{ ...pad, connectedTo: ["unrelated"] }],
        connMap,
      ),
    ).toEqual([])
    expect(netLookup).toHaveBeenCalledTimes(1)
  } finally {
    netLookup.mockRestore()
  }
})
