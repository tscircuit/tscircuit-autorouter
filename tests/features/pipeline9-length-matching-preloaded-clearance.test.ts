import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { createPipeline9LengthMatchingPreloadedInput } from "../fixtures/createPipeline9LengthMatchingPreloadedInput"

test.failing(
  "Pipeline9 length matching preserves preloaded copper or reports no solution",
  (): void => {
    for (const preloadedY of [0.3, 1]) {
      const srj = createPipeline9LengthMatchingPreloadedInput(preloadedY)
      const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj, {
        cacheProvider: null,
      })
      solver.solveUntilPhase("lengthMatchingPostProcessingSolver")
      const before = evaluateRelaxedDrc({
        inputSrj: srj,
        srjWithPointPairs: solver.srjWithPointPairs!,
        routedTraces: solver.getNewTracesBeforePowerExpansion(),
      })
      expect(before.errors).toHaveLength(0)
      if (preloadedY === 0.3) {
        expect(() => solver.solve()).toThrow(
          "exhausted all segment/tooth combinations",
        )
        expect(solver.failed).toBe(true)
        expect(solver.solved).toBe(false)
        expect(() => solver.getOutputSimplifiedPcbTraces()).toThrow(
          "Cannot get output",
        )
        continue
      }
      solver.solve()
      expect(solver.solved).toBe(true)
      expect(solver.failed).toBe(false)
      const after = evaluateRelaxedDrc({
        inputSrj: srj,
        srjWithPointPairs: solver.srjWithPointPairs!,
        routedTraces: solver.getOutputSimplifiedPcbTraces(),
      })
      expect(after.errors).toHaveLength(0)
      expect(
        solver
          .getOutputSimpleRouteJson()
          .traces?.find((trace): boolean => trace.pcb_trace_id === "fixed"),
      ).toEqual(srj.traces![0])
      const lengths: number[] = solver
        ._getOutputHdRoutes()
        .map((route): number =>
          route.route.slice(1).reduce((length, point, index): number => {
            const previous = route.route[index]!
            return (
              length + Math.hypot(point.x - previous.x, point.y - previous.y)
            )
          }, 0),
        )
      expect(lengths).toHaveLength(2)
      expect(Math.abs(lengths[0]! - lengths[1]!)).toBeLessThanOrEqual(
        0.1 + 1e-6,
      )
    }
  },
)
