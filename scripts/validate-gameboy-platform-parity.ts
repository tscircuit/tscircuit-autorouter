import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "../lib/testing/evaluate-relaxed-drc"
import { getBugReportSnapshotSvg } from "../lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson } from "../lib/types"

const outputDirectory = process.argv[2]
if (!outputDirectory) throw new Error("Expected an output directory")
mkdirSync(outputDirectory, { recursive: true })
const inputText = readFileSync(
  "tests/repro/assets/gameboy-full-board-through-vias.srj.json",
  "utf8",
)
const inputSrj = JSON.parse(inputText) as SimpleRouteJson
const inputHash = createHash("sha256").update(inputText).digest("hex")
const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(inputSrj, {
  cacheProvider: null,
  effort: 1,
})
let forceImproveHash: string | undefined
for (const definition of solver.pipelineDef) {
  if (definition.solverName !== "highDensityForceImproveSolver") continue
  const onSolved = definition.onSolved
  definition.onSolved = (pipeline): void => {
    onSolved?.(pipeline)
    const forceImprove = pipeline.highDensityForceImproveSolver
    if (!forceImprove) throw new Error("Missing force-improvement output")
    const routes = JSON.stringify(forceImprove.getOutput())
    forceImproveHash = createHash("sha256").update(routes).digest("hex")
    console.log("FORCE_IMPROVE_HASH", forceImproveHash)
  }
}
const startedAt = performance.now()
solver.solve()
const durationMs = performance.now() - startedAt
if (!solver.solved || solver.failed || solver.error) {
  throw new Error(`Game Boy routing did not complete: ${solver.error}`)
}
if (!forceImproveHash || !solver.srjWithPointPairs) {
  throw new Error("Missing completed routing stages")
}
const routedTraces = solver.getOutputSimplifiedPcbTraces()
const drcInput = {
  inputSrj,
  srjWithPointPairs: solver.srjWithPointPairs,
  routedTraces,
}
const { circuitJson, errors } = evaluateRelaxedDrc(drcInput)
const errorsByType: Record<string, number> = {}
for (const error of errors) {
  errorsByType[error.type] = (errorsByType[error.type] ?? 0) + 1
}
const summary = {
  inputHash,
  forceImproveHash,
  routeHash: createHash("sha256")
    .update(JSON.stringify(routedTraces))
    .digest("hex"),
  traces: routedTraces.length,
  vias: circuitJson.filter((element) => element.type === "pcb_via").length,
  relaxedDrcCount: errors.length,
  errorsByType,
}
console.log(
  "GAMEBOY_RESULT",
  JSON.stringify({
    ...summary,
    platform: process.platform,
    arch: process.arch,
    bun: Bun.version,
    durationMs,
  }),
)
writeFileSync(
  `${outputDirectory}/summary.json`,
  JSON.stringify(summary, null, 2),
)
writeFileSync(`${outputDirectory}/routes.json`, JSON.stringify(routedTraces))
writeFileSync(
  `${outputDirectory}/drc-errors.json`,
  JSON.stringify(errors, null, 2),
)
writeFileSync(`${outputDirectory}/board.svg`, getBugReportSnapshotSvg(drcInput))
