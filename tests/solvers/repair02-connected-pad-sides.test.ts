import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { getConnectedPadSides } from "lib/solvers/HighDensityRepairSolver/getConnectedPadSides"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"

test("repair02 pad sides require a same-layer connected terminal on the boundary", () => {
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "cell",
    center: { x: 0, y: 0 },
    width: 4,
    height: 4,
    availableZ: [0, 1],
    portPoints: [],
  }
  const route: HighDensityRoute = {
    connectionName: "route-section",
    rootConnectionName: "root-route",
    route: [
      { x: 0, y: 0, z: 0 },
      { x: 0.2005, y: -2, z: 0 },
    ],
    traceThickness: 0.1,
    vias: [],
    viaDiameter: 0.5,
  }
  const pad: Obstacle & { __zLayers: number[] } = {
    type: "rect",
    center: { x: 0, y: -2.3 },
    width: 0.4,
    height: 0.6,
    layers: ["top"],
    __zLayers: [0],
    connectedTo: ["pad-alias"],
  }
  const connMap = new ConnectivityMap({ net: ["root-route", "pad-alias"] })
  expect(getConnectedPadSides(node, route, [pad], connMap)).toEqual(["bottom"])
  expect(
    getConnectedPadSides(
      node,
      route,
      [{ ...pad, connectedTo: ["other-net"] }],
      connMap,
    ),
  ).toEqual([])
  expect(
    getConnectedPadSides(node, route, [{ ...pad, __zLayers: [1] }], connMap),
  ).toEqual([])
  expect(
    getConnectedPadSides(
      node,
      route,
      [{ ...pad, center: { x: 2, y: -2.3 } }],
      connMap,
    ),
  ).toEqual([])
  expect(
    getConnectedPadSides({ ...node, height: 6 }, route, [pad], connMap),
  ).toEqual([])
})
