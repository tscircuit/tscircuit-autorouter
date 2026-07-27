import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test(
  "Pipeline9 passes relaxed DRC on srj23 repair regressions",
  async () => {
    const failures: Array<{ sampleNumber: number; errors: unknown[] }> = []

    // Keep this regression test bounded so the regular CI suite stays below its
    // 15-minute job limit. The benchmark workflow covers all 107 samples.
    for (const sampleNumber of [14]) {
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
