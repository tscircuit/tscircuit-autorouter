import { expect, spyOn, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline4HighDensityRepairSolver } from "lib/solvers/HighDensityRepairSolver/Pipeline4HighDensityRepairSolver"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"

test("high-density repair ignores connected obstacles when given a connMap", () => {
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "node-1",
    center: { x: 0, y: 0 },
    width: 2,
    height: 2,
    portPoints: [
      { connectionName: "route-a", x: -1, y: 0, z: 0 },
      { connectionName: "route-a", x: 1, y: 0, z: 0 },
    ],
  }
  const route: HighDensityRoute = {
    connectionName: "route-a",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: -1, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
    ],
    vias: [],
  }
  const connectedObstacle: Obstacle = {
    type: "rect",
    layers: ["top"],
    center: { x: -1.1, y: 0 },
    width: 0.4,
    height: 0.4,
    connectedTo: ["pad-a"],
  }
  const foreignObstacle: Obstacle = {
    type: "rect",
    layers: ["top"],
    center: { x: 1.1, y: 0 },
    width: 0.4,
    height: 0.4,
    connectedTo: ["pad-b"],
  }
  const connMap = new ConnectivityMap({
    netA: ["route-a", "pad-a"],
    netB: ["pad-b"],
  })

  const solver = new Pipeline4HighDensityRepairSolver({
    nodeWithPortPoints: [node],
    hdRoutes: [route],
    obstacles: [connectedObstacle, foreignObstacle],
    repairMargin: 0.2,
    connMap,
  })

  expect(solver.sampleEntries[0].sample.adjacentObstacles).toEqual([
    {
      type: "rect",
      center: foreignObstacle.center,
      width: foreignObstacle.width,
      height: foreignObstacle.height,
    },
  ])
})

test("checks multilayer containment before resolving connectivity", (): void => {
  const connMap = new ConnectivityMap({
    signalNet: ["signal", "distantPad"],
  })
  const areIdsConnected = spyOn(connMap, "areIdsConnected")

  try {
    const solver = new Pipeline4HighDensityRepairSolver({
      nodeWithPortPoints: [
        {
          capacityMeshNodeId: "node",
          center: { x: 0, y: 0 },
          width: 2,
          height: 2,
          portPoints: [],
        },
      ],
      hdRoutes: [
        {
          connectionName: "signal",
          regionId: "node",
          traceThickness: 0.1,
          viaDiameter: 0.3,
          route: [
            { x: -1, y: 0, z: 0 },
            { x: 1, y: 0, z: 0 },
          ],
          vias: [],
        },
      ],
      obstacles: [
        {
          type: "rect",
          layers: ["top", "bottom"],
          center: { x: 100, y: 100 },
          width: 1,
          height: 1,
          connectedTo: ["distantPad"],
        },
      ],
      connMap,
    })

    expect(solver.sampleEntries).toHaveLength(1)
    expect(areIdsConnected).not.toHaveBeenCalled()
  } finally {
    areIdsConnected.mockRestore()
  }
})
