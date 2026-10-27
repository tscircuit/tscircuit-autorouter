import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { writeFile } from "node:fs/promises"
import { createAutorouterSolverRuntime } from "../../lib/runtime/bun"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph as Pipeline9 } from "../../lib"
import { loadScenarios } from "./scenarios"
import type { SimpleRouteJson } from "../../lib/types"

// Run one board at a time with independently prepared inputs. Every pair must
// report outcomes, paths and the global iteration accounting.
const readArg = (name: string): string | undefined => {
  const index = process.argv.indexOf(name)
  return index < 0 ? undefined : process.argv[index + 1]
}
const isolated = process.argv.includes("--isolate")
const childWorkerArg = readArg("--child-worker")
const childWorker = childWorkerArg === undefined ? undefined : Number(childWorkerArg)
if (childWorker !== undefined && ![0, 1, 4].includes(childWorker)) throw new Error("Invalid isolated worker count")
const threads = Number(readArg("--threads") ?? 4)
const repeats = Number(readArg("--repeat") ?? 3)
const referenceThreads = Number(readArg("--reference-threads") ?? 0)
if (![1, 4].includes(threads) || ![0, 1].includes(referenceThreads) || !Number.isInteger(repeats) || repeats < 1) {
  throw new Error("--threads must be 1 or 4; --reference-threads must be 0 or 1; --repeat must be positive")
}
const selected = readArg("--samples")?.split(",").map(Number)
const scenarios = (await loadScenarios("srj18")).filter(([name]) =>
  !selected || selected.includes(Number(name.match(/\d+$/)?.[0])))
if (!scenarios.length) throw new Error("No dataset18 samples selected")

