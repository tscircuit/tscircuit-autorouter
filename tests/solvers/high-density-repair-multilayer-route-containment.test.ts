import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline4HighDensityRepairSolver } from "lib/solvers/HighDensityRepairSolver/Pipeline4HighDensityRepairSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"

test("repair preparation excludes only connected routes fully inside multilayer pads", () => {
  const obstacles: Obstacle[] = [
    { x: 100, layers: ["top", "bottom"], connectedTo: ["pad"] },
    { x: 0, layers: ["top", "bottom"], connectedTo: ["pad"] },
    { x: 5, layers: ["top"], connectedTo: ["pad"] },
    { x: 10, layers: ["top", "bottom"], connectedTo: ["other-net"] },
  ].map(({ x, layers, connectedTo }) => ({
    type: "rect",
    center: { x, y: 0 },
    width: 2,
    height: 2,
    layers,
    connectedTo,
  }))
  const routes: HighDensityRoute[] = [
    [-1.0005, 1.0005],
    [-1.002, 0],
    [0, 1.002],
    [4.5, 5.5],
    [9.5, 10.5],
  ].map(([startX, endX], index) => ({
    connectionName: `route-${index}`,
    rootConnectionName: "root",
    regionId: "node",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: startX, y: 0, z: 0 },
      { x: endX, y: 0, z: 1 },
    ],
    vias: [],
  }))
  const solver = new Pipeline4HighDensityRepairSolver({
    nodeWithPortPoints: [
      {
        capacityMeshNodeId: "node",
        center: { x: 5, y: 0 },
        width: 20,
        height: 4,
        portPoints: [],
      },
    ],
    hdRoutes: routes,
    obstacles,
    connMap: new ConnectivityMap({ net: ["root", "pad"] }),
  })
  expect(solver.sampleEntries.map((entry) => entry.routeIndexes)).toEqual([
    [1, 2, 3, 4],
  ])
  expect(
    solver.sampleEntries[0].sample.nodeHdRoutes!.map(
      (route) => route.connectionName,
    ),
  ).toEqual(["route-1", "route-2", "route-3", "route-4"])
})
