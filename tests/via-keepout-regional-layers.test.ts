import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"

test("regional repair cannot restore layers removed by via keepouts", () => {
  const portPoints = [
    { x: -1, y: 0, z: 0, connectionName: "horizontal" },
    { x: 1, y: 0, z: 0, connectionName: "horizontal" },
    { x: 0, y: -1, z: 0, connectionName: "vertical" },
    { x: 0, y: 1, z: 0, connectionName: "vertical" },
  ]
  const solver = new Pipeline9HighDensitySolver({
    nodePortPoints: [
      {
        capacityMeshNodeId: "restricted",
        center: { x: 0, y: 0 },
        width: 2.1,
        height: 2.1,
        availableZ: [0],
        portPoints,
        portPointsInPairs: [
          [portPoints[0], portPoints[1]],
          [portPoints[2], portPoints[3]],
        ],
      },
    ],
    fixedHdRoutes: [],
    connMap: new ConnectivityMap({}),
    colorMap: {},
    obstacles: [],
    layerCount: 2,
    viaDiameter: 0.3,
    traceWidth: 0.1,
    obstacleMargin: 0.15,
    effort: 0.1,
    preserveNodeLayerConstraints: true,
  })
  while (!solver.activeFallbackSolver && !solver.failed && !solver.solved)
    solver.step()
  expect(solver.activeFallbackSolver).toBeDefined()
  expect(
    solver.activeFallbackSolver!.params.nodeWithPortPoints.availableZ,
  ).toEqual([0])
})