type Outcome = {
  ms: number
  solved: boolean
  failed: boolean
  error: string | null
  iterations: number
  hash: string | null
  metrics: Record<string, unknown> | undefined
}
type Row = { sample: string; repeat: number; serial: Outcome; threaded: Outcome; speedup: number }
const prepare = (scenario: SimpleRouteJson): Pipeline9 => {
  const pipeline = new Pipeline9(structuredClone(scenario), { effort: 1, cacheProvider: null })
  while (pipeline.getCurrentPhase() !== "portPointPathingSolver") {
    pipeline.step()
    if (pipeline.failed || pipeline.solved) throw new Error(pipeline.error ?? "Port-point phase unavailable")
  }
  return pipeline
}
const run = async (pipeline: Pipeline9, threaded: boolean): Promise<Outcome> => {
  if (process.env.PORT_POINT_PROGRESS === "1") {
    console.error(JSON.stringify({ phaseStart: threaded ? "threaded" : "serial", unixMs: Date.now() }))
  }
  const start = performance.now()
  const workerCount = childWorker ?? (threaded ? threads : referenceThreads)
  const runtime = workerCount ? createAutorouterSolverRuntime({ workerCount, requireWorker: true }) : undefined
  try {
    pipeline.step()
    const phase = pipeline.portPointPathingSolver
    assert.ok(phase)
    if (runtime) await phase.solveAsync(runtime)
    else phase.solve()
    if (runtime) await runtime.dispose()
    const ms = performance.now() - start
    const outcome: Outcome = {
      ms,
      solved: phase.solved,
      failed: phase.failed,
      error: phase.error,
      iterations: phase.iterations,
      hash: phase.solved ? createHash("sha256").update(JSON.stringify(phase.getOutput())).digest("hex") : null,
      metrics: phase.getSolveGraphBenchmarkMetrics(),
    }
    if (process.env.PORT_POINT_PROGRESS === "1") {
      console.error(JSON.stringify({ phaseOutcome: threaded ? "threaded" : "serial", ...outcome }))
    }
    return outcome
  } finally {
    if (runtime) await runtime.dispose()
  }
}
if (childWorker !== undefined) {
  assert.equal(scenarios.length, 1, "Isolated child requires one sample")
  const outcome = await run(prepare(scenarios[0]![1]), childWorker !== 0)
  await Bun.write(Bun.stdout, JSON.stringify({ outcome }) + "\n")
  process.exit(0)
}
const runIsolated = async (sample: string, workerCount: number): Promise<Outcome> => {
  const index = Number(sample.match(/\d+$/)?.[0])
  const child = Bun.spawn([process.execPath, import.meta.filename, "--child-worker", String(workerCount), "--samples", String(index)], {
    cwd: process.cwd(), stdout: "pipe", stderr: "pipe",
  })
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
  if (code !== 0) throw new Error(`${sample}: isolated ${workerCount}T process exited ${code}: ${stderr.slice(-4000)}`)
  const result = JSON.parse(stdout.trim().split("\n").at(-1)!) as { outcome: Outcome }
  assert.ok(result.outcome && Number.isFinite(result.outcome.ms), `${sample}: isolated outcome missing`)
  return result.outcome
}
const rows: Row[] = []
for (let repeat = 0; repeat < repeats; repeat++) {
  for (const [sample, scenario] of scenarios) {
    const serialPipeline = isolated ? undefined : prepare(scenario)
    const threadedPipeline = isolated ? undefined : prepare(scenario)
    const serialRun = (): Promise<Outcome> => isolated ? runIsolated(sample, referenceThreads) : run(serialPipeline!, false)
    const threadedRun = (): Promise<Outcome> => isolated ? runIsolated(sample, threads) : run(threadedPipeline!, true)
    let serial: Outcome
    let threaded: Outcome
    if (repeat % 2 === 0) {
      serial = await serialRun()
      threaded = await threadedRun()
    } else {
      threaded = await threadedRun()
      serial = await serialRun()
    }
    const row = { sample, repeat, serial, threaded, speedup: serial.ms / threaded.ms }
    rows.push(row)
    console.log(JSON.stringify(row))
  }
}
const percentile = (values: number[], fraction: number): number => {
  const sorted = [...values].sort((a, b) => a - b)
  const position = (sorted.length - 1) * fraction
  return sorted[Math.floor(position)] + (sorted[Math.ceil(position)] - sorted[Math.floor(position)]) * (position % 1)
}
const serialMs = rows.map((row) => row.serial.ms)
const threadedMs = rows.map((row) => row.threaded.ms)
const serialTotalMs = serialMs.reduce((a, b) => a + b, 0)
const threadedTotalMs = threadedMs.reduce((a, b) => a + b, 0)
const summary = {
  dataset: "srj18", processIsolation: isolated, threads, referenceThreads, referenceBackend: referenceThreads ? "typescript-worker" : "typescript-serial", repeats, sampleCount: scenarios.length,
  completed: rows.filter((row) => row.threaded.solved).length,
  statusChanges: rows.filter((row) => row.threaded.solved !== row.serial.solved || row.threaded.failed !== row.serial.failed).length,
  serialTotalMs, threadedTotalMs, speedup: serialTotalMs / threadedTotalMs,
  targetSpeedup: 2, targetThreadedTotalMs: serialTotalMs / 2,
  phaseTargetMet: serialTotalMs / threadedTotalMs >= 2 && rows.every((row) => row.threaded.solved && !row.threaded.failed && row.threaded.solved === row.serial.solved && row.threaded.failed === row.serial.failed),
  qualityValidation: "Full-pipeline DRC validation requires the dataset benchmark",
  identicalOutputs: rows.filter((row) => row.serial.hash === row.threaded.hash).length,
  serialP50Ms: percentile(serialMs, 0.5), threadedP50Ms: percentile(threadedMs, 0.5),
  serialP95Ms: percentile(serialMs, 0.95), threadedP95Ms: percentile(threadedMs, 0.95),
  bunVersion: Bun.version,
}
console.log(JSON.stringify({ summary }))
if (readArg("--out")) await writeFile(readArg("--out")!, JSON.stringify({ summary, rows }, null, 2))

if (summary.statusChanges > 0 || summary.completed !== rows.length) process.exitCode = 1
