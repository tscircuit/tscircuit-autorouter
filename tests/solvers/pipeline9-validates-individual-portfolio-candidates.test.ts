import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { createPipeline9PhysicalRouteValidator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9PhysicalRouteValidator"
import { createPipeline9RegularNodeSolver, Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import type { SimpleRouteJson } from "lib/types"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

test("rejecting an invalid closed-form candidate preserves existing valid portfolio candidates", (): void => {
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "full-stack-annulus",
    center: { x: 0, y: 0 }, width: 0.4, height: 1,
    availableZ: [0, 1, 2, 3, 4, 5, 6, 7],
    portPoints: [
      { x: 0.2, y: -0.5, z: 0, connectionName: "signal" },
      { x: 0.2, y: 0.5, z: 7, connectionName: "signal" },
    ],
  }
  const physicalSrj: SimpleRouteJson = {
    bounds: { minX: -3, maxX: 3, minY: -3, maxY: 3 },
    layerCount: 8, allowBlindAndBuriedVias: false, minTraceWidth: 0.1,
    // This planning margin must not become an additional physical rule.
    defaultObstacleMargin: 0.8,
    obstacles: [{ type: "rect", center: { x: 0.55, y: 0 }, width: 0.5, height: 2, layers: ["inner3"], connectedTo: [] }],
    connections: [{ name: "signal", pointsToConnect: [] }],
  }
  const original = structuredClone({ node, physicalSrj })
  const connMap = new ConnectivityMap({ net: ["signal"] })
  const params = {
    nodeWithPortPoints: node, connMap, colorMap: {},
    viaDiameter: 0.3, viaHoleDiameter: 0.15, traceWidth: 0.1,
    obstacleMargin: 0.15, effort: 1, nodePfById: {},
    obstacles: physicalSrj.obstacles, layerCount: 8,
    allowBlindAndBuriedVias: false,
  }
  const validate = createPipeline9PhysicalRouteValidator({ physicalSrj, connMap, obstacleMargin: 0.15 })
  const unguarded = createPipeline9RegularNodeSolver(params)
  unguarded.solve()
  expect(unguarded.solved).toBe(true)
  expect(unguarded.stats.solverNodeCount).toEqual({ SingleTransitionIntraNodeSolver: 1 })
  expect(validate(unguarded.routes)).toBe(false)

  const pipeline = new Pipeline9HighDensitySolver({ ...params, nodePortPoints: [node], fixedHdRoutes: [], physicalSrj, enableRegionalFallback: false })
  pipeline.step()
  const regular = pipeline.activeRegularSolver!
  expect(regular.growShrinkSolutionValidator).toBeFunction()
  pipeline.solve()
  expect(pipeline.failed).toBe(false)
  expect(pipeline.solved).toBe(true)
  expect(validate(pipeline.routes)).toBe(true)
  expect(regular.stats.solverNodeCount).toEqual({ SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost: 1 })
  expect(regular.stats.highDensityResizeCount).toBe(1)
  const via = pipeline.routes[0]!.vias[0]!
  expect(0.3 - via.x - 0.15).toBeGreaterThanOrEqual(0.1 - 1e-6)
  expect(pipeline.routes[0]!.route[0]).toMatchObject({ x: 0.2, y: -0.5, z: 0 })
  expect(pipeline.routes[0]!.route.at(-1)).toMatchObject({ x: 0.2, y: 0.5, z: 7 })
  expect({ node, physicalSrj }).toEqual(original)
})
