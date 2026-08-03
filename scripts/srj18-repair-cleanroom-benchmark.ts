#!/usr/bin/env bun

import { createHash } from "node:crypto"
import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import {
  isMainThread,
  parentPort,
  Worker,
  workerData,
} from "node:worker_threads"
import { gzipSync } from "node:zlib"
import stableStringify from "fast-json-stable-stringify"
import {
  GlobalDrcForceImproveSolver,
  type GlobalDrcForceImproveSolverParams,
} from "high-density-repair03/lib"
import { getDrcSnapshot } from "high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/drc-snapshot"
import { AutoroutingPipelineSolver7_MultiGraph } from "../lib"
import { loadScenarioBySampleNumber } from "./benchmark/scenarios"

type SampleResult = {
  sampleId: string
  scenarioName: string
  inputHash: string
  traceCount: number
  initialDrcCount: number
  finalDrcCount: number
  improvement: number
  iterations: number[]
  solverRuntimeMs: number[]
  medianSolverRuntimeMs: number
}

type WorkerInput = {
  sampleNumber: number
  repetitions: number
  sampleTimeoutMs: number
  inputsOutDir?: string
}

type BenchmarkReport = {
  schemaVersion: 1
  benchmark: "srj18-live-pipeline7-global-drc-repair"
  provenance: {
    autorouterCommit: string
    repair03Commit: string
    autorouterLockSha256: string
    repair03LockSha256: string
    evaluatorSha256: string
    bunVersion: string
    runnerName: string
    runnerArch: string
    runnerOs: string
  }
  conditions: {
    dataset: "srj18"
    sampleCount: number
    pipeline: "AutoroutingPipelineSolver7_MultiGraph"
    inputBoundary: "before-globalDrcForceImproveSolver"
    effort: 1
    maxIterations: 16
    concurrency: number
    repetitions: number
    sampleTimeoutMs: number
    cacheProvider: null
    enableLargeBoardBroadFallback: false
    enablePostSolveClearanceRelaxation: false
  }
  metrics: {
    totalInitialDrcCount: number
    totalFinalDrcCount: number
    totalImprovement: number
    medianSolverRuntimeMs: number
  }
  sampleResults: SampleResult[]
}

const SAMPLE_COUNT = 16
const TARGET_PHASE = "globalDrcForceImproveSolver"

const median = (values: number[]): number => {
  if (values.length === 0) throw new Error("Cannot compute an empty median")
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!
}

const hashValue = (value: unknown): string =>
  createHash("sha256").update(stableStringify(value)).digest("hex")

const getInputHash = (params: GlobalDrcForceImproveSolverParams): string =>
  hashValue({
    srj: params.srj,
    hdRoutes: params.hdRoutes,
    connectivityNetMap: params.connMap?.netMap ?? null,
    effort: params.effort,
    maxIterations: params.maxIterations,
    enableLargeBoardBroadFallback: params.enableLargeBoardBroadFallback,
    enableTargetedErrorSweep: params.enableTargetedErrorSweep,
    enablePostSolveClearanceRelaxation:
      params.enablePostSolveClearanceRelaxation,
    enableSafeTraceLayerMoves: params.enableSafeTraceLayerMoves,
    enableViaInPadLayerMoves: params.enableViaInPadLayerMoves,
    viaHoleDiameter: params.viaHoleDiameter,
  })

const assertExpectedOptions = (
  params: GlobalDrcForceImproveSolverParams,
): void => {
  if (params.effort !== 1) throw new Error(`Expected effort=1`)
  if (params.maxIterations !== 16) {
    throw new Error(`Expected maxIterations=16, got ${params.maxIterations}`)
  }
  if (params.enableLargeBoardBroadFallback !== false) {
    throw new Error("Large-board broad fallback must be disabled")
  }
  if (params.enablePostSolveClearanceRelaxation !== false) {
    throw new Error("Post-solve clearance relaxation must be disabled")
  }
  if (params.drcEvaluator !== undefined) {
    throw new Error("Expected the built-in repair03 DRC evaluator")
  }
}

