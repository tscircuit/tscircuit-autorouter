import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

const [inputArg, outputArg] = process.argv.slice(2)
if (!inputArg || !outputArg || Bun.version !== "1.4.3") throw new Error("Usage: Bun1.4.3 run-bus-prefix.ts INPUT_DIR OUTPUT")
const input = resolve(inputArg), output = resolve(outputArg)
mkdirSync(output, { recursive: true })
const profileDirectory = join(output, "cpu-profile")
mkdirSync(profileDirectory)
const log = openSync(join(output, "worker.log"), "w")
const environment = { ...process.env }
delete environment.FULL_BOARD_CORE_MODULE
delete environment.FULL_BOARD_COPPER_MODULE
const started = performance.now()
const worker = Bun.spawn([process.execPath, "--cpu-prof", `--cpu-prof-dir=${profileDirectory}`, "--cpu-prof-name=render.cpuprofile", "--cpu-prof-interval=10000", join(import.meta.dir, "render-bus-prefix.ts"), input, output], { cwd: import.meta.dir, env: environment, stdout: log, stderr: log })
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
const profilePresent = existsSync(join(profileDirectory, "render.cpuprofile"))
const diagnosticCompleted = workerExitCode === 0 && !hardTimedOut && profilePresent && progress?.postHashesVerified === true && progress.wasmUsage.routingOrUnknownAttempts === 0 && ["diagnostic_prefix_cutoff", "phase_solved", "phase_failed"].includes(progress.status)
const result = {
  id: "imx6", cohort: "spaced", phase: "byte1", executionMode: "cpu_prefix_diagnostic",
  status: diagnosticCompleted ? progress.status : "diagnostic_failed", diagnosticCompleted, completionClaim: false,
  workerExitCode, hardTimedOut, wallMs: performance.now() - started, peakRssMiB: peakRssKb / 1024,
  prefixMs: 120000, hardDeadlineMs: 180000, samplingIntervalUs: 10000,
  profile: { present: profilePresent, file: "cpu-profile/render.cpuprofile", scope: "prefix worker only", transport: "Ordinary artifact only" },
  sourceArtifact: progress?.sourceArtifact ?? null, phaseInputSha256: progress?.phaseInputSha256 ?? null,
  runtimePackages: progress?.runtime.packages ?? null, postHashesVerified: progress?.postHashesVerified ?? false,
  prefixElapsedMs: progress?.elapsedMs ?? null, cutoffOvershootMs: progress?.cutoffOvershootMs ?? null,
  solver: progress?.solver ?? null, phaseHistory: progress?.phaseHistory ?? null,
  wasm: progress ? { coldMainImportCalls: progress.wasmUsage.coldMainImportCalls, routingOrUnknownAttempts: progress.wasmUsage.routingOrUnknownAttempts } : null,
  error: progress?.error ?? null,
  limitations: "Fresh-process cold-cache actual-input prefix; omits preceding byte0 history, wrapper visualization and full-board work. Cooperative cutoff may overrun one constructor/step. Exit0 and diagnosticCompleted are not physical routing completion or full-board parity.",
}
const encoded = JSON.stringify(result)
if (Buffer.byteLength(encoded) > 20000) throw new Error("Prefix result exceeds bounded report size")
writeFileSync(join(output, "process.json"), JSON.stringify(result, null, 2))
console.log(`CPU_PREFIX_RESULT ${encoded}`)
if (!diagnosticCompleted) process.exitCode = 1
