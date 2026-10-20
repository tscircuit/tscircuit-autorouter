import { expect, spyOn, test } from "bun:test"
import { SolverRuntime } from "@tscircuit/solver-utils"
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

test("high density without a runtime avoids batches and preserves iteration limits", async (): Promise<void> => {
  const dispatch = spyOn(
    SolverRuntime.prototype,
    "executeAsync",
  ).mockImplementation(() => {
    throw new Error("Unthreaded solving must not dispatch runtime batches")
  })
  try {
    for (const limit of [Infinity, 1, 7, 30]) {
      const baseline = new Pipeline9HighDensitySolver(params)
      const solver = new Pipeline9HighDensitySolver(params)
      baseline.step()
      solver.step()
      if (limit === Infinity) baseline.solve()
      else
        while (
          !baseline.solved &&
          !baseline.failed &&
          baseline.iterations < limit
        )
          baseline.step()
      const solve = spyOn(solver, "solve")
      await solver.solveAsync(undefined, limit)
      expect(solve).toHaveBeenCalledTimes(limit === Infinity ? 1 : 0)
      expect(solver.routes).toEqual(baseline.routes)
      expect(solver.stats).toEqual(baseline.stats)
      expect(solver.iterations).toBe(baseline.iterations)
      expect(solver.solved).toBe(baseline.solved)
      expect(solver.failed).toBe(baseline.failed)
      expect(solver.error).toBe(baseline.error)
      expect(solver.unsolvedNodePortPoints).toEqual(
        baseline.unsolvedNodePortPoints,
      )
      solve.mockRestore()
    }
    expect(dispatch).not.toHaveBeenCalled()
  } finally {
    dispatch.mockRestore()
  }
})