const buildFreshRepairInput = async ({
  sampleNumber,
  sampleTimeoutMs,
}: WorkerInput): Promise<{
  sampleId: string
  scenarioName: string
  params: GlobalDrcForceImproveSolverParams
}> => {
  const { scenarioName, scenario } = await loadScenarioBySampleNumber(
    "srj18",
    sampleNumber,
    1,
  )
  const pipeline = new AutoroutingPipelineSolver7_MultiGraph(scenario, {
    effort: 1,
    cacheProvider: null,
  })
  const startedAt = performance.now()

  while (
    pipeline.getCurrentPhase() !== TARGET_PHASE &&
    !pipeline.solved &&
    !pipeline.failed
  ) {
    if (performance.now() - startedAt > sampleTimeoutMs) {
      throw new Error(
        `sample${String(sampleNumber).padStart(3, "0")} exceeded the ${sampleTimeoutMs}ms input-generation timeout`,
      )
    }
    pipeline.step()
  }

  if (pipeline.failed || pipeline.solved) {
    throw new Error(
      `Pipeline did not reach ${TARGET_PHASE}: ${pipeline.error ?? "unexpected completion"}`,
    )
  }

  const phase = pipeline.pipelineDef[pipeline.currentPipelineStepIndex]
  if (!phase || phase.solverName !== TARGET_PHASE) {
    throw new Error(`Pipeline boundary mismatch at ${pipeline.getCurrentPhase()}`)
  }
  const [params] = phase.getConstructorParams(pipeline) as [
    GlobalDrcForceImproveSolverParams,
  ]
  assertExpectedOptions(params)

  return {
    sampleId: `sample${String(sampleNumber).padStart(3, "0")}`,
    scenarioName,
    params,
  }
}

const runSample = async (input: WorkerInput): Promise<SampleResult> => {
  const { sampleId, scenarioName, params } =
    await buildFreshRepairInput(input)
  if (input.inputsOutDir) {
    const {
      connMap: _connMap,
      drcEvaluator: _drcEvaluator,
      autoroutingDrcEngine: _autoroutingDrcEngine,
      ...serializableParams
    } = params
    mkdirSync(input.inputsOutDir, { recursive: true })
    writeFileSync(
      path.join(input.inputsOutDir, `${sampleId}.json.gz`),
      gzipSync(
        JSON.stringify({
          version: 2,
          dataset: "srj18",
          sampleId,
          scenarioName,
          provenance: {
            repository: "tscircuit/tscircuit-autorouter",
            commit: Bun.env.AUTOROUTER_COMMIT ?? "unknown",
            pipeline: "AutoroutingPipelineSolver7_MultiGraph",
            repairStage: TARGET_PHASE,
          },
          connectivityNetMap: params.connMap?.netMap ?? null,
          params: serializableParams,
        }),
      ) as unknown as Uint8Array<ArrayBuffer>,
    )
  }
  const inputHash = getInputHash(params)
  const initialDrc = getDrcSnapshot(
    params.srj,
    params.hdRoutes,
    undefined,
    params.connMap,
  )
  const solverRuntimeMs: number[] = []
  const iterations: number[] = []
  const finalDrcCounts: number[] = []

  for (let repetition = 0; repetition < input.repetitions; repetition += 1) {
    const startedAt = performance.now()
    const solver = new GlobalDrcForceImproveSolver(params)
    solver.solve()
    const elapsedMs = performance.now() - startedAt

    if (solver.failed || !solver.solved) {
      throw new Error(
        `${sampleId} repetition ${repetition + 1} failed: ${solver.error ?? "unsolved"}`,
      )
    }
    if (getInputHash(params) !== inputHash) {
      throw new Error(`${sampleId} input mutated during repair`)
    }

    const finalDrc = getDrcSnapshot(
      params.srj,
      solver.getOutput(),
      undefined,
      params.connMap,
    )
    solverRuntimeMs.push(elapsedMs)
    iterations.push(solver.iterations)
    finalDrcCounts.push(finalDrc.count)
  }

  if (new Set(finalDrcCounts).size !== 1) {
    throw new Error(
      `${sampleId} produced nondeterministic final DRC counts: ${finalDrcCounts.join(", ")}`,
    )
  }

  const finalDrcCount = finalDrcCounts[0]!
  return {
    sampleId,
    scenarioName,
    inputHash,
    traceCount: params.hdRoutes.length,
    initialDrcCount: initialDrc.count,
    finalDrcCount,
    improvement: initialDrc.count - finalDrcCount,
    iterations,
    solverRuntimeMs,
    medianSolverRuntimeMs: median(solverRuntimeMs),
  }
}

const runWorker = (input: WorkerInput): Promise<SampleResult> =>
  new Promise((resolve, reject) => {
    const worker = new Worker(import.meta.filename, { workerData: input })
    worker.once("message", (message) => {
      if (message?.type === "done") resolve(message.result as SampleResult)
      else reject(new Error(message?.error ?? "Worker returned no result"))
    })
    worker.once("error", reject)
    worker.once("exit", (code) => {
      if (code !== 0) reject(new Error(`Worker exited with code ${code}`))
    })
  })

