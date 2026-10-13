import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph, AutoroutingPipelineSolver9_Networked, solveHighDensityRepairSample, type HighDensityRepairSampleInput, type HighDensityRepairSampleResult } from "lib"
import type { SimpleRouteJson } from "lib/types"
import { ExampleHdCache2Server } from "tests/fixtures/example-hd-cache2-server"

test("Pipeline9 local and networked pipelines expose parallel repair with deterministic SRJ output", async () => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.15,
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
    obstacles: [],
    connections: [
      { name: "a", pointsToConnect: [{ x: -4, y: -2, layer: "top" }, { x: 4, y: -2, layer: "top" }] },
      { name: "b", pointsToConnect: [{ x: -4, y: 2, layer: "top" }, { x: 4, y: 2, layer: "top" }] },
    ],
  }
  const sequential = new AutoroutingPipelineSolver9_PreloadedTraceGraph(structuredClone(srj), { cacheProvider: null })
  sequential.solve()
  expect(sequential.solved).toBe(true)
  const server = new ExampleHdCache2Server()
  try {
    for (const networked of [false, true]) {
      let calls = 0
      const parallelRepair = {
        concurrency: 2,
        executor: async (input: HighDensityRepairSampleInput): Promise<HighDensityRepairSampleResult> => {
          calls += 1
          await Promise.resolve()
          return solveHighDensityRepairSample(input)
        },
      }
      const opts = { cacheProvider: null, parallelRepair }
      const pipeline = networked
        ? new AutoroutingPipelineSolver9_Networked(structuredClone(srj), { ...opts, hdCache2ServerUrl: server.url })
        : new AutoroutingPipelineSolver9_PreloadedTraceGraph(structuredClone(srj), opts)
      expect(() => pipeline.solve()).toThrow(/async/i)
      expect(() => pipeline.solveUntilPhase("highDensityRepairSolver")).toThrow("Async")
      await pipeline.solveUntilPhaseAsync("highDensityRepairSolver")
      expect(pipeline.getCurrentPhase()).toBe("highDensityRepairSolver")
      await pipeline.solveAsync()
      expect(pipeline.solved).toBe(true)
      expect(pipeline.failed).toBe(false)
      expect(calls).toBeGreaterThan(0)
      expect(pipeline.highDensityRepairSolver!.parallelRepair).toBe(parallelRepair)
      expect(pipeline.highDensityRepairSolver!.stats).toEqual(sequential.highDensityRepairSolver!.stats)
      expect(JSON.stringify(pipeline.getOutputSimpleRouteJson())).toBe(JSON.stringify(sequential.getOutputSimpleRouteJson()))
    }
  } finally {
    await server.close()
  }
})
