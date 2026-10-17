import { createPipeline9TestRuntime } from "../fixtures/createPipeline9TestRuntime"
import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9HighDensitySolver, type Pipeline9HighDensitySolverParams } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"

const params: Pipeline9HighDensitySolverParams = {
  nodePortPoints: Array.from({ length: 13 }, (_, index) => {
    const x = index * 4
    return {
      capacityMeshNodeId: `node-${index}`, center: { x, y: 0 }, width: 2, height: 2, availableZ: [0],
      portPoints: [
        { x: x - 1, y: 0, z: 0, connectionName: `signal-${index}`, pcb_port_id: `start-${index}` },
        { x: x + 1, y: 0, z: 0, connectionName: `signal-${index}`, pcb_port_id: `end-${index}` },
      ],
    }
  }),
  fixedHdRoutes: [], connMap: new ConnectivityMap({}), obstacles: [], layerCount: 2,
  viaDiameter: 0.3, traceWidth: 0.1, obstacleMargin: 0.15, effort: 0.1,
  preserveTerminalPcbPortIds: true,
}

test("async high-density workers preserve routes, terminal IDs, stats and iteration order when resuming synchronous steps", async (): Promise<void> => {
  const baseline = new Pipeline9HighDensitySolver(params)
  baseline.solve()
  expect(baseline.solved).toBe(true)
  for (const workerCount of [1, 2, 4]) {
    const solver = new Pipeline9HighDensitySolver(params)
    solver.step()
    expect(solver.activeNode).not.toBeNull()
    const runtime = createPipeline9TestRuntime(workerCount)
    try { await solver.solveAsync(runtime) } finally { await runtime.dispose() }
    expect(solver.failed).toBe(false)
    expect(solver.solved).toBe(true)
    expect(JSON.stringify(solver.routes)).toBe(JSON.stringify(baseline.routes))
    expect(solver.stats).toEqual(baseline.stats)
    expect(solver.iterations).toBe(baseline.iterations)
    expect(solver.progress).toBe(1)
    expect(solver.unsolvedNodePortPoints).toHaveLength(0)
    expect(solver.activeSubSolver).toBeNull()
  }
  const empty = new Pipeline9HighDensitySolver({ ...params, nodePortPoints: [] })
  await empty.solveAsync()
  expect(empty.solved).toBe(true)
})
