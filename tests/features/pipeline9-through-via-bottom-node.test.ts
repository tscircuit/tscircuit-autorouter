import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { minimumDistanceBetweenSegments } from "lib/utils/minimumDistanceBetweenSegments"

test("Pipeline9 routes bottom around through vias with different or coincident logical layers", (): void => {
  for (const [fromZ, toZ] of [
    [0, 2],
    [0, 0],
    [2, 2],
  ] as const) {
    const portPoints = [
      { x: -2, y: 0, z: 3, connectionName: "signal" },
      { x: 2, y: 0, z: 3, connectionName: "signal" },
    ]
    const solver = new Pipeline9HighDensitySolver({
      nodePortPoints: [
        {
          capacityMeshNodeId: "bottom-node",
          center: { x: 0, y: 0 },
          width: 4,
          height: 4,
          availableZ: [3],
          portPoints,
          portPointsInPairs: [[portPoints[0]!, portPoints[1]!]],
        },
      ],
      fixedHdRoutes: [
        {
          connectionName: "power-via",
          rootConnectionName: "power",
          preloadedTraceIndex: 0,
          preloadedRouteIndex: 0,
          traceThickness: 0.15,
          viaDiameter: 0.6,
          route: [
            { x: 0, y: 0, z: fromZ },
            { x: 0, y: 0, z: toZ },
          ],
          vias: [{ x: 0, y: 0 }],
        },
      ],
      connMap: new ConnectivityMap({}),
      obstacles: [],
      layerCount: 4,
      viaDiameter: 0.6,
      traceWidth: 0.15,
      obstacleMargin: 0.15,
      effort: 1,
      enableRegionalFallback: false,
    })
    solver.step()
    expect(solver.activeB01Solver).not.toBeNull()
    expect(solver.activeB01Solver!.obstacles).toContainEqual(
      expect.objectContaining({ vias: [{ x: 0, y: 0, zStart: 0, zEnd: 3 }] }),
    )
    solver.solve()
    expect(solver.solved).toBeTrue()
    expect(solver.failed).toBeFalse()
    const route = solver.routes[0]!
    expect(route.route.every(({ z }) => z === 3)).toBeTrue()
    for (let index = 1; index < route.route.length; index++) {
      expect(
        minimumDistanceBetweenSegments(
          route.route[index - 1]!,
          route.route[index]!,
          { x: 0, y: 0 },
          { x: 0, y: 0 },
        ),
      ).toBeGreaterThanOrEqual(0.6 / 2 + 0.15 / 2 + 0.15 - 1e-4)
    }
  }
})
