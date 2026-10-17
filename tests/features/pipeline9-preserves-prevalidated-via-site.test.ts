import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"

test("Pipeline9 materializes a prevalidated via center without grid quantization", (): void => {
  const points = [0, 7].map((z) => ({
    x: 0.025,
    y: 0.035,
    z,
    connectionName: "signal",
    rootConnectionName: "signal-net",
  }))
  const solver = new Pipeline9HighDensitySolver({
    nodePortPoints: [
      {
        capacityMeshNodeId: "prevalidated-site",
        isLayerTransition: true,
        center: { x: 0.025, y: 0.035 },
        width: 0.2032,
        height: 0.2032,
        availableZ: [0, 1, 2, 3, 4, 5, 6, 7],
        portPoints: points,
        portPointsInPairs: [[points[0]!, points[1]!]],
      },
    ],
    fixedHdRoutes: [],
    connMap: new ConnectivityMap({ "signal-net": ["signal"] }),
    obstacles: [
      {
        type: "rect",
        center: { x: 0.025, y: 0.035 },
        width: 0.3,
        height: 0.3,
        layers: ["top"],
        connectedTo: ["signal-net"],
      },
    ],
    layerCount: 8,
    allowBlindAndBuriedVias: true,
    viaDiameter: 0.2032,
    traceWidth: 0.1524,
    minimumTraceWidth: 0.1524,
    obstacleMargin: 0.15,
    includeBoardObstacles: true,
    effort: 1,
  })
  solver.solve()
  expect(solver.solved).toBeTrue()
  expect(solver.stats.b01NodeCount).toBe(0)
  expect(solver.stats.fallbackNodeCount).toBe(0)
  expect(solver.routes[0]!.vias).toEqual([{ x: 0.025, y: 0.035 }])
  expect(solver.routes[0]!.route.map(({ x, y, z }) => ({ x, y, z }))).toEqual([
    { x: 0.025, y: 0.035, z: 0 },
    { x: 0.025, y: 0.035, z: 7 },
  ])
})
