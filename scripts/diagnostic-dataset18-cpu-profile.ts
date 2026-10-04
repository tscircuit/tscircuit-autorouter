import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { loadScenarioBySampleNumber } from "./benchmark/scenarios"
import { runTask } from "./benchmark/benchmark-run-task"

const expectedSource = "d010db4155513fad6e1cef325180d99a28d6201f"
const actualSource = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim()
if (actualSource !== expectedSource) throw new Error(`Unexpected source ${actualSource}`)
const sampleNumber = Number(process.argv[2])
if (sampleNumber !== 4 && sampleNumber !== 16) throw new Error("Expected sample4 or16")
const outputDirectory = path.resolve(process.argv[3])
await mkdir(outputDirectory, { recursive: true })
const { scenario, scenarioName } = await loadScenarioBySampleNumber("srj18", sampleNumber, 1)
const input = JSON.stringify(scenario)
const task = {
  datasetName: "srj18",
  solverName: "AutoroutingPipelineSolver9_PreloadedTraceGraph",
  scenarioName,
  sampleNumber,
  scenario,
}
await writeFile(path.join(outputDirectory, "input.json"), input + "\n")
await writeFile(path.join(outputDirectory, "source-and-settings.json"), JSON.stringify({
  expectedSource,
  actualSource,
  dataset: "srj18",
  sampleNumber,
  scenarioName,
  effort: 1,
  outerProcessTimeoutMs: 360000,
  solverName: task.solverName,
  entryPoint: "Unmodified scripts/benchmark/benchmark-run-task.ts runTask",
  cpuProfilerSamplingIntervalUs: 1000,
  inputSha256: createHash("sha256").update(input).digest("hex"),
  pipelineAndDependencyBudgetsUnmodified: true,
}, null, 2) + "\n")
const result = await runTask(task)
await writeFile(path.join(outputDirectory, "benchmark-task-result.json"), JSON.stringify(result, null, 2) + "\n")
console.log(JSON.stringify({
  sampleNumber,
  didSolve: result.didSolve,
  relaxedDrcPassed: result.relaxedDrcPassed,
  drcErrorCount: result.drcErrorCount,
  elapsedTimeMs: result.elapsedTimeMs,
  diagnosticCpuProfileOnly: true,
}))
if (!result.didSolve || !result.relaxedDrcPassed) process.exitCode = 1
