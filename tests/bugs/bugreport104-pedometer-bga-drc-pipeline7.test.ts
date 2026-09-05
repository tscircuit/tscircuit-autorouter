import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson } from "lib/types"
import pedometer from "../../fixtures/bug-reports/bugreport104-pedometer-v1.0.6.unrouted.srj.json" with {
  type: "json",
}

const input = pedometer as SimpleRouteJson

test.skip("bugreport104 routes pedometer BGA traces without DRC errors in Pipeline7", () => {
  const solver = new AutoroutingPipelineSolver7_MultiGraph(
    structuredClone(input),
    { cacheProvider: null },
  )
  while (!solver.solved && !solver.failed) {
    const padEscapeBefore = solver.finePitchPadEscapeSolver
    const iterationsBefore = padEscapeBefore?.iterations
    const wasRunning = padEscapeBefore && !padEscapeBefore.solved
    solver.step()
    const padEscapeAfter = solver.finePitchPadEscapeSolver
    if (!padEscapeBefore && padEscapeAfter) {
      expect(padEscapeAfter.iterations).toBe(0)
      expect(padEscapeAfter.solved).toBe(false)
    } else if (padEscapeAfter && wasRunning) {
      expect(padEscapeAfter.iterations - iterationsBefore!).toBeLessThanOrEqual(
        1,
      )
    }
  }

  expect(solver.failed, `Pipeline7 failed: ${solver.error}`).toBe(false)
  expect(solver.solved, "Pipeline7 did not finish").toBe(true)
  expect(solver.srjWithPointPairs).toBeDefined()
  expect(solver.finePitchPadEscapeSolver?.solved).toBe(true)
  expect(solver.finePitchPadEscapeSolver!.iterations).toBeGreaterThan(2)

  const { errors } = evaluateRelaxedDrc({
    inputSrj: input,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: solver.getOutputSimplifiedPcbTraces(),
    drcOptions: {
      traceClearance: input.minTraceToPadEdgeClearance,
      viaClearance: input.minViaEdgeToPadEdgeClearance,
    },
  })

  expect(errors, "Pipeline7 left DRC errors").toEqual([])
})
