#!/usr/bin/env bun

import { spawn } from "node:child_process"
import { mkdir, writeFile } from "node:fs/promises"
import { cpus, hostname, platform, release } from "node:os"
import { resolve } from "node:path"
import { getPngBufferFromGraphicsObject } from "graphics-debug"
import { prepareHybridBenchmarkInput } from "../lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/benchmark-routing-rules"
import { convertSrjToGraphicsObject } from "../lib/utils/convertSrjToGraphicsObject"
import {
  createHybridBenchmarkReport,
  renderHybridBenchmarkMarkdown,
} from "./hybrid-benchmark/report"
import {
  loadHybridBenchmarkScenarios,
  type HybridBenchmarkScenario,
} from "./hybrid-benchmark/scenarios"
import type {
  HybridBenchmarkRun,
  HybridBenchmarkTask,
  HybridBenchmarkTaskOutput,
} from "./hybrid-benchmark/types"

const nativeRuntimeModulePath = process.argv[2]
const requestedOutputDirectory = process.argv[3]
if (!nativeRuntimeModulePath || !requestedOutputDirectory) {
  throw new Error(
    "usage: bun scripts/benchmark-hybrid-transactional-router.ts <native-module-path> <output-directory> [per-pass-timeout-ms] [scenario-id]",
  )
}
const outputDirectory = resolve(requestedOutputDirectory)
const perPassTimeoutMs = parseTimeout(process.argv[4])
const requestedScenarioId = process.argv[5]
const maximumConcurrency = 4
await mkdir(outputDirectory, { recursive: true })
const allScenarios = await loadHybridBenchmarkScenarios()
const scenarios = requestedScenarioId
  ? allScenarios.filter((scenario) => scenario.scenarioId === requestedScenarioId)
  : allScenarios
if (scenarios.length === 0) {
  throw new Error(`benchmark scenario ${requestedScenarioId} was not found`)
}
const preparedScenarios = scenarios.map((scenario) => ({
  scenario,
  prepared: prepareHybridBenchmarkInput(scenario.input),
}))
await writeFile(
  resolve(outputDirectory, "benchmark-input-policy.json"),
  JSON.stringify(
    preparedScenarios.map(({ scenario, prepared }) => ({
      scenarioId: scenario.scenarioId,
      source: scenario.source,
      categories: scenario.categories,
      policy: prepared.policy,
    })),
    null,
    2,
  ),
)

const runs: HybridBenchmarkRun[] = []
console.log(
  `Running ${preparedScenarios.length} untouched production baselines before experimental work`,
)
for (const { scenario, prepared } of preparedScenarios) {
  const task = createTask({
    mode: "production",
    scenario,
    preparedInput: prepared.input,
    inputPolicy: prepared.policy,
  })
  const taskRuns = await executeTask({
    task,
    timeoutMs: perPassTimeoutMs,
    timedOutEngines: ["production"],
  })
  runs.push(...taskRuns)
  printTaskResult(taskRuns)
}

console.log("Production baseline complete; running hybrid cold and warm passes")
for (const { scenario, prepared } of preparedScenarios) {
  const task = createTask({
    mode: "experimental",
    scenario,
    preparedInput: prepared.input,
    inputPolicy: prepared.policy,
  })
  const taskRuns = await executeTask({
    task,
    timeoutMs: perPassTimeoutMs * 2,
    timedOutEngines: ["hybrid-cold", "hybrid-warm"],
  })
  runs.push(...taskRuns)
  printTaskResult(taskRuns)
}

const cpu = cpus()[0]
const report = createHybridBenchmarkReport({
  runs,
  machine: Object.freeze({
    hostname: hostname(),
    platform: platform(),
    release: release(),
    cpuModel: cpu?.model ?? "unknown",
    logicalCpuCount: cpus().length,
    bunVersion: Bun.version,
  }),
  configuration: Object.freeze({
    productionSolver: "AutoroutingPipelineSolver7_MultiGraph",
    experimentalSolver: "AutoroutingPipelineSolver12_HybridTransactionalRouter",
    effort: 1,
    maximumConcurrency,
    perPassTimeoutMs,
    deterministicSeed: 17,
    maximumSearchExpansions: 250_000,
    externalValidation: "evaluateRelaxedDrc",
    productionCache: "disabled",
    experimentalCache: "bounded 2048 entries / 128MiB",
    benchmarkInputPolicy:
      "missing hole=0.3mm, pad=max(0.6mm,hole+2*trace width), clearance=0.15mm",
  }),
})
const jsonPath = resolve(outputDirectory, "benchmark-results.json")
const markdownPath = resolve(outputDirectory, "benchmark-report.md")
await writeFile(jsonPath, JSON.stringify(report, null, 2))
await writeFile(markdownPath, renderHybridBenchmarkMarkdown(report))
console.log(
  JSON.stringify({
    outputDirectory,
    jsonPath,
    markdownPath,
    runCount: report.runs.length,
    passedGates: report.gates.filter((gate) => gate.passed).length,
    totalGates: report.gates.length,
  }),
)

function createTask({
  mode,
  scenario,
  preparedInput,
  inputPolicy,
}: {
  mode: HybridBenchmarkTask["mode"]
  scenario: HybridBenchmarkScenario
  preparedInput: HybridBenchmarkTask["input"]
  inputPolicy: HybridBenchmarkTask["inputPolicy"]
}): HybridBenchmarkTask {
  return Object.freeze({
    mode,
    scenarioId: scenario.scenarioId,
    source: scenario.source,
    categories: scenario.categories,
    input: preparedInput,
    inputPolicy,
    outputDirectory,
    nativeRuntimeModulePath: resolve(nativeRuntimeModulePath),
    maximumConcurrency,
  })
}

