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

test("crowded nodes are scheduled first in bounded batches while results retain serial order", async (): Promise<void> => {
  const params: Pipeline9HighDensitySolverParams = {
    nodePortPoints: Array.from({ length: 40 }, (_, index) => ({
      capacityMeshNodeId: `node-${index}`,
      center: { x: index * 8, y: 0 },
      width: 2,
      height: 4,
      availableZ: [0],
      portPoints: Array.from({ length: index === 2 ? 4 : 1 }, (_, row) => [
        { x: index * 8 - 1, y: row - 1.5, z: 0, connectionName: `${index}-${row}` },
        { x: index * 8 + 1, y: row - 1.5, z: 0, connectionName: `${index}-${row}` },
      ]).flat(),
    })),
    fixedHdRoutes: [],
    connMap: new ConnectivityMap({}),
    nodePfById: new Map(Array.from({ length: 40 }, (_, index) => [`node-${index}`, index / 40])),
    obstacles: [],
    layerCount: 2,
    viaDiameter: 0.3,
    traceWidth: 0.1,
    obstacleMargin: 0.15,
    effort: 0.1,
  }
  const baseline = new Pipeline9HighDensitySolver(params)
  baseline.solve()
  const tasks: {
    input: Pipeline9HighDensityBatchInput
    resolve: (output: Pipeline9HighDensityBatchOutput) => void
  }[] = []
  const runtime = {
    executeAsync: (_Solver: unknown, input: Pipeline9HighDensityBatchInput): Promise<Pipeline9HighDensityBatchOutput> =>
      new Promise((resolve) => tasks.push({ input, resolve })),
  } as SolverRuntimeExecutor
  const solver = new Pipeline9HighDensitySolver(params)
  const pending = solver.solveAsync(runtime)
  expect(tasks).toHaveLength(16)
  expect(tasks[0]!.input.nodePortPoints[0]!.capacityMeshNodeId).toBe("node-2")
  for (const { input, resolve } of tasks.toReversed()) {
    expect([...input.nodePfById as Map<string, number | null>].map(([id]) => id)).toEqual(
      input.nodePortPoints.map((node) => node.capacityMeshNodeId),
    )
    const batch = new Pipeline9HighDensityBatchSolver(input)
    batch.solve()
    resolve(batch.getOutput())
  }
  await pending
  expect(solver.solved).toBe(true)
  expect(solver.routes).toEqual(baseline.routes)
  expect(solver.stats).toEqual(baseline.stats)
  expect(solver.iterations).toBe(baseline.iterations)
  expect(solver.unsolvedNodePortPoints).toHaveLength(0)
})
