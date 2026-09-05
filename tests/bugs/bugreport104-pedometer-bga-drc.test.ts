import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson } from "lib/types"
import pedometer from "../../fixtures/bug-reports/bugreport104-pedometer-v1.0.6.unrouted.srj.json" with {
  type: "json",
}

const input = pedometer as SimpleRouteJson

test("bugreport104 routes pedometer BGA traces without DRC errors in Pipeline9", () => {
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(input),
    { cacheProvider: null },
  )
  while (!solver.solved && !solver.failed) {
    const padEscapeBefore =
      solver.pipeline9JointDrcRepairSolver?.finePitchPadEscapeSolver
    const iterationsBefore = padEscapeBefore?.iterations
    const wasRunning = padEscapeBefore && !padEscapeBefore.solved
    solver.step()
    const padEscapeAfter =
      solver.pipeline9JointDrcRepairSolver?.finePitchPadEscapeSolver
    if (!padEscapeBefore && padEscapeAfter) {
      expect(padEscapeAfter.iterations).toBe(0)
      expect(padEscapeAfter.solved).toBe(false)
    } else if (padEscapeAfter && wasRunning) {
      expect(padEscapeAfter.iterations - iterationsBefore!).toBeLessThanOrEqual(
        1,
      )
    }
  }

  expect(solver.failed, `Pipeline9 failed: ${solver.error}`).toBe(false)
  expect(solver.solved, "Pipeline9 did not finish").toBe(true)
  expect(solver.srjWithPointPairs).toBeDefined()
  const padEscapeSolver =
    solver.pipeline9JointDrcRepairSolver?.finePitchPadEscapeSolver
  expect(padEscapeSolver?.solved).toBe(true)
  expect(padEscapeSolver!.iterations).toBeGreaterThan(2)

  const { errors } = evaluateRelaxedDrc({
    inputSrj: input,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: solver.getOutputSimplifiedPcbTraces(),
    drcOptions: {
      traceClearance: input.minTraceToPadEdgeClearance,
      viaClearance: input.minViaEdgeToPadEdgeClearance,
    },
  })

  expect(errors, "Pipeline9 left DRC errors").toHaveLength(0)
})
