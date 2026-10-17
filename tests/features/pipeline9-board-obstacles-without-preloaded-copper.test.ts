import { expect, test } from "bun:test"
import { doesSegmentIntersectRect } from "@tscircuit/math-utils"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

test("physical detailed routing respects board pads without any preloaded traces", (): void => {
  const ports = [-1, 1].map((x) => ({
    x,
    y: 0,
    z: 0,
    connectionName: "trace",
    rootConnectionName: "trace-net",
  }))
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "pad-adjacent-node",
    center: { x: 0, y: 0 },
    width: 2,
    height: 2,
    availableZ: [0],
    portPoints: ports,
    portPointsInPairs: [[ports[0]!, ports[1]!]],
  }
  const solver = new Pipeline9HighDensitySolver({
    nodePortPoints: [node],
    fixedHdRoutes: [],
    connMap: new ConnectivityMap({ "trace-net": ["trace"] }),
    obstacles: [
      {
        type: "rect",
        center: { x: 0, y: 0 },
        width: 0.2,
        height: 0.6,
        layers: ["top"],
        connectedTo: ["foreign-net"],
      },
    ],
    layerCount: 2,
    viaDiameter: 0.2,
    traceWidth: 0.1524,
    minimumTraceWidth: 0.1524,
    obstacleMargin: 0.1,
    includeBoardObstacles: true,
    enableRegionalFallback: false,
    effort: 1,
  })
  solver.solve()
  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  expect(solver.stats.b01NodeCount).toBe(1)
  const route = solver.routes[0]!
  expect(route.traceThickness).toBe(0.1524)
  expect(
    route.route.slice(0, -1).some((point, i) =>
      doesSegmentIntersectRect(point, route.route[i + 1]!, {
        minX: -0.1,
        maxX: 0.1,
        minY: -0.3,
        maxY: 0.3,
      }),
    ),
  ).toBeFalse()
})
