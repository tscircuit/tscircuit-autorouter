import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9HighDensityBatchSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensityBatchSolver"
import { createPipeline9RegularNodeSolver, Pipeline9HighDensitySolver, type Pipeline9HighDensitySolverParams } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { doPipeline9RoutesHaveCopperConflict } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"
import { columnNode, columnRoute } from "../fixtures/routeColumnPoolFixtures"

test("ordinary Pipeline9 activates columns with matching serial/batch output while projected factory requests retain opt-in", (): void => {
  const initial = [-1, 1].map((y, i) => columnRoute(String(i), [{ x: -4, y, z: 0 }, { x: 4, y, z: 0 }]))
  const params: Pipeline9HighDensitySolverParams = {
    nodePortPoints: [columnNode(initial)], fixedHdRoutes: [],
    connMap: new ConnectivityMap({}), obstacles: [], layerCount: 4,
    viaDiameter: 0.3, viaHoleDiameter: 0.15,
    minViaHoleEdgeToViaHoleEdgeClearance: 0.1,
    traceWidth: 0.1, obstacleMargin: 0.1, effort: 0.1,
  }
  const serial = new Pipeline9HighDensitySolver(params)
  serial.solve()
  expect(serial.solved).toBe(true)
  expect(serial.routes).toHaveLength(2)
  expect(serial.benchmarkDiagnosticCounters.routeColumnEligibleInstances).toBeGreaterThan(0)
  expect(serial.benchmarkDiagnosticCounters.routeColumnPreflightWorkUnits).toBeGreaterThan(0)
  expect(doPipeline9RoutesHaveCopperConflict({ left: serial.routes[0]!, right: serial.routes[1]!, clearance: 0.1, layerCount: 4 })).toBe(false)
  for (const route of serial.routes) {
    const expected = initial.find((r) => r.connectionName === route.connectionName)!
    expect(route.route[0]).toMatchObject(expected.route[0]!)
    expect(route.route.at(-1)).toMatchObject(expected.route.at(-1)!)
  }
  const { connMap, ...workerParams } = params
  const batch = new Pipeline9HighDensityBatchSolver({ ...workerParams, connectivityNetMap: {}, maxIterations: 1_000_000 })
  batch.solve()
  const outcome = batch.getOutput()[0]!
  expect(outcome.solved).toBe(true)
  expect(outcome.routes).toEqual(serial.routes)
  expect(outcome.stats).toEqual(serial.stats)
  expect(outcome.benchmarkDiagnosticCounters).toEqual(serial.benchmarkDiagnosticCounters)

  const projectedDiagnostics: Record<string, number> = {}
  const projected = createPipeline9RegularNodeSolver({
    nodeWithPortPoints: params.nodePortPoints[0]!, connMap,
    colorMap: {}, viaDiameter: 0.3, traceWidth: 0.1,
    obstacleMargin: 0.1, effort: 0.1, nodePfById: {},
    obstacles: [], layerCount: 4, priorityDiagnostics: projectedDiagnostics,
  })
  projected.solve()
  expect(projected.solved).toBe(true)
  expect(projectedDiagnostics.routeColumnInstances).toBeUndefined()
  const ownedDefaults: Record<string, number> = {}
  const explicitlyDisabled: Record<string, number> = {}
  for (const [diagnostics, override] of [
    [ownedDefaults, {}],
    [explicitlyDisabled, { routeColumnRecombination: false }],
  ] as const) {
    const owned = createPipeline9RegularNodeSolver({
      nodeWithPortPoints: params.nodePortPoints[0]!, connMap,
      colorMap: {}, viaDiameter: 0.3, traceWidth: 0.1,
      obstacleMargin: 0.1, effort: 0.1, nodePfById: {},
      obstacles: [], layerCount: 4, priorityDiagnostics: diagnostics,
      priorityDagSearch: true, ...override,
    })
    owned.solve()
    expect(owned.solved).toBe(true)
  }
  expect(ownedDefaults.routeColumnEligibleInstances).toBeGreaterThan(0)
  expect(explicitlyDisabled.routeColumnInstances).toBeUndefined()
})
