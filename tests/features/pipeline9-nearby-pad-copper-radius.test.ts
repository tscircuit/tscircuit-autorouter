import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"

test("Pipeline9 includes nearby pads within the trace and via copper radius", () => {
  const solver = new Pipeline9HighDensitySolver({
    nodePortPoints: [
      {
        capacityMeshNodeId: "narrow-pad-boundary",
        center: { x: 0, y: -0.5 },
        width: 1,
        height: 1,
        availableZ: [0],
        portPoints: [-0.2, 0.2].map((x) => ({
          x,
          y: 0,
          z: 0,
          connectionName: "signal",
        })),
      },
    ],
    fixedHdRoutes: [],
    connMap: new ConnectivityMap({ signal: ["signal"] }),
    obstacles: [
      {
        type: "rect",
        center: { x: 0, y: 0.7623 },
        width: 1.4,
        height: 1.2,
        layers: ["top"],
        connectedTo: ["foreign_pad"],
      },
    ],
    layerCount: 2,
    viaDiameter: 0.3,
    traceWidth: 0.1,
    obstacleMargin: 0.15,
    effort: 1,
    includeBoardObstacles: true,
    enableRegionalFallback: false,
  })
  solver.solve()
  expect(solver.stats.boardObstacleUses).toBe(1)
  expect(solver.solved).toBe(false)
  expect(solver.failed).toBe(true)
  expect(solver.routes).toHaveLength(0)
})
