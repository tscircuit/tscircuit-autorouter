import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"

test("Pipeline9 releases failed B01 searches when debug capture is disabled", (): void => {
  const results: Pipeline9HighDensitySolver[] = []
  for (const captureSearchDebug of [false, true, undefined]) {
    const solver = new Pipeline9HighDensitySolver({
      nodePortPoints: [
        {
          capacityMeshNodeId: "blocked-single-layer-node",
          center: { x: 0, y: 0 },
          width: 2,
          height: 2,
          availableZ: [0],
          portPoints: [
            { x: -1, y: 0, z: 0, connectionName: "horizontal" },
            { x: 1, y: 0, z: 0, connectionName: "horizontal" },
          ],
        },
      ],
      fixedHdRoutes: [
        {
          connectionName: "vertical",
          traceThickness: 0.1,
          viaDiameter: 0.3,
          route: [
            { x: 0, y: -2, z: 0 },
            { x: 0, y: 2, z: 0 },
          ],
          vias: [],
          preloadedTraceIndex: 0,
          preloadedRouteIndex: 0,
        },
      ],
      connMap: new ConnectivityMap({}),
      obstacles: [],
      layerCount: 2,
      viaDiameter: 0.3,
      traceWidth: 0.1,
      obstacleMargin: 0.15,
      effort: 1,
      enableRegionalFallback: false,
      captureSearchDebug,
    })
    solver.solve()
    expect(solver.solved).toBeFalse()
    expect(solver.failed).toBeTrue()
    expect(solver.error).toContain("No path found")
    expect(solver.failedSolvers).toHaveLength(
      captureSearchDebug === false ? 0 : 1,
    )
    results.push(solver)
  }
  for (const solver of results.slice(1)) {
    expect(solver.routes).toEqual(results[0]!.routes)
    expect(solver.iterations).toBe(results[0]!.iterations)
    expect(solver.stats).toEqual(results[0]!.stats)
    expect(solver.error).toBe(results[0]!.error)
  }
})
