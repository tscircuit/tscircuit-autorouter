import { expect, test } from "bun:test"
import type { SolverRuntimeExecutor } from "@tscircuit/solver-utils"
import { HighDensityForceImproveSolver } from "high-density-repair01/lib/HighDensityForceImproveSolver"
import { Pipeline9HighDensityForceImproveSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensityForceImproveSolver"
import { SingleTransitionIntraNodeSolver } from "lib/solvers/HighDensitySolver/SingleTransitionIntraNodeSolver"
import type { HighDensityRoute, NodeWithPortPoints } from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"
import fixture from "../fixtures/sample24-constructive-transition-c74.json"

test("force-improve accepts valid proposals and atomically rejects serial and async via regressions", async (): Promise<void> => {
  const node = structuredClone(fixture.node) as NodeWithPortPoints
  const backend = new SingleTransitionIntraNodeSolver({ nodeWithPortPoints: node,
    viaDiameter: 0.3, traceThickness: 0.1, boardContext: { obstacles: fixture.obstacles as Obstacle[],
      layerCount: 8, allowBlindAndBuriedVias: false, viaToPadClearance: 0.15,
      traceToPadClearance: 0.15, boardGeometry: fixture.boardGeometry, coordinateScale: 1 } })
  const original = structuredClone(backend.solvedRoutes[0]!)
  const planar = { ...structuredClone(original), connectionName: "neighbor", rootConnectionName: "neighbor",
    route: [{ x: 172.00004, y: 52.20004, z: 0 }, { x: 172.10004, y: 52.20004, z: 0 }], vias: [] }
  const params = { nodeWithPortPoints: [node], hdRoutes: [original, planar], totalStepsPerNode: 20,
    nodeAssignmentMargin: 0.2, colorMap: {} }
  const context = { obstacles: fixture.obstacles as Obstacle[], layerCount: 8,
    allowBlindAndBuriedVias: false, viaDiameter: 0.3, viaToPadClearance: 0.15, connectivityNetMap: {} }
  const baseline = JSON.stringify(params)
  const legacy = new HighDensityForceImproveSolver(params)
  legacy.solve()
  expect(legacy.getOutput()).not.toEqual(params.hdRoutes)
  const workerInputs: unknown[] = []
  const runtime = { executeAsync: async (Solver: any, input: unknown): Promise<unknown> => {
    workerInputs.push(input)
    const worker = new Solver(structuredClone(input))
    worker.solve()
    return structuredClone(worker.getOutput())
  } } as unknown as SolverRuntimeExecutor
  for (const asyncMode of [false, true]) {
    const guarded = new Pipeline9HighDensityForceImproveSolver({ ...params, viaObstacleContext: context })
    if (asyncMode) await guarded.solveAsync(runtime)
    else guarded.solve()
    expect(guarded.solved).toBe(true)
    expect(guarded.failed).toBe(false)
    expect(guarded.getOutput()).toEqual(params.hdRoutes)
    expect(guarded.improvedRoutesByIndex.size).toBe(0)
    expect(guarded.stats.viaObstacleRejectedSampleCount).toBe(1)
    expect(guarded.stats.improvedRouteCount).toBe(0)
    expect(guarded.stats.improvedNodeCount).toBe(0)
    expect(guarded.latestVisualization).toEqual({})
    expect(guarded.iterations).toBe(legacy.iterations)
    expect(guarded.MAX_ITERATIONS).toBe(legacy.MAX_ITERATIONS)
    const clear = new Pipeline9HighDensityForceImproveSolver({ ...params, viaObstacleContext: { ...context, obstacles: [] } })
    if (asyncMode) await clear.solveAsync(runtime)
    else clear.solve()
    expect(clear.getOutput()).toEqual(legacy.getOutput())
    expect(clear.stats.viaObstacleRejectedSampleCount).toBe(0)
    expect(clear.stats.improvedNodeCount).toBe(1)
    const blind = new Pipeline9HighDensityForceImproveSolver({ ...params, viaObstacleContext: { ...context,
      obstacles: [fixture.obstacles[0] as Obstacle], allowBlindAndBuriedVias: true } })
    blind.solve()
    expect(blind.getOutput()).toEqual(legacy.getOutput())
    const own = new Pipeline9HighDensityForceImproveSolver({ ...params, viaObstacleContext: { ...context,
      connectivityNetMap: { signal: [original.connectionName, "own-pad-alias"] },
      obstacles: [{ ...fixture.obstacles[0] as Obstacle, connectedTo: ["own-pad-alias"] }] } })
    own.solve()
    expect(own.getOutput()).toEqual(legacy.getOutput())
    const reconstructed = new Pipeline9HighDensityForceImproveSolver(JSON.parse(JSON.stringify(guarded.getConstructorParams()[0])))
    reconstructed.solve()
    expect(reconstructed.getOutput()).toEqual(params.hdRoutes)
  }
  const invalidOriginal = new SingleTransitionIntraNodeSolver({ nodeWithPortPoints: node,
    viaDiameter: 0.3, traceThickness: 0.1 }).solvedRoutes[0]!
  const invalidParams = { ...params, hdRoutes: [invalidOriginal] }
  const invalidLegacy = new HighDensityForceImproveSolver(invalidParams)
  invalidLegacy.solve()
  const invalidGuarded = new Pipeline9HighDensityForceImproveSolver({ ...invalidParams, viaObstacleContext: context })
  invalidGuarded.solve()
  expect(invalidGuarded.getOutput()).toEqual(invalidLegacy.getOutput())
  expect(invalidGuarded.stats.viaObstacleRejectedSampleCount).toBe(0)
  const secondNode = { ...node, capacityMeshNodeId: "second-node" }
  const secondRoute: HighDensityRoute = { ...structuredClone(planar), regionId: "second-node" }
  const sequential = new Pipeline9HighDensityForceImproveSolver({ ...params,
    nodeWithPortPoints: [node, secondNode], hdRoutes: [...params.hdRoutes, secondRoute], viaObstacleContext: context })
  sequential.solve()
  expect(sequential.stats.viaObstacleRejectedSampleCount).toBe(1)
  expect(sequential.stats.improvedNodeCount).toBe(1)
  expect(sequential.stats.improvedRouteCount).toBe(1)
  expect(sequential.getOutput().slice(0, 2)).toEqual(params.hdRoutes)
  expect(sequential.getOutput()[2]).not.toEqual(secondRoute)
  expect(workerInputs.length).toBe(2)
  expect(workerInputs.every((input) => !("viaObstacleContext" in (input as object)))).toBe(true)
  expect(JSON.stringify(params)).toBe(baseline)
})
