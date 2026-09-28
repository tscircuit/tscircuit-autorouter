import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { createPipeline9LengthMatchingPreloadedInput } from "../fixtures/createPipeline9LengthMatchingPreloadedInput"

// Pipeline 9 currently omits bus length matching.
test.failing(
  "Pipeline9 length matching tight-preload length skew",
  (): void => {
    const srj = createPipeline9LengthMatchingPreloadedInput(0.3)
    const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj, {
      cacheProvider: null,
    })
    solver.solve()
    expect(solver.solved).toBe(true)
    const drcInput = {
      inputSrj: srj,
      srjWithPointPairs: solver.srjWithPointPairs!,
      routedTraces: solver.getOutputSimplifiedPcbTraces(),
    }
    expect(evaluateRelaxedDrc(drcInput).errors).toHaveLength(0)
    const lengths = solver._getOutputHdRoutes().map((route): number =>
      route.route.slice(1).reduce((length, point, index): number => {
        const previous = route.route[index]!
        return length + Math.hypot(point.x - previous.x, point.y - previous.y)
      }, 0),
    )
    expect(lengths).toHaveLength(2)
    expect(Math.abs(lengths[0]! - lengths[1]!)).toBeLessThanOrEqual(0.1 + 1e-6)
  },
)