async function executeTask({
  task,
  timeoutMs,
  timedOutEngines,
}: {
  task: HybridBenchmarkTask
  timeoutMs: number
  timedOutEngines: readonly HybridBenchmarkRun["engine"][]
}): Promise<readonly HybridBenchmarkRun[]> {
  const taskPath = resolve(
    outputDirectory,
    `.task-${task.mode}-${task.scenarioId}.json`,
  )
  await writeFile(taskPath, JSON.stringify(task))
  const childResult = await runChildProcess({ taskPath, timeoutMs })
  if (childResult.output) return childResult.output.runs
  const failureReason = childResult.timedOut
    ? `benchmark pass exceeded ${timeoutMs}ms child-process limit`
    : `benchmark child failed: ${childResult.stderr || childResult.stdout || `exit ${childResult.exitCode}`}`
  return Promise.all(
    timedOutEngines.map((engine) =>
      createFailedRun({
        task,
        engine,
        status: childResult.timedOut ? "timeout" : "algorithmic-failure",
        elapsedMs: timeoutMs,
        failureReason,
      }),
    ),
  )
}

type ChildExecutionResult = {
  readonly output?: HybridBenchmarkTaskOutput
  readonly timedOut: boolean
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number | null
}

function runChildProcess({
  taskPath,
  timeoutMs,
}: {
  taskPath: string
  timeoutMs: number
}): Promise<ChildExecutionResult> {
  return new Promise((resolveResult) => {
    const child = spawn(
      process.execPath,
      [resolve("scripts/hybrid-benchmark/run-task.ts"), taskPath],
      { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] },
    )
    let stdout = ""
    let stderr = ""
    let timedOut = false
    child.stdout.on("data", (chunk: Buffer) => {
      stdout = appendBounded(stdout, chunk.toString())
    })
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = appendBounded(stderr, chunk.toString())
    })
    const timeout = setTimeout(() => {
      timedOut = true
      child.kill("SIGTERM")
    }, timeoutMs)
    child.on("close", (exitCode) => {
      clearTimeout(timeout)
      const resultLine = stdout
        .split("\n")
        .findLast((line) => line.startsWith("HYBRID_BENCHMARK_RESULT="))
      resolveResult({
        output: resultLine
          ? parseTaskOutput(resultLine.slice("HYBRID_BENCHMARK_RESULT=".length))
          : undefined,
        timedOut,
        stdout,
        stderr,
        exitCode,
      })
    })
  })
}

async function createFailedRun({
  task,
  engine,
  status,
  elapsedMs,
  failureReason,
}: {
  task: HybridBenchmarkTask
  engine: HybridBenchmarkRun["engine"]
  status: "timeout" | "algorithmic-failure"
  elapsedMs: number
  failureReason: string
}): Promise<HybridBenchmarkRun> {
  const pngFileName = `${task.scenarioId}--${engine}.png`
  const pngPath = resolve(outputDirectory, pngFileName)
  await writeFile(
    pngPath,
    await getPngBufferFromGraphicsObject(
      convertSrjToGraphicsObject(task.input),
      { backgroundColor: "white", pngWidth: 1280, pngHeight: 960 },
    ),
  )
  return Object.freeze({
    scenarioId: task.scenarioId,
    source: task.source,
    categories: task.categories,
    engine,
    status,
    elapsedMs,
    processCpuMs: 0,
    detailedRoutingMs: 0,
    finalizationMs: 0,
    peakHeapBytes: 0,
    peakRssBytes: 0,
    zeroDrc: null,
    drcErrorCount: null,
    drcErrorMessages: Object.freeze([]),
    finalConnectivityVerified: null,
    viaCount: null,
    routedLengthMm: null,
    bendCount: null,
    routeHash: null,
    workerCpuMs: null,
    workerUtilization: null,
    cacheHits: null,
    cacheMisses: null,
    cacheStoredBytes: null,
    stageElapsedMs: Object.freeze({}),
    workMetrics: null,
    failureReason,
    pngPath: pngFileName,
  })
}

function parseTaskOutput(serialized: string): HybridBenchmarkTaskOutput {
  const value: unknown = JSON.parse(serialized)
  if (!isRecord(value) || !Array.isArray(value.runs)) {
    throw new Error("benchmark child returned an invalid result")
  }
  return { runs: value.runs.map(parseRun) }
}

function parseRun(value: unknown): HybridBenchmarkRun {
  if (!isRecord(value)) throw new Error("benchmark run must be an object")
  if (
    typeof value.scenarioId !== "string" ||
    typeof value.source !== "string" ||
    !Array.isArray(value.categories) ||
    (value.engine !== "production" &&
      value.engine !== "hybrid-cold" &&
      value.engine !== "hybrid-warm") ||
    typeof value.status !== "string" ||
    typeof value.elapsedMs !== "number" ||
    typeof value.pngPath !== "string"
  ) {
    throw new Error("benchmark child returned a malformed run")
  }
  return value as HybridBenchmarkRun
}

function parseTimeout(value: string | undefined): number {
  if (value === undefined) return 120_000
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error("per-pass-timeout-ms must be a positive safe integer")
  }
  return parsed
}

function appendBounded(current: string, addition: string): string {
  const combined = current + addition
  return combined.length <= 1_000_000 ? combined : combined.slice(-1_000_000)
}

function printTaskResult(runs: readonly HybridBenchmarkRun[]): void {
  for (const run of runs) {
    console.log(
      `${run.scenarioId} ${run.engine}: ${run.status} ${run.elapsedMs.toFixed(1)}ms DRC=${run.drcErrorCount ?? "n/a"}`,
    )
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
