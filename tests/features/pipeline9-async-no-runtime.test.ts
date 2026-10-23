import { expect, spyOn, test } from "bun:test"
import { SolverRuntime } from "@tscircuit/solver-utils"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph as Pipeline9 } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "../../lib/types/srj-types"
import { getPipeline9LogicalStats } from "../fixtures/getPipeline9LogicalStats"

const input: SimpleRouteJson = {
  layerCount: 2,
  minTraceWidth: 0.1,
  obstacles: [],
  bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
  connections: [
    {
      name: "signal",
      pointsToConnect: [
        { x: -3, y: 0, layer: "top" },
        { x: 3, y: 0, layer: "top" },
      ],
    },
  ],
}

test("Pipeline9 without a runtime uses synchronous solving with exact resumed output", async (): Promise<void> => {
  const baseline = new Pipeline9(structuredClone(input), {
    effort: 0.1,
    cacheProvider: null,
  })
  baseline.solve()
  const dispatch = spyOn(
    SolverRuntime.prototype,
    "executeAsync",
  ).mockImplementation(() => {
    throw new Error("Unthreaded solving must not dispatch runtime batches")
  })
  try {
    for (const resume of [false, true]) {
      const solver = new Pipeline9(structuredClone(input), {
        effort: 0.1,
        cacheProvider: null,
      })
      if (resume) {
        solver.solveUntilPhase("highDensityRouteSolver")
        solver.step()
        solver.step()
      }
      const solve = spyOn(solver, "solve")
      await solver.solveAsync()
      expect(solve).toHaveBeenCalledTimes(1)
      expect(solver.solved).toBe(true)
      expect(solver.failed).toBe(false)
      expect(JSON.stringify(solver.getOutputSimpleRouteJson())).toBe(
        JSON.stringify(baseline.getOutputSimpleRouteJson()),
      )
      expect(solver.iterations).toBe(baseline.iterations)
      expect(getPipeline9LogicalStats(solver.highDensityRouteSolver!.stats)).toEqual(
        getPipeline9LogicalStats(baseline.highDensityRouteSolver!.stats),
      )
      solve.mockRestore()
    }
    expect(dispatch).not.toHaveBeenCalled()
  } finally {
    dispatch.mockRestore()
  }
})
