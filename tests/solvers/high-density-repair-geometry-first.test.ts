import { expect, spyOn, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline4HighDensityRepairSolver } from "lib/solvers/HighDensityRepairSolver/Pipeline4HighDensityRepairSolver"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"

test("repair excludes contained pad routes without resolving distant obstacle nets", (): void => {
  const connMap = new ConnectivityMap({
    route_net: ["inside", "exiting", "pad"],
    foreign_net: ["far-pad"],
  })
  const connections = spyOn(connMap, "areIdsConnected")
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "node",
    center: { x: 1, y: 0 },
    width: 4,
    height: 2,
    portPoints: [
      { connectionName: "exiting", x: 0, y: 0, z: 0 },
      { connectionName: "exiting", x: 2, y: 0, z: 0 },
    ],
  }
  const inside: HighDensityRoute = {
    connectionName: "inside",
    traceThickness: 0.15,
    viaDiameter: 0.6,
    route: [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
    ],
    vias: [{ x: 0, y: 0 }],
  }
  const exiting: HighDensityRoute = {
    ...inside,
    connectionName: "exiting",
    route: [
      { x: 0, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
    ],
    vias: [],
  }
  const pad: Obstacle = {
    type: "rect",
    layers: ["top", "bottom"],
    center: { x: 0, y: 0 },
    width: 1,
    height: 1,
    connectedTo: ["pad"],
  }
  const solver = new Pipeline4HighDensityRepairSolver({
    nodeWithPortPoints: [node],
    hdRoutes: [inside, exiting],
    obstacles: [
      {
        ...pad,
        center: { x: 100, y: 100 },
        connectedTo: ["far-pad"],
      },
      pad,
    ],
    connMap,
  })

  expect(solver.sampleEntries).toHaveLength(1)
  expect(solver.sampleEntries[0].routeIndexes).toEqual([1])
  expect(connections.mock.calls.length).toBeGreaterThan(0)
  expect(
    connections.mock.calls.some(([, id]): boolean => id === "far-pad"),
  ).toBeFalse()
  connections.mockRestore()
})
