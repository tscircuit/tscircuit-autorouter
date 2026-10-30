import { expect, test } from "bun:test"
import type { SolverRuntimeExecutor } from "@tscircuit/solver-utils"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import {
  Pipeline9HighDensityBatchSolver,
  type Pipeline9HighDensityBatchInput,
  type Pipeline9HighDensityBatchOutput,
} from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensityBatchSolver"
import {
  Pipeline9HighDensitySolver,
  type Pipeline9HighDensitySolverParams,
} from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"

test("worker node ledgers count execution once beyond an accepted serial prefix", async (): Promise<void> => {
  const params: Pipeline9HighDensitySolverParams = {
    nodePortPoints: Array.from({ length: 80 }, (_, index) => ({
      capacityMeshNodeId: `node-${index}`,
      center: { x: index * 8, y: 0 },
      width: 2,
      height: 4,
      availableZ: [0],
      portPoints: [-0.6, 0.6].flatMap((y, row) => [
        {
          x: index * 8 - 1,
          y,
          z: 0,
          connectionName: `${index}-${row}`,
        },
        {
          x: index * 8 + 1,
          y,
          z: 0,
          connectionName: `${index}-${row}`,
        },
      ]),
    })),
    fixedHdRoutes: [],
    connMap: new ConnectivityMap({}),
    obstacles: [],
    layerCount: 2,
    viaDiameter: 0.3,
    viaHoleDiameter: 0.15,
    minViaHoleEdgeToViaHoleEdgeClearance: 0.1,
    traceWidth: 0.1,
    obstacleMargin: 0.15,
    effort: 0.1,
  }
  const baseline = new Pipeline9HighDensitySolver(params)
  while (
    baseline.stats.solvedNodeCount < 3 &&
    !baseline.solved &&
    !baseline.failed
  ) {
    baseline.step()
  }
  expect(baseline.failed).toBe(false)
  expect(baseline.stats.solvedNodeCount).toBe(3)
  expect(baseline.activeNode).toBeNull()

  const tasks: {
    input: Pipeline9HighDensityBatchInput
    resolve: (output: Pipeline9HighDensityBatchOutput) => void
  }[] = []
  const runtime = {
    executeAsync: (
      _Solver: unknown,
      input: Pipeline9HighDensityBatchInput,
    ): Promise<Pipeline9HighDensityBatchOutput> =>
      new Promise((resolve) => tasks.push({ input, resolve })),
  } as SolverRuntimeExecutor
  const solver = new Pipeline9HighDensitySolver(params)
  const pending = solver.solveAsync(runtime, baseline.iterations)
  expect(tasks).toHaveLength(64)
  expect(tasks.some(({ input }) => input.nodePortPoints.length > 1)).toBe(true)

  const executedLedgers: Record<string, number>[] = []
  const expectedLedger: Record<string, number> = {}
  for (const { input, resolve } of tasks.toReversed()) {
    const batch = new Pipeline9HighDensityBatchSolver(input)
    batch.solve()
    const results = batch.getOutput()
    expect(results).toHaveLength(input.nodePortPoints.length)
    for (const [index, result] of results.entries()) {
      expect(result.solved).toBe(true)
      const nodeIndex = Number(
        input.nodePortPoints[index]!.capacityMeshNodeId.slice("node-".length),
      )
      result.benchmarkDiagnosticCounters.priorityLedgerTestMarker =
        nodeIndex + 1
      executedLedgers.push(result.benchmarkDiagnosticCounters)
      for (const [key, value] of Object.entries(
        result.benchmarkDiagnosticCounters,
      )) {
        expectedLedger[key] = (expectedLedger[key] ?? 0) + value
      }
    }
    resolve(results)
  }
  await pending

  expect(executedLedgers).toHaveLength(80)
  expect(new Set(executedLedgers).size).toBe(80)
  expect(expectedLedger.priorityLedgerTestMarker).toBe(3240)
  for (const [key, value] of Object.entries(expectedLedger)) {
    expect(solver.benchmarkDiagnosticCounters[key]).toBe(value)
  }
  expect(
    solver.benchmarkDiagnosticCounters.priorityWorkerBatchesDispatched,
  ).toBe(64)
  expect(
    solver.benchmarkDiagnosticCounters.priorityWorkerBatchesCompleted,
  ).toBe(64)
  expect(solver.benchmarkDiagnosticCounters.priorityWorkerNodesDispatched).toBe(
    80,
  )
  expect(solver.benchmarkDiagnosticCounters.priorityWorkerNodesCompleted).toBe(
    80,
  )
  expect(solver.benchmarkDiagnosticCounters.priorityWorkerNodesAccepted).toBe(3)
  expect(solver.solved).toBe(false)
  expect(solver.failed).toBe(false)
  expect(solver.routes).toEqual(baseline.routes)
  expect(solver.stats).toEqual(baseline.stats)
  expect(solver.iterations).toBe(baseline.iterations)
  expect(solver.unsolvedNodePortPoints).toEqual(baseline.unsolvedNodePortPoints)
})
