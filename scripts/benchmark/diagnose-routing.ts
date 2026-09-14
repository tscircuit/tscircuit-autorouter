import { appendFileSync, mkdirSync, writeFileSync } from "node:fs"
import { routingDiagnostics } from "../../lib/solvers/routingDiagnostics"
import { runTask } from "./benchmark-run-task"
import { loadScenarioBySampleNumber } from "./scenarios"

const sampleNumber = Number(process.argv[2])
const outputDirectory = process.argv[3]
if (!Number.isInteger(sampleNumber) || !outputDirectory) {
  throw new Error("Expected a sample number and output directory")
}
mkdirSync(outputDirectory, { recursive: true })
const loaded = await loadScenarioBySampleNumber("srj18", sampleNumber, 1)
const startedAt = performance.now()
routingDiagnostics.emit = (event: Record<string, unknown>): void => {
  appendFileSync(
    `${outputDirectory}/events.jsonl`,
    `${JSON.stringify({ ...event, elapsedMsSinceStart: performance.now() - startedAt }, (_key, entry) => (entry instanceof Map ? [...entry] : entry instanceof Set ? [...entry] : entry))}\n`,
  )
}
const result = await runTask({
  ...loaded,
  datasetName: "srj18",
  solverName: "AutoroutingPipelineSolver9_PreloadedTraceGraph",
})
writeFileSync(`${outputDirectory}/result.json`, JSON.stringify(result, null, 2))
console.log(JSON.stringify({ ...result, benchmarkSnapshot: undefined }))
