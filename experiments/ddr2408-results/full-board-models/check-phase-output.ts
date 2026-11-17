import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"

const [inputPath, outputDirectory] = process.argv.slice(2)
const input: SimpleRouteJson = JSON.parse(readFileSync(inputPath, "utf8"))
mkdirSync(outputDirectory, { recursive: true })
const started = performance.now()
const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
  cacheProvider: null,
})
while (!solver.solved && !solver.failed) {
  if (performance.now() - started > 1_200_000) {
    throw new Error("Phase comparison exceeded its 20-minute limit")
  }
  solver.step()
}
if (solver.failed) throw new Error(solver.error!)
const traces = solver.getOutputSimplifiedPcbTraces()
const serialized = JSON.stringify(traces)
const report = {
  solved: solver.solved,
  elapsedMs: performance.now() - started,
  inputSha256: createHash("sha256").update(JSON.stringify(input)).digest("hex"),
  tracesSha256: createHash("sha256").update(serialized).digest("hex"),
  traceCount: traces.length,
  stageTimesMs: solver.timeSpentOnPhase,
}
writeFileSync(join(outputDirectory, "traces.json"), serialized)
writeFileSync(join(outputDirectory, "report.json"), JSON.stringify(report, null, 2))
console.log("ORANGE2408_MATCHED_PHASE", JSON.stringify(report))
