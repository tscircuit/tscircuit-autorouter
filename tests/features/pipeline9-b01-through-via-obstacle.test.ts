import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { PreloadedHighDensityRoute } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/convertPreloadedTraceToHdRoutes"
import { doPipeline9RoutesHaveCopperConflict } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"
import { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"

test("Pipeline9 routes around a through via on a layer outside its signal transition", (): void => {
  const fixedVia: PreloadedHighDensityRoute = {
    connectionName: "fixed-via",
    rootConnectionName: "fixed-net",
    traceThickness: 0.2,
    viaDiameter: 0.6,
    route: [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
    ],
    vias: [{ x: 0, y: 0 }],
    preloadedTraceIndex: 0,
    preloadedRouteIndex: 0,
  }
  const originalVia = structuredClone(fixedVia)
  for (const allowBlindAndBuriedVias of [false, undefined, true]) {
    const board = { layerCount: 4, allowBlindAndBuriedVias }
    const solver = new Pipeline9HighDensitySolver({
      ...board,
      nodePortPoints: [
        {
          capacityMeshNodeId: "bottom-node",
          center: { x: 0, y: 0 },
          width: 4,
          height: 4,
          availableZ: [3],
          portPoints: [
            { x: -2, y: 0, z: 3, connectionName: "bottom-trace" },
            { x: 2, y: 0, z: 3, connectionName: "bottom-trace" },
          ],
        },
      ],
      fixedHdRoutes: [fixedVia],
      connMap: new ConnectivityMap({}),
      obstacles: [],
      viaDiameter: 0.6,
      traceWidth: 0.2,
      obstacleMargin: 0.15,
      effort: 0.1,
    })
    solver.step()
    if (allowBlindAndBuriedVias) {
      expect(solver.stats.fixedObstacleUses).toBe(0)
    } else {
      expect(solver.stats.fixedObstacleUses).toBe(1)
      expect(solver.activeB01Solver?.obstacles).toEqual([
        expect.objectContaining({
          vias: [{ x: 0, y: 0, zStart: 0, zEnd: 3 }],
        }),
      ])
    }
    solver.solve()
    expect(solver.failed).toBeFalse()
    expect(solver.solved).toBeTrue()
    expect(solver.routes).toHaveLength(1)
    expect(
      doPipeline9RoutesHaveCopperConflict({
        ...board,
        left: solver.routes[0]!,
        right: fixedVia,
        clearance: 0.15,
      }),
    ).toBeFalse()
    expect(solver.routes[0]!.route[0]).toMatchObject({ x: -2, y: 0, z: 3 })
    expect(solver.routes[0]!.route.at(-1)).toMatchObject({ x: 2, y: 0, z: 3 })
  }
  expect(fixedVia).toEqual(originalVia)
})
