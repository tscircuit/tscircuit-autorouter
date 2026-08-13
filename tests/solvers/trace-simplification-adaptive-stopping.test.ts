import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { TraceSimplificationSolver } from "lib/solvers/TraceSimplificationSolver/TraceSimplificationSolver"

test("trace simplification stops when a complete pass reaches a fixed point", () => {
  const solver = new TraceSimplificationSolver({
    hdRoutes: [
      {
        connectionName: "net",
        traceThickness: 0.15,
        viaDiameter: 0.3,
        route: [
          { x: 0, y: 0, z: 0 },
          { x: 1, y: 0, z: 0 },
        ],
        vias: [],
      },
    ],
    obstacles: [],
    connMap: new ConnectivityMap({ net: ["net"] }),
    colorMap: { net: "#000000" },
    defaultViaDiameter: 0.3,
    layerCount: 2,
  })

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.simplificationPipelineLoops).toBe(1)
  expect(solver.stats.adaptiveSimplificationStopReason).toBe("fixed_point")
})
