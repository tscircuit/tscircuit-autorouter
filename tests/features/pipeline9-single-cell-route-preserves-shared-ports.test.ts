import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"

test("a one-cell detailed route preserves both shared physical ports", (): void => {
  const points = [
    { x: 0.02237867, y: 0.0454661189, z: 3, connectionName: "signal" },
    { x: 0, y: 0.065818767857, z: 3, connectionName: "signal" },
  ]
  const solver = new Pipeline9HighDensitySolver({
    nodePortPoints: [
      {
        capacityMeshNodeId: "single-cell-route",
        center: { x: 0.011189335, y: 0.065818767857 },
        width: 0.02237867,
        height: 0.131637535714,
        availableZ: [3],
        portPoints: points,
        portPointsInPairs: [[points[0]!, points[1]!]],
      },
    ],
    fixedHdRoutes: [],
    connMap: new ConnectivityMap({ "signal-net": ["signal"] }),
    obstacles: [
      {
        type: "rect",
        center: { x: 0.011189335, y: 0.065818767857 },
        width: 0.05,
        height: 0.15,
        layers: ["inner3"],
        connectedTo: ["signal-net"],
      },
    ],
    layerCount: 8,
    viaDiameter: 0.2032,
    traceWidth: 0.1524,
    minimumTraceWidth: 0.1524,
    traceToPadClearance: 0.1,
    obstacleMargin: 0.15,
    includeBoardObstacles: true,
    effort: 1,
  })
  solver.solve()
  expect(solver.solved).toBeTrue()
  expect(solver.stats.b01NodeCount).toBe(1)
  expect(solver.routes[0]!.route[0]).toMatchObject(points[0]!)
  expect(solver.routes[0]!.route.at(-1)).toMatchObject(points[1]!)
})
