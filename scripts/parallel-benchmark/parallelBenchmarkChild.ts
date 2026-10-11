import { createHash } from "node:crypto"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import stableStringify from "fast-json-stable-stringify"
import { evaluateRelaxedDrc } from "../../lib/testing/evaluate-relaxed-drc"
import { runTraceLinting } from "../../lib/testing/runTraceLinting"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "../../lib/types/srj-types"
import { extractBenchmarkStageTiming, type PipelineStageTimingSource } from "../benchmark/benchmark-stage-timing"
import { loadScenarioBySampleNumber } from "../benchmark/scenarios"
import type { BenchmarkVariant, ParallelBenchmarkChildMessage, ParallelBenchmarkResult } from "./parallelBenchmarkTypes"

type Solver = PipelineStageTimingSource & {
  solved: boolean
  failed: boolean
  error?: string | null
  activeSubSolver?: { error?: string | null }
  srjWithPointPairs?: SimpleRouteJson
  step: () => void
  solve: () => void | Promise<void>
  solveAsync?: () => Promise<void>
  dispose?: () => void | Promise<void>
  getOutputSimplifiedPcbTraces: () => SimplifiedPcbTrace[]
  getOutputSimpleRouteJson: () => SimpleRouteJson
  highDensityRouteSolver?: { stats?: Record<string, unknown> }
  workerPool?: { workerCount: number; stats: Record<string, unknown> }
}

type SolverConstructor = new (
  scenario: SimpleRouteJson,
  options: { effort: number; cacheProvider: null; workerCount?: number; enableParallelPathSimplification?: boolean },
) => Solver

const emit = (message: ParallelBenchmarkChildMessage): void => {
  process.stdout.write(`PARALLEL_BENCHMARK ${JSON.stringify(message)}\n`)
}

const main = async (): Promise<void> => {
  const [sampleArgument, variantArgument, repeatArgument, effortArgument, workerArgument, outDir, simplificationArgument] = process.argv.slice(2)
  const sampleNumber = Number(sampleArgument)
  const variant = variantArgument as BenchmarkVariant
  const repeat = Number(repeatArgument)
  const effort = Number(effortArgument)
  const workerCount = Number(workerArgument)
  if (!outDir || (variant !== "baseline" && variant !== "parallel")) {
    throw new Error("Invalid benchmark child arguments")
  }
  const { scenarioName, scenario } = await loadScenarioBySampleNumber("srj18", sampleNumber, effort)
  const solverName = variant === "baseline"
    ? "AutoroutingPipelineSolver9_PreloadedTraceGraph"
    : "AutoroutingPipelineSolver9_Parallel"
  const baselineModule = process.env.PARALLEL_BENCHMARK_BASELINE_MODULE
  if (variant === "baseline" && process.env.GITHUB_ACTIONS === "true" && !baselineModule) {
    throw new Error("Blacksmith benchmark requires a frozen baseline module")
  }
  const autorouterModule = variant === "baseline" && baselineModule
    ? await import(baselineModule)
    : await import("../../lib")
  const constructor = (autorouterModule as Record<string, unknown>)[solverName]
  if (typeof constructor !== "function") throw new Error(`Missing solver export ${solverName}`)
  const SolverClass = constructor as SolverConstructor
  const input = structuredClone(scenario)
  let solver: Solver | undefined
  let error: string | undefined
  const start = performance.now()
  let lastProgress = -Infinity
  const progress = (): void => {
    if (!solver || performance.now() - lastProgress < 1000) return
    lastProgress = performance.now()
    emit({
      kind: "progress",
      elapsedTimeMs: lastProgress - start,
      phaseName: solver.pipelineDef[solver.currentPipelineStepIndex]?.solverName,
      stageTiming: extractBenchmarkStageTiming(solver, "partial"),
    })
  }
  try {
    solver = new SolverClass(input, {
      effort,
      cacheProvider: null,
      ...(variant === "parallel" ? {
        workerCount,
        enableParallelPathSimplification: simplificationArgument !== "0",
      } : {}),
    })
    progress()
    if (solver.solveAsync) {
      const timer = setInterval(progress, 1000)
      try {
        await solver.solveAsync()
      } finally {
        clearInterval(timer)
      }
    } else {
      await solver.solve()
    }
  } catch (caught) {
    error = caught instanceof Error ? caught.stack ?? caught.message : String(caught)
  } finally {
    if (solver?.dispose) {
      try {
        await solver.dispose()
      } catch (caught) {
        error = caught instanceof Error ? caught.stack ?? caught.message : String(caught)
      }
    }
  }
  const elapsedTimeMs = performance.now() - start
  const solved = solver?.solved === true && solver.failed === false && error === undefined
  const result: ParallelBenchmarkResult = {
    sampleName: scenarioName,
    repeat,
    variant,
    status: solved ? "solved" : "failed",
    elapsedTimeMs,
    error: error ?? solver?.activeSubSolver?.error ?? solver?.error ?? undefined,
    stageTiming: solver ? extractBenchmarkStageTiming(solver, solved ? "complete" : "partial") : undefined,
    phaseName: solver?.pipelineDef[solver.currentPipelineStepIndex]?.solverName,
    workerStats: solver?.highDensityRouteSolver?.stats,
    workerPoolStats: solver?.workerPool ? {
      workerCount: solver.workerPool.workerCount,
      ...solver.workerPool.stats,
    } : undefined,
    stageStats: solver ? Object.fromEntries(solver.pipelineDef.flatMap(({ solverName }) => {
      const stage = (solver as unknown as Record<string, { stats?: Record<string, unknown> }>)[solverName]
      return stage?.stats ? [[solverName, stage.stats]] : []
    })) : undefined,
  }
  emit({
    kind: "progress",
    elapsedTimeMs,
    phaseName: solved ? "quality-validation" : result.phaseName,
    stageTiming: result.stageTiming,
  })
  if (solved && solver) {
    const traces = solver.getOutputSimplifiedPcbTraces()
    const output = solver.getOutputSimpleRouteJson()
    result.geometryHash = createHash("sha256").update(stableStringify(traces)).digest("hex")
    result.outputHash = createHash("sha256").update(stableStringify(output)).digest("hex")
    const { errors } = evaluateRelaxedDrc({
      inputSrj: scenario,
      srjWithPointPairs: solver.srjWithPointPairs ?? scenario,
      routedTraces: traces,
    })
    const traceLintIssues = runTraceLinting(output).getOutput()
    const traceLintIssueCounts: Record<string, number> = {}
    for (const issue of traceLintIssues) {
      traceLintIssueCounts[issue.type] = (traceLintIssueCounts[issue.type] ?? 0) + 1
    }
    result.quality = {
      traceCount: traces.length,
      viaCount: traces.reduce((sum, trace) => sum + trace.route.filter((point) => point.route_type === "via").length, 0),
      drcErrorCount: errors.length,
      traceLintIssueCounts,
    }
    await mkdir(outDir, { recursive: true })
    await writeFile(path.join(outDir, "routed-srj.json"), JSON.stringify(output))
    await writeFile(path.join(outDir, "quality.json"), JSON.stringify({ ...result.quality, errors, traceLintIssues }, null, 2))
  }
  await mkdir(outDir, { recursive: true })
  await writeFile(path.join(outDir, "result.json"), JSON.stringify(result, null, 2))
  emit({ kind: "result", result })
}

await main()
