import { createHash } from "node:crypto"
import { mkdirSync, writeFileSync } from "node:fs"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph as Pipeline9 } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "../../lib/testing/evaluate-relaxed-drc"
import { loadScenarioBySampleNumber, type DatasetName } from "../../scripts/benchmark/scenarios"

// Functional A/B only. Corpus performance comparisons belong on Blacksmith.
const dataset = (process.argv[2] ?? "srj18") as DatasetName
const sample = Number(process.argv[3] ?? 1)
const { scenario } = await loadScenarioBySampleNumber(dataset, sample)
const results: Record<string, unknown>[] = []
for (const enabled of [false, true]) {
  const solver = new Pipeline9(structuredClone(scenario), {
    effort: 1, cacheProvider: null, copperCandidateSearch: enabled,
  })
  let executionError: string | undefined
  try {
    solver.solve()
  } catch (error) {
    executionError = error instanceof Error ? error.stack : String(error)
  }
  const traces = solver.solved ? solver.getOutputSimplifiedPcbTraces() : undefined
  const drc = traces && solver.srjWithPointPairs
    ? evaluateRelaxedDrc({ inputSrj: scenario, srjWithPointPairs: solver.srjWithPointPairs, routedTraces: traces })
    : undefined
  const result = {
    dataset, sample, enabled, effort: 1,
    inputSha256: createHash("sha256").update(JSON.stringify(scenario)).digest("hex"),
    solved: solver.solved, failed: solver.failed, error: solver.error, executionError,
    phase: solver.getCurrentPhase(),
    effectiveHighDensityMode: solver.highDensityRouteSolver
      ? Reflect.get(solver.highDensityRouteSolver, "params").copperCandidateSearch
      : undefined,
    traceCount: traces?.length,
    drcIssueCount: drc?.errors.length, drcErrors: drc?.errors,
    highDensityDiagnostics: solver.highDensityRouteSolver?.benchmarkDiagnosticCounters,
    highDensityStats: solver.highDensityRouteSolver?.stats,
  }
  results.push(result)
  console.log(JSON.stringify(result))
}
mkdirSync(new URL("./results", import.meta.url), { recursive: true })
writeFileSync(new URL(`./results/${dataset}-sample${sample}.json`, import.meta.url), JSON.stringify({ results }, null, 2) + "\n")
