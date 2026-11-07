import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9RegionalFallbackSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9RegionalFallbackSolver"
import type { Obstacle } from "lib/types/srj-types"

test("regional candidate layers respect full foreign pour coverage without blocking same-net copper or openings", (): void => {
  const pours: Obstacle[] = [-0.5, 0.5].map((y) => ({
    type: "rect",
    center: { x: 0, y },
    width: 2,
    height: 1,
    layers: ["inner1"],
    isCopperPour: true,
    connectedTo: ["ground"],
  }))
  const params = {
    nodeWithPortPoints: {
      capacityMeshNodeId: "pour-union",
      center: { x: 0, y: 0 },
      width: 2,
      height: 2,
      availableZ: [0, 1, 2, 3],
      portPoints: [
        { connectionName: "signal", x: -1, y: 0, z: 0 },
        { connectionName: "signal", x: 1, y: 0, z: 0 },
      ],
    },
    obstacles: pours,
    connMap: new ConnectivityMap({
      signalNet: ["signal"],
      groundNet: ["ground"],
    }),
    layerCount: 4,
    viaDiameter: 0.45,
    traceWidth: 0.1,
    obstacleMargin: 0.1,
    effort: 1,
    colorMap: {},
  }
  expect(
    new Pipeline9RegionalFallbackSolver(params).params.nodeWithPortPoints
      .availableZ,
  ).toEqual([0, 2, 3])
  const gap = pours.map((pour) => ({ ...pour, height: 0.99 }))
  expect(
    new Pipeline9RegionalFallbackSolver({ ...params, obstacles: gap }).params
      .nodeWithPortPoints.availableZ,
  ).toEqual([0, 1, 2, 3])
  const sameNet = pours.map((pour) => ({ ...pour, connectedTo: ["signal"] }))
  expect(
    new Pipeline9RegionalFallbackSolver({ ...params, obstacles: sameNet })
      .params.nodeWithPortPoints.availableZ,
  ).toEqual([0, 1, 2, 3])
  expect(
    () =>
      new Pipeline9RegionalFallbackSolver({
        ...params,
        nodeWithPortPoints: {
          ...params.nodeWithPortPoints,
          portPoints: params.nodeWithPortPoints.portPoints.map((point) => ({
            ...point,
            z: 1,
          })),
        },
      }),
  ).toThrow("terminal inside a foreign copper plane")
  expect(params.nodeWithPortPoints.availableZ).toEqual([0, 1, 2, 3])
})
