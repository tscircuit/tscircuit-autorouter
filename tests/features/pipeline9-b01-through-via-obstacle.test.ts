import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { PreloadedHighDensityRoute } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/convertPreloadedTraceToHdRoutes"
import { doPipeline9RoutesHaveCopperConflict } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"
import { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import {
  getGraphicsSvgFrames,
  type GraphicsSvgFrame,
} from "../fixtures/solver-svg-frames"

test("Pipeline9 routes around a through via on a layer outside its signal transition", async (): Promise<void> => {
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
  const frames: GraphicsSvgFrame[] = []
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
    const b01Solver = solver.activeB01Solver
    if (allowBlindAndBuriedVias === false) {
      if (!b01Solver) throw new Error("Expected the fixed-via B01 solver")
      solver.step()
      expect(b01Solver.getOutput()).toEqual([])
      frames.push({
        name: "Through via: before routing",
        step: "start",
        iteration: b01Solver.iterations,
        graphics: structuredClone(b01Solver.visualize()),
      })
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
    if (allowBlindAndBuriedVias === false) {
      if (!b01Solver) throw new Error("Expected the fixed-via B01 solver")
      frames.push({
        name: "Through via: routed on bottom",
        step: "end",
        iteration: b01Solver.iterations,
        graphics: b01Solver.visualize(),
      })
    }
  }
  expect(fixedVia).toEqual(originalVia)
  await expect(
    getGraphicsSvgFrames({ frames, columns: 2, backgroundColor: "white" }),
  ).toMatchSvgSnapshot(import.meta.path)
})
