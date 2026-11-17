import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"

const [routerDirectory, inputPath, outputDirectory] = process.argv.slice(2)
if (!routerDirectory || !inputPath || !outputDirectory) {
  throw new Error("Expected router checkout, phase input JSON and output directory")
}
mkdirSync(outputDirectory, { recursive: true })
const sourcePath = resolve(routerDirectory,
  "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph.ts")
const { AutoroutingPipelineSolver9_PreloadedTraceGraph } = await import(pathToFileURL(sourcePath).href)
const input = JSON.parse(readFileSync(inputPath, "utf8"))
const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, { cacheProvider: null })
const started = performance.now()
let capturedNecessaryInput = false
let previousPhase = ""
while (!solver.solved && !solver.failed && solver.getCurrentPhase() !== "portPointPathingSolver") {
  const phase = solver.getCurrentPhase()
  if (phase !== previousPhase) {
    console.log("REACHABILITY_PROFILE_STAGE", JSON.stringify({ phase, elapsedMs: performance.now() - started }))
    previousPhase = phase
  }
  if (phase === "necessaryCrampedPortPointSolver" && !capturedNecessaryInput) {
    const definition = solver.pipelineDef.find((entry: { solverName: string }) => entry.solverName === phase)
    if (!definition) throw new Error("Missing necessary-cramped pipeline definition")
    const parameters = definition.getConstructorParams(solver)[0]
    writeFileSync(join(outputDirectory, "necessary-cramped-input.json.gz"), Bun.gzipSync(JSON.stringify(parameters)))
    capturedNecessaryInput = true
  }
  solver.step()
}
if (solver.failed) throw new Error(solver.error)
if (!capturedNecessaryInput) throw new Error("Necessary-cramped stage was not reached")
const output = solver.sharedEdgeSegmentsWithNecessaryCrampedPortPoints
if (!output) throw new Error("Necessary-cramped output was not published")
const serialized = JSON.stringify(output)
const report = {
  elapsedMs: performance.now() - started,
  stageTimesMs: solver.timeSpentOnPhase,
  graphSha256: createHash("sha256").update(serialized).digest("hex"),
  nodes: solver.capacityNodes.length,
  segments: output.length,
  portPoints: output.reduce((total: number, segment: { portPoints: unknown[] }) => total + segment.portPoints.length, 0),
  iterations: solver.iterations,
  phase: solver.getCurrentPhase(),
}
writeFileSync(join(outputDirectory, "necessary-cramped-output.json.gz"), Bun.gzipSync(serialized))
writeFileSync(join(outputDirectory, "reachability-report.json"), JSON.stringify(report, null, 2))
console.log("REACHABILITY_PROFILE_RESULT", JSON.stringify(report))
