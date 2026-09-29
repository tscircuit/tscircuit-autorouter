import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "../lib/testing/evaluate-relaxed-drc"
import { getBugReportSnapshotSvg } from "../lib/testing/getBugReportSnapshotSvg"
import { toSimpleRouteJson } from "./benchmark/scenarios"

const [inputPath, outputDirectory] = process.argv.slice(2)
if (!inputPath || !outputDirectory) {
  throw new Error("Expected an input board path and output directory")
}
const srj = toSimpleRouteJson(JSON.parse(readFileSync(inputPath, "utf8")))
if (!srj) throw new Error("Input does not contain SimpleRouteJson")
mkdirSync(outputDirectory, { recursive: true })
const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj)
const capturedStages = new Set([
  "globalDrcForceImproveSolver",
  "pipeline9JointDrcRepairSolver",
  "lengthMatchingPostProcessingSolver",
  "powerTraceExpansionSolver",
])
for (const definition of solver.pipelineDef) {
  if (!capturedStages.has(definition.solverName)) continue
  const onSolved = definition.onSolved
  definition.onSolved = (pipeline): void => {
    onSolved?.(pipeline)
    const stage = pipeline[definition.solverName] as unknown as {
      getOutput(): unknown
      stats: unknown
    }
    const drcInput = {
      inputSrj: srj,
      srjWithPointPairs: pipeline.srjWithPointPairs!,
      routedTraces: pipeline.getOutputSimplifiedPcbTraces(),
    }
    const { circuitJson, errors } = evaluateRelaxedDrc(drcInput)
    writeFileSync(
      `${outputDirectory}/${definition.solverName}.json`,
      JSON.stringify({
        routes: stage.getOutput(),
        stats: stage.stats,
        errors,
        circuitJson,
        srjWithPointPairs: pipeline.srjWithPointPairs,
      }),
    )
    writeFileSync(
      `${outputDirectory}/${definition.solverName}.svg`,
      getBugReportSnapshotSvg(drcInput),
    )
    console.log(definition.solverName, JSON.stringify(stage.stats), errors.length)
  }
}
try {
  solver.solve()
  writeFileSync(
    `${outputDirectory}/summary.json`,
    JSON.stringify({
      solved: solver.solved,
      failed: solver.failed,
      error: solver.error,
      timeSpentOnPhase: solver.timeSpentOnPhase,
    }),
  )
  if (!solver.solved || solver.failed) {
    throw new Error(`Routing failed: ${solver.error}`)
  }
} catch (error) {
  writeFileSync(`${outputDirectory}/failure.txt`, String(error))
  throw error
}
