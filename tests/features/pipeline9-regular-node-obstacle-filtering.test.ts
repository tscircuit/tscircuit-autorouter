import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"

test("Pipeline9 gives regular node solvers only spatially relevant obstacles", () => {
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "regular-node",
    center: { x: 0, y: 0 },
    width: 2,
    height: 2,
    availableZ: [0, 1],
    portPoints: [
      { x: -1, y: 0, z: 0, connectionName: "signal" },
      { x: 1, y: 0, z: 0, connectionName: "signal" },
    ],
  }
  const obstacles: Obstacle[] = [
    {
      obstacleId: "rotated-near-node",
      type: "rect",
      layers: ["top"],
      center: { x: 1.4, y: 0 },
      width: 0.2,
      height: 1,
      ccwRotationDegrees: 90,
      connectedTo: [],
    },
    {
      obstacleId: "far-from-node",
      type: "rect",
      layers: ["top"],
      center: { x: 10, y: 10 },
      width: 1,
      height: 1,
      connectedTo: [],
    },
  ]
  const solver = new Pipeline9HighDensitySolver({
    nodePortPoints: [node],
    fixedHdRoutes: [],
    connMap: new ConnectivityMap({}),
    obstacles,
    layerCount: 2,
    viaDiameter: 0.3,
    traceWidth: 0.1,
    obstacleMargin: 0.15,
    effort: 1,
  })

  solver.step()

  expect(
    solver.activeRegularSolver?.obstacles.map(
      (obstacle) => obstacle.obstacleId,
    ),
  ).toEqual(["rotated-near-node"])
})
