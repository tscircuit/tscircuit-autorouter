import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9RegionalFallbackSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9RegionalFallbackSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("regional debug capture remains enabled by default without changing routed copper", () => {
  let reference: HighDensityRoute[] | undefined
  for (const captureSearchDebug of [undefined, true, false]) {
    const solver = new Pipeline9RegionalFallbackSolver({
      nodeWithPortPoints: {
        capacityMeshNodeId: "regional-debug-straight",
        center: { x: 0, y: 0 },
        width: 2,
        height: 2,
        availableZ: [0, 1],
        portPoints: [
          { x: -1, y: 0, z: 0, connectionName: "data" },
          { x: 1, y: 0, z: 0, connectionName: "data" },
        ],
      },
      colorMap: {},
      connMap: new ConnectivityMap({}),
      obstacles: [],
      layerCount: 2,
      viaDiameter: 0.3,
      traceWidth: 0.1,
      obstacleMargin: 0.15,
      effort: 0.1,
      captureSearchDebug,
    })
    expect(solver.highDensitySolver.captureSearchDebug).toBe(
      captureSearchDebug ?? true,
    )
    solver.solve()
    expect(solver.failed).toBeFalse()
    expect(solver.solved).toBeTrue()
    const routes = solver.getOutput()
    expect(routes).toHaveLength(1)
    if (reference) expect(routes).toEqual(reference)
    reference = routes
  }
})
