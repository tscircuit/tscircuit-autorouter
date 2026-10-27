import { expect, test } from "bun:test"
import type { SolverRuntimeExecutor } from "@tscircuit/solver-utils"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9HighDensitySolver } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import type { NodeWithPortPoints } from "../../lib/types/high-density-types"

test("P9 async routing retains the completed-copper serial order and bounded source prefix", async () => {
  const node = (id: string, x: number, connectionName: string, rootConnectionName: string): NodeWithPortPoints => ({
    capacityMeshNodeId: id, center: { x, y: 0 }, width: 2, height: 2, availableZ: [0],
    portPoints: [
      { x: x - 1, y: 0, z: 0, connectionName, rootConnectionName, portPointId: `${id}:left` },
      { x: x + 1, y: 0, z: 0, connectionName, rootConnectionName, portPointId: `${id}:right` },
    ],
  })
  const params = () => ({
    nodePortPoints: [node("left", 0, "A", "netA"), node("right", 8, "B", "netB")],
    fixedHdRoutes: [], obstacles: [], connMap: new ConnectivityMap({ netA: ["A"], netB: ["B"] }),
    boardGeometry: { bounds: { minX: -5, maxX: 13, minY: -5, maxY: 5 } },
    layerCount: 8, allowBlindAndBuriedVias: false, viaDiameter: 0.3, viaHoleDiameter: 0.15,
    traceWidth: 0.1, obstacleMargin: 0.15, traceToPadClearance: 0.1, traceToHoleClearance: 0.2,
    viaToPadClearance: 0.1, effort: 1, includeBoardObstacles: true,
  })
  let workerCalls = 0
  const runtime = { executeAsync: async () => { workerCalls++; throw new Error("Dynamic copper must not dispatch independent workers") } } as unknown as SolverRuntimeExecutor
  const snapshot = (solver: Pipeline9HighDensitySolver) => ({
    solved: solver.solved, failed: solver.failed, error: solver.error, iterations: solver.iterations,
    progress: solver.progress, routes: structuredClone(solver.routes), stats: { ...solver.stats },
    unsolved: solver.unsolvedNodePortPoints.map(n => n.capacityMeshNodeId),
    active: solver.activeNode?.capacityMeshNodeId ?? null,
    diagnostics: { ...solver.benchmarkDiagnosticCounters },
  })
  const direct = new Pipeline9HighDensitySolver(params())
  direct.solve()
  expect(direct.solved).toBe(true)
  expect(direct.failed).toBe(false)
  expect(direct.routes).toHaveLength(2)
  const asynchronous = new Pipeline9HighDensitySolver(params())
  await asynchronous.solveAsync(runtime)
  expect(snapshot(asynchronous)).toEqual(snapshot(direct))
  expect(workerCalls).toBe(0)

  const serialPrefix = new Pipeline9HighDensitySolver(params())
  while (!serialPrefix.solved && !serialPrefix.failed && serialPrefix.routes.length === 0) serialPrefix.step()
  expect(serialPrefix.routes).toHaveLength(1)
  expect(serialPrefix.solved).toBe(false)
  const boundary = serialPrefix.iterations
  const resumed = new Pipeline9HighDensitySolver(params())
  await resumed.solveAsync(runtime, boundary)
  expect(snapshot(resumed)).toEqual(snapshot(serialPrefix))
  expect(resumed.iterations).toBe(boundary)
  const beforeRepeatedBoundary = snapshot(resumed)
  await resumed.solveAsync(runtime, boundary)
  expect(snapshot(resumed)).toEqual(beforeRepeatedBoundary)
  await resumed.solveAsync(runtime)
  expect(snapshot(resumed)).toEqual(snapshot(direct))
  expect(workerCalls).toBe(0)
})
