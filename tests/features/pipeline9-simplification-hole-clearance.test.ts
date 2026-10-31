import { expect, test } from "bun:test"
import { TraceSimplificationSolver } from "@tscircuit/trace-simplification-solver"
import { segmentToCircleMinDistance } from "@tscircuit/math-utils"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { getPipeline9SimplificationObstacles } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9SimplificationObstacles"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("simplification preserves default and explicit non-plated hole clearance", (): void => {
  for (const [holeClearance, padClearance] of [
    [undefined, 0.1], [0.3, 0.1], [0.1, 0.1], [0.3, 0.05], [undefined, 0.2],
  ]) {
    const input: SimpleRouteJson = {
      layerCount: 2,
      minTraceWidth: 0.1,
      minTraceToPadEdgeClearance: padClearance,
      minTraceToHoleEdgeClearance: holeClearance,
      bounds: { minX: -3, maxX: 3, minY: -3, maxY: 3 },
      connections: [],
      obstacles: [{
        obstacleId: "mounting-hole",
        type: "rect",
        shape: "circle",
        isNonPlatedHole: true,
        center: { x: 0, y: 0 },
        width: 1,
        height: 1,
        layers: ["top", "bottom"],
        connectedTo: [],
      }],
    }
    const original = structuredClone(input)
    const route: HighDensityRoute = {
      connectionName: "signal",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      vias: [],
      route: [
        { x: -2, y: -0.7, z: 0 },
        { x: -1.5, y: -1.2, z: 0 },
        { x: 1.5, y: -1.2, z: 0 },
        { x: 2, y: -0.7, z: 0 },
      ],
    }
    const solver = new TraceSimplificationSolver({
      hdRoutes: [route],
      obstacles: getPipeline9SimplificationObstacles(input),
      connMap: new ConnectivityMap({}),
      colorMap: {},
      defaultViaDiameter: 0.3,
      layerCount: 2,
      minTraceToPadEdgeClearance: padClearance,
    })
    solver.solve()
    expect(solver.failed).toBe(false)
    expect(solver.solved).toBe(true)
    const result = solver.simplifiedHdRoutes[0]!
    const gap = Math.min(...result.route.slice(1).map((point, index): number =>
      segmentToCircleMinDistance(result.route[index]!, point, {
        x: 0, y: 0, radius: 0.5,
      }) - result.traceThickness / 2,
    ))
    expect(gap).toBeGreaterThanOrEqual((holeClearance ?? 0.2) - 1e-9)
    expect(input).toEqual(original)
  }
})