const parsePositiveInteger = (
  args: string[],
  flag: string,
  fallback: number,
): number => {
  const index = args.indexOf(flag)
  const rawValue = index === -1 ? undefined : args[index + 1]
  if (rawValue === undefined) return fallback
  const value = Number(rawValue)
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${flag} must be a positive integer`)
  }
  return value
}

const parseString = (
  args: string[],
  flag: string,
  fallback: string,
): string => {
  const index = args.indexOf(flag)
  return index === -1 ? fallback : (args[index + 1] ?? fallback)
}

const runMain = async (): Promise<void> => {
  const args = Bun.argv.slice(2)
  const concurrency = parsePositiveInteger(args, "--concurrency", 4)
  const repetitions = parsePositiveInteger(args, "--repetitions", 3)
  const sampleTimeoutMs = parsePositiveInteger(
    args,
    "--sample-timeout-ms",
    1_800_000,
  )
  const outputPath = parseString(
    args,
    "--out",
    "srj18-cleanroom-baseline.json",
  )
  const inputsOutDir = parseString(args, "--inputs-out-dir", "")
  const results: SampleResult[] = []

  for (let offset = 0; offset < SAMPLE_COUNT; offset += concurrency) {
    const batch = Array.from(
      { length: Math.min(concurrency, SAMPLE_COUNT - offset) },
      (_, index) => offset + index + 1,
    )
    const batchResults = await Promise.all(
      batch.map((sampleNumber) =>
        runWorker({
          sampleNumber,
          repetitions,
          sampleTimeoutMs,
          ...(inputsOutDir ? { inputsOutDir } : {}),
        }),
      ),
    )
    results.push(...batchResults)
    for (const result of batchResults) {
      console.log(
        `${result.sampleId} drc=${result.initialDrcCount}->${result.finalDrcCount} median=${result.medianSolverRuntimeMs.toFixed(2)}ms input=${result.inputHash.slice(0, 12)}`,
      )
    }
  }

  results.sort((a, b) => a.sampleId.localeCompare(b.sampleId))
  const totalInitialDrcCount = results.reduce(
    (sum, result) => sum + result.initialDrcCount,
    0,
  )
  const totalFinalDrcCount = results.reduce(
    (sum, result) => sum + result.finalDrcCount,
    0,
  )
  const report: BenchmarkReport = {
    schemaVersion: 1,
    benchmark: "srj18-live-pipeline7-global-drc-repair",
    provenance: {
      autorouterCommit: Bun.env.AUTOROUTER_COMMIT ?? "unknown",
      repair03Commit: Bun.env.REPAIR03_COMMIT ?? "unknown",
      autorouterLockSha256: Bun.env.AUTOROUTER_LOCK_SHA256 ?? "unknown",
      repair03LockSha256: Bun.env.REPAIR03_LOCK_SHA256 ?? "unknown",
      evaluatorSha256: Bun.env.EVALUATOR_SHA256 ?? "unknown",
      bunVersion: Bun.version,
      runnerName: Bun.env.RUNNER_NAME ?? "unknown",
      runnerArch: Bun.env.RUNNER_ARCH ?? process.arch,
      runnerOs: Bun.env.RUNNER_OS ?? process.platform,
    },
    conditions: {
      dataset: "srj18",
      sampleCount: SAMPLE_COUNT,
      pipeline: "AutoroutingPipelineSolver7_MultiGraph",
      inputBoundary: "before-globalDrcForceImproveSolver",
      effort: 1,
      maxIterations: 16,
      concurrency,
      repetitions,
      sampleTimeoutMs,
      cacheProvider: null,
      enableLargeBoardBroadFallback: false,
      enablePostSolveClearanceRelaxation: false,
    },
    metrics: {
      totalInitialDrcCount,
      totalFinalDrcCount,
      totalImprovement: totalInitialDrcCount - totalFinalDrcCount,
      medianSolverRuntimeMs: median(
        results.map((result) => result.medianSolverRuntimeMs),
      ),
    },
    sampleResults: results,
  }

  await Bun.write(outputPath, `${JSON.stringify(report, null, 2)}\n`)
  console.log(
    `total drc=${totalInitialDrcCount}->${totalFinalDrcCount} median=${report.metrics.medianSolverRuntimeMs.toFixed(2)}ms`,
  )
}

if (isMainThread) {
  await runMain()
} else {
  try {
    const result = await runSample(workerData as WorkerInput)
    parentPort?.postMessage({ type: "done", result })
  } catch (error) {
    parentPort?.postMessage({
      type: "error",
      error: error instanceof Error ? error.stack : String(error),
    })
  }
}
