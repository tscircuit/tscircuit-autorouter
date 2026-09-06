import { expect, test } from "bun:test"
import { segmentToBoxMinDistance } from "@tscircuit/math-utils"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { TraceSimplificationSolver } from "lib/solvers/TraceSimplificationSolver/TraceSimplificationSolver"
import type { Obstacle } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("path simplification retains the declared pad clearance", (): void => {
  const obstacle: Obstacle = {
    type: "rect",
    center: { x: 0, y: 0 },
    width: 0.6,
    height: 0.6,
    layers: ["top"],
    connectedTo: ["foreign_pad"],
  }
  const route: HighDensityRoute = {
    connectionName: "signal",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    vias: [],
    route: [
      { x: -2, y: 0.65, z: 0 },
      { x: -1, y: 1.2, z: 0 },
      { x: 1, y: 1.2, z: 0 },
      { x: 2, y: 0.65, z: 0 },
    ],
  }
  const inputSnapshot: HighDensityRoute = structuredClone(route)
  const solver: TraceSimplificationSolver = new TraceSimplificationSolver({
    hdRoutes: [route],
    obstacles: [obstacle],
    connMap: new ConnectivityMap({ signal_net: ["signal"] }),
    colorMap: {},
    defaultViaDiameter: 0.3,
    layerCount: 2,
    preserveRouteEndpoints: true,
    useTraceWidthAwareClearance: true,
    minTraceToPadEdgeClearance: 0.4,
  })
  solver.solve()
  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  const output: HighDensityRoute = solver.simplifiedHdRoutes[0]!
  for (let index: number = 1; index < output.route.length; index++) {
    expect(
      segmentToBoxMinDistance(
        output.route[index - 1]!,
        output.route[index]!,
        obstacle,
      ),
    ).toBeGreaterThanOrEqual(0.4 + route.traceThickness / 2 - 1e-6)
  }
  expect(route).toEqual(inputSnapshot)
})
