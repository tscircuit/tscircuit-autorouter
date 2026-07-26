import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test(
  "Pipeline9 passes relaxed DRC on srj23 repair regressions",
  async () => {
    const failures: Array<{ sampleNumber: number; errors: unknown[] }> = []

    for (const sampleNumber of [
      8, 14, 21, 23, 27, 29, 32, 51, 55, 57, 58, 62, 64, 68, 72, 74, 83, 94, 97,
      107,
    ]) {
      const { scenario } = await loadScenarioBySampleNumber(
        "srj23",
        sampleNumber,
      )
      const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
        scenario,
        {
          cacheProvider: null,
          effort: 1,
        },
      )
      solver.solve()

      const { errors } = evaluateRelaxedDrc({
        inputSrj: scenario,
        srjWithPointPairs: solver.srjWithPointPairs!,
        traces: solver.getOutputSimplifiedPcbTraces(),
      })
      if (errors.length > 0) {
        failures.push({ sampleNumber, errors })
      }
    }

    expect(failures).toEqual([])
  },
  { timeout: 900_000 },
)
