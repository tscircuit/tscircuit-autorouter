import { expect, test } from "bun:test"
import type { SolverRuntimeExecutor } from "@tscircuit/solver-utils"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { Pipeline9HighDensityBatchOutput } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensityBatchSolver"
import { Pipeline9HighDensitySolver } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"

test("shared routing waits for outstanding workers before surfacing a worker failure", async (): Promise<void> => {
  const tasks: {
    resolve: (output: Pipeline9HighDensityBatchOutput) => void
    reject: (error: Error) => void
  }[] = []
  const runtime = {
    executeAsync: (): Promise<Pipeline9HighDensityBatchOutput> =>
      new Promise((resolve, reject) => tasks.push({ resolve, reject })),
  } as SolverRuntimeExecutor
  const solver = new Pipeline9HighDensitySolver({
    nodePortPoints: Array.from({ length: 20 }, (_, index) => ({
      capacityMeshNodeId: `node-${index}`,
      center: { x: index * 4, y: 0 },
      width: 2,
      height: 2,
      availableZ: [0],
      portPoints: [-0.8, 0.8].map((x) => ({
        x: index * 4 + x,
        y: 0,
        z: 0,
        connectionName: `signal-${index}`,
      })),
    })),
    fixedHdRoutes: [],
    connMap: new ConnectivityMap({}),
    obstacles: [],
    layerCount: 2,
    viaDiameter: 0.3,
    traceWidth: 0.1,
    obstacleMargin: 0.15,
    effort: 0.1,
  })
  let settled = false
  const pending = solver.solveAsync(runtime).then(
    (): void => {
      settled = true
    },
    (error: unknown): unknown => {
      settled = true
      return error
    },
  )
  expect(tasks.length).toBeGreaterThan(1)
  const failure = new Error("worker transport failed")
  tasks[0]!.reject(failure)
  await Promise.resolve()
  await Promise.resolve()
  expect(settled).toBe(false)
  for (const task of tasks.slice(1)) task.resolve([])
  expect(await pending).toBe(failure)
  expect(solver.failed).toBe(true)
  expect(solver.solved).toBe(false)
  expect(solver.routes).toEqual([])
})
