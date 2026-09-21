import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { getConnectedPadSides } from "lib/solvers/HighDensityRepairSolver/getConnectedPadSides"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"

type LayeredObstacle = Obstacle & { __zLayers: number[] }

class CountingConnectivityMap extends ConnectivityMap {
  queriedIds: string[] = []

  override areIdsConnected(first: string, second: string): boolean {
    this.queriedIds.push(second)
    return super.areIdsConnected(first, second)
  }
}

test("pad sides preserve terminal order and tolerance without querying remote or other-layer pads", (): void => {
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "node",
    center: { x: 0, y: 0 },
    width: 4,
    height: 4,
    availableZ: [0, 1],
    portPoints: [],
  }
  const route: HighDensityRoute = {
    connectionName: "section",
    rootConnectionName: "root",
    route: [
      { x: -2, y: -2, z: 0 },
      { x: 2, y: 2, z: 0 },
    ],
    traceThickness: 0.1,
    viaDiameter: 0.5,
    vias: [],
  }
  const remote: LayeredObstacle = {
    type: "rect",
    center: { x: 50, y: -2 },
    width: 0.6,
    height: 0.6,
    layers: ["top"],
    __zLayers: [0],
    connectedTo: ["remote-x"],
  }
  const obstacles: LayeredObstacle[] = [
    remote,
    { ...remote, center: { x: -2, y: 50 }, connectedTo: ["remote-y"] },
    {
      ...remote,
      center: { x: -2, y: -2 },
      layers: ["bottom"],
      __zLayers: [1],
      connectedTo: ["other-layer"],
    },
    {
      ...remote,
      center: { x: -2.3015, y: -2 },
      connectedTo: ["outside-tolerance"],
    },
    { ...remote, center: { x: -2.3005, y: -2 }, connectedTo: ["left-pad"] },
    { ...remote, center: { x: 2.3005, y: 2 }, connectedTo: ["right-pad"] },
  ]
  const connMap = new CountingConnectivityMap({
    net: [
      "root",
      "left-pad",
      "right-pad",
      "remote-x",
      "remote-y",
      "outside-tolerance",
      "other-layer",
    ],
  })
  expect(getConnectedPadSides(node, route, obstacles, connMap)).toEqual([
    "left",
    "bottom",
    "right",
    "top",
  ])
  expect(connMap.queriedIds).toEqual([
    "left-pad",
    "left-pad",
    "right-pad",
    "right-pad",
  ])
  connMap.queriedIds.length = 0
  expect(
    getConnectedPadSides(node, { ...route, route: [] }, obstacles, connMap),
  ).toEqual([])
  expect(connMap.queriedIds).toEqual([])
})
