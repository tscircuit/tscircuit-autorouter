import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test(
  "Pipeline9 resolves hidden fixed-trace overlaps in srj23",
  async () => {
    const failures: Array<{ sampleNumber: number; errors: unknown[] }> = []

    for (const sampleNumber of [38, 91]) {
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
  { timeout: 600_000 },
)
