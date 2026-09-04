import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson } from "lib/types"
import pedometer from "../../fixtures/bug-reports/bugreport104-pedometer-v1.0.6.unrouted.srj.json" with {
  type: "json",
}

const input = pedometer as SimpleRouteJson

test("bugreport104 routes pedometer BGA traces without DRC errors in Pipeline7 and Pipeline9", () => {
  const solvers = [
    {
      name: "Pipeline7",
      create: () =>
        new AutoroutingPipelineSolver7_MultiGraph(structuredClone(input), {
          cacheProvider: null,
        }),
    },
    {
      name: "Pipeline9",
      create: () =>
        new AutoroutingPipelineSolver9_PreloadedTraceGraph(
          structuredClone(input),
          { cacheProvider: null },
        ),
    },
  ]

  for (const { name, create } of solvers) {
    const solver = create()
    solver.solve()

    expect(solver.failed, `${name} failed: ${solver.error}`).toBe(false)
    expect(solver.solved, `${name} did not finish`).toBe(true)
    expect(
      solver.srjWithPointPairs,
      `${name} did not create point pairs`,
    ).toBeDefined()

    const { errors } = evaluateRelaxedDrc({
      inputSrj: input,
      srjWithPointPairs: solver.srjWithPointPairs!,
      routedTraces: solver.getOutputSimplifiedPcbTraces(),
      drcOptions: {
        traceClearance: input.minTraceToPadEdgeClearance,
        viaClearance: input.minViaEdgeToPadEdgeClearance,
      },
    })

    expect(errors, `${name} left DRC errors`).toHaveLength(0)
  }
}, 300_000)
