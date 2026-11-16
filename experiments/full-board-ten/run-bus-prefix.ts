import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

const [inputArg, outputArg] = process.argv.slice(2)
if (!inputArg || !outputArg || Bun.version !== "1.4.3") throw new Error("Usage: Bun1.4.3 run-bus-prefix.ts INPUT_DIR OUTPUT")
const input = resolve(inputArg), output = resolve(outputArg)
mkdirSync(output, { recursive: true })
const log = openSync(join(output, "worker.log"), "w")
const environment = { ...process.env }
delete environment.FULL_BOARD_CORE_MODULE
delete environment.FULL_BOARD_COPPER_MODULE
const started = performance.now()
const worker = Bun.spawn([process.execPath, join(import.meta.dir, "render-bus-prefix.ts"), input, output], { cwd: import.meta.dir, env: environment, stdout: log, stderr: log })
let peakRssKb = 0, hardTimedOut = false
const sample = setInterval((): void => {
  try {
    const match = /VmHWM:\s+(\d+)/.exec(readFileSync(`/proc/${worker.pid}/status`, "utf8"))
    if (match) peakRssKb = Math.max(peakRssKb, Number(match[1]))
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || !["ENOENT", "ESRCH"].includes(String(error.code))) throw error
  }
}, 1000)
const watchdog = setTimeout((): void => { hardTimedOut = true; worker.kill("SIGKILL") }, 180000)
const workerExitCode = await worker.exited
clearInterval(sample)
clearTimeout(watchdog)
closeSync(log)
const progressPath = join(output, "progress.json")
const progress = existsSync(progressPath) ? JSON.parse(readFileSync(progressPath, "utf8")) : null
const census = progress?.gridCensus
const censusValid = census?.calls > 0 && census.calls === census.hits + census.misses && census.missCells >= 0 && census.inputCount > 0 && census.keys.length <= 16 && census.inputs.length <= 16 && census.transitions.length <= 64 && census.callSequence.length <= 8192 && census.callSequence.length + census.callSequenceOmitted === census.calls
const diagnosticCompleted = workerExitCode === 0 && !hardTimedOut && censusValid && progress?.postHashesVerified === true && progress.wasmUsage.routingOrUnknownAttempts === 0 && ["diagnostic_prefix_cutoff", "phase_solved", "phase_failed"].includes(progress.status)
const result = {
  id: "imx6", cohort: "spaced", phase: "byte1", executionMode: "board_grid_counter_census",
  status: diagnosticCompleted ? progress.status : "diagnostic_failed", diagnosticCompleted, completionClaim: false,
  workerExitCode, hardTimedOut, wallMs: performance.now() - started, peakRssMiB: peakRssKb / 1024,
  prefixMs: 120000, hardDeadlineMs: 180000, profiled: false,
  gridCensus: census ?? null, instrumentation: progress?.runtime.gridCensusInstrumentation ?? null, censusValid,
  sourceArtifact: progress?.sourceArtifact ?? null, phaseInputSha256: progress?.phaseInputSha256 ?? null,
  runtimePackages: progress?.runtime.packages ?? null, postHashesVerified: progress?.postHashesVerified ?? false,
  prefixElapsedMs: progress?.elapsedMs ?? null, cutoffOvershootMs: progress?.cutoffOvershootMs ?? null,
  solver: progress?.solver ?? null, phaseHistory: progress?.phaseHistory ?? null,
  wasm: progress ? { coldMainImportCalls: progress.wasmUsage.coldMainImportCalls, routingOrUnknownAttempts: progress.wasmUsage.routingOrUnknownAttempts } : null,
  error: progress?.error ?? null,
  limitations: "Unprofiled counter-only fresh-process cold-cache actual-input prefix; instrumentation has overhead and is not performance evidence. Omits preceding byte0 history, wrapper visualization and full-board work. Cooperative cutoff may overrun one constructor/step. Exit0 and diagnosticCompleted are not physical routing completion or full-board parity.",
}
const encoded = JSON.stringify(result)
if (Buffer.byteLength(encoded) > 1000000) throw new Error("Prefix result exceeds bounded report size")
writeFileSync(join(output, "process.json"), JSON.stringify(result, null, 2))
console.log(`GRID_CENSUS_RESULT ${encoded}`)
if (!diagnosticCompleted) process.exitCode = 1
