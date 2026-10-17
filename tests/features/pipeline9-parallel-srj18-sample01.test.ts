import { expect, test } from "bun:test"
import sample001 from "dataset-srj18/samples/sample001.json"
import type { SimpleRouteJson } from "../../lib/types/srj-types"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { Pipeline9_Parallel } from "../../lib/autorouter-pipelines/Pipeline9_Parallel/Pipeline9_Parallel"
import { NodeSolverRuntime } from "../../lib/solver-runtime/NodeSolverRuntime"
import { SingleThreadSolverRuntime } from "../../lib/solver-runtime/SolverRuntime"

test("dataset18 sample01 has identical complete output with serial and 1/2/4 worker synchronous steps", () => {
  const baseline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(structuredClone(sample001) as SimpleRouteJson, { effort: 1, cacheProvider: null })
  baseline.solve()
  expect(baseline.failed).toBe(false)
  const expected = JSON.stringify(baseline.getOutputSimpleRouteJson())
  let expectedSteps: string[] | undefined
  for (const runtime of [new SingleThreadSolverRuntime(), ...[1, 2, 4].map((threads) => new NodeSolverRuntime({ threads }))]) {
    try {
      const pipeline = new Pipeline9_Parallel(structuredClone(sample001) as SimpleRouteJson, { effort: 1, cacheProvider: null, runtime })
      const steps: string[] = []
      while (!pipeline.solved && !pipeline.failed) {
        const phase = pipeline.getCurrentPhase()
        pipeline.step()
        if (phase === "highDensityRouteSolver" && pipeline.highDensityRouteSolver) {
          const density = pipeline.highDensityRouteSolver
          steps.push(JSON.stringify({ routes: density.routes, stats: density.stats, remaining: density.unsolvedNodePortPoints.length }))
        }
      }
      expectedSteps ??= steps
      expect(steps).toEqual(expectedSteps)
      expect(pipeline.error).toBeNull()
      expect(pipeline.solved).toBe(true)
      expect(JSON.stringify(pipeline.getOutputSimpleRouteJson())).toBe(expected)
    } finally { runtime.dispose() }
  }
})
