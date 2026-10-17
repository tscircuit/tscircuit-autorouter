import { createPipeline9TestRuntime } from "../fixtures/createPipeline9TestRuntime"
import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import {
  Pipeline9HighDensitySolver,
  type Pipeline9HighDensitySolverParams,
} from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"

const params: Pipeline9HighDensitySolverParams = {
  nodePortPoints: Array.from({ length: 9 }, (_, index) => ({
    capacityMeshNodeId: `node-${index}`,
    center: { x: index * 4, y: 0 },
    width: 2,
    height: 2,
    availableZ: [0],
    portPoints: [
      { x: index * 4 - 1, y: 0, z: 0, connectionName: `signal-${index}` },
      { x: index * 4 + 1, y: 0, z: 0, connectionName: `signal-${index}` },
    ],
  })),
  fixedHdRoutes: [],
  connMap: new ConnectivityMap({}),
  obstacles: [],
  layerCount: 2,
  viaDiameter: 0.3,
  traceWidth: 0.1,
  obstacleMargin: 0.15,
  effort: 0.1,
}

test("async routing honors the same logical iteration budget inside a worker job", async (): Promise<void> => {
  for (const budget of [1, 7, 30]) {
    const baseline = new Pipeline9HighDensitySolver(params)
    baseline.MAX_ITERATIONS = budget
    baseline.solve()
    const solver = new Pipeline9HighDensitySolver(params)
    solver.MAX_ITERATIONS = budget
    const runtime = createPipeline9TestRuntime(2)
    try {
      await solver.solveAsync(runtime)
    } finally {
      await runtime.dispose()
    }
    expect(solver.error).toBe(baseline.error)
    expect(solver.failed).toBe(baseline.failed)
    expect(solver.solved).toBe(baseline.solved)
    expect(solver.routes).toEqual(baseline.routes)
    expect(solver.stats).toEqual(baseline.stats)
    expect(solver.iterations).toBe(baseline.iterations)
    expect(solver.unsolvedNodePortPoints).toEqual(
      baseline.unsolvedNodePortPoints,
    )
  }
})
