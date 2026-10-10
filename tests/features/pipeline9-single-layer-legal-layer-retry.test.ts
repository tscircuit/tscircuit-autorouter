import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { doPipeline9RoutesHaveCopperConflict } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"
import {
  Pipeline9HighDensitySolver,
  type Pipeline9HighDensitySolverParams,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

test("Pipeline9 retries impossible single-layer crossings across legal board layers", (): void => {
  const portPoints: NodeWithPortPoints["portPoints"] = [
    { x: -2, y: 0, z: 0, connectionName: "horizontal" },
    { x: 2, y: 0, z: 0, connectionName: "horizontal" },
    { x: 0, y: -2, z: 0, connectionName: "vertical" },
    { x: 0, y: 2, z: 0, connectionName: "vertical" },
  ]
  const params: Pipeline9HighDensitySolverParams = {
    nodePortPoints: [
      {
        capacityMeshNodeId: "single-layer-crossing",
        center: { x: 0, y: 0 },
        width: 4,
        height: 4,
        availableZ: [0],
        portPoints,
        portPointsInPairs: [
          [portPoints[0]!, portPoints[1]!],
          [portPoints[2]!, portPoints[3]!],
        ],
      },
    ],
    fixedHdRoutes: [],
    connMap: new ConnectivityMap({
      horizontal_net: ["horizontal"],
      vertical_net: ["vertical"],
    }),
    obstacles: [],
    layerCount: 2,
    viaDiameter: 0.3,
    traceWidth: 0.1,
    obstacleMargin: 0.15,
    effort: 0.1,
  }

  // Alternating boundary terminals cannot connect on one layer. Prove the
  // primary assignment fails before testing the regional layer retry.
  const assignedLayerSolver = new Pipeline9HighDensitySolver({
    ...params,
    enableRegionalFallback: false,
  })
  assignedLayerSolver.solve()
  expect(assignedLayerSolver.failed).toBeTrue()
  expect(assignedLayerSolver.error).toContain("impossible single-layer crossing")

  const solver = new Pipeline9HighDensitySolver(params)
  solver.solve()

  expect(solver.failed).toBeFalse()
  expect(solver.solved).toBeTrue()
  expect(solver.stats.fallbackNodeCount).toBe(1)
  expect(solver.routes).toHaveLength(2)
  expect(new Set(solver.routes.map((route) => route.connectionName))).toEqual(
    new Set(["horizontal", "vertical"]),
  )
  expect(
    solver.routes.every((route) =>
      route.route.every((point) => point.z === 0 || point.z === 1),
    ),
  ).toBeTrue()
  expect(
    solver.routes.some((route) =>
      route.route.some((point) => point.z === 1),
    ),
  ).toBeTrue()
  expect(solver.routes.flatMap((route) => route.vias).length).toBeGreaterThan(0)
  expect(
    doPipeline9RoutesHaveCopperConflict({
      left: solver.routes[0]!,
      right: solver.routes[1]!,
      clearance: params.obstacleMargin,
      layerCount: params.layerCount,
    }),
  ).toBeFalse()
})
