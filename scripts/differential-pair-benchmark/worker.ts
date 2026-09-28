import { renameSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { performance } from "node:perf_hooks"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "../../lib/types"
import { combinePreloadedAndRoutedTraces } from "../../lib/testing/evaluate-relaxed-drc"
import { createSolverForTask } from "../benchmark/benchmark-run-task"
import type { CorpusSample } from "../differential-pair-corpus/types"
import { evaluatePairOutput } from "./evaluatePairOutput"
import type {
  BenchmarkConfig,
  LogicalPathMeasurement,
  SampleResult,
} from "./types"

type CheckpointSolver = ReturnType<typeof createSolverForTask> & {
  getPrePowerTraceOutputSimplifiedPcbTraces?: () => SimplifiedPcbTrace[]
  highDensityStitchSolver?: { solved?: boolean }
}

function writeJson(path: string, value: unknown): void {
  const temporaryPath = `${path}.tmp`
  writeFileSync(temporaryPath, JSON.stringify(value, null, 2))
  renameSync(temporaryPath, path)
}

export function measureLogicalPaths(
  sample: CorpusSample,
  metrics: ReturnType<typeof evaluatePairOutput>,
): LogicalPathMeasurement[] {
  return sample.logicalPaths.map((logicalPath) => {
    const lengths = new Map<string, number>()
    for (const pair of metrics.pairs) {
      if (
        pair.measurementStatus !== "measured" ||
        pair.terminalCoverage !== "pass" ||
        !pair.lengthsMm
      )
        continue
      pair.connectionNames.forEach((name, index) =>
        lengths.set(name, pair.lengthsMm![index]!),
      )
    }
    const names = [
      ...logicalPath.positiveConnectionNames,
      ...logicalPath.negativeConnectionNames,
    ]
    const measured = names.every((name) => lengths.has(name))
    const positive = measured
      ? logicalPath.positiveConnectionNames.reduce(
          (sum, name) => sum + lengths.get(name)!,
          0,
        )
      : null
    const negative = measured
      ? logicalPath.negativeConnectionNames.reduce(
          (sum, name) => sum + lengths.get(name)!,
          0,
        )
      : null
    return {
      pairId: logicalPath.pairId,
      status: measured ? "measured" : "unavailable",
      positivePlanarLengthMm: positive,
      negativePlanarLengthMm: negative,
      planarSkewMm:
        positive !== null && negative !== null
          ? Math.abs(positive - negative)
          : null,
    }
  })
}

async function runWorker(): Promise<void> {
  const [samplePath, directory, configJson] = process.argv.slice(2)
  if (!samplePath || !directory || !configJson)
    throw new Error("Worker requires sample, directory and config")
  const sample: CorpusSample = await Bun.file(samplePath).json()
  const config: BenchmarkConfig = JSON.parse(configJson)
  const started = performance.now()
  const result: SampleResult = {
    sampleId: sample.sampleId,
    fingerprint: sample.fingerprint,
    kind: sample.kind,
    split: sample.provenance.split,
    familyId: sample.provenance.familyId,
    declaredPairCount: sample.srj.differentialPairs?.length ?? 0,
    durationMs: 0,
    timedOut: false,
    exitCode: 0,
    outputAvailable: false,
    outputSource: "none",
    metricsStatus: "unavailable",
    metrics: null,
    logicalPaths: [],
    error: null,
  }
  let solver: CheckpointSolver | null = null
  let output: SimpleRouteJson | null = null
  let nextCheckpoint = 0
  // This observer never changes solver state. A prior checkpoint survives later failure.
  const checkpoint = (): void => {
    if (!solver) return
    try {
      let candidate: SimpleRouteJson | null = null
      if (solver.solved && solver.getOutputSimpleRouteJson) {
        candidate = solver.getOutputSimpleRouteJson()
        result.outputSource = "final"
      } else if (
        solver.highDensityStitchSolver?.solved &&
        solver.getPrePowerTraceOutputSimplifiedPcbTraces
      ) {
        candidate = {
          ...sample.srj,
          traces: solver.getPrePowerTraceOutputSimplifiedPcbTraces(),
        }
        result.outputSource = "pre-power-checkpoint"
      }
      if (!candidate || !candidate.traces?.length) return
      candidate = {
        ...candidate,
        traces: combinePreloadedAndRoutedTraces(
          sample.srj.traces ?? [],
          candidate.traces,
        ),
      }
      writeJson(join(directory, "output.json"), candidate)
      output = candidate
      result.outputAvailable = true
      writeJson(join(directory, "result.json"), result)
    } catch (error) {
      writeFileSync(join(directory, "checkpoint-error.txt"), String(error))
    }
  }
  try {
    solver = createSolverForTask({
      datasetName: "differential-pair-corpus",
      solverName: config.solver,
      scenarioName: sample.sampleId,
      sampleNumber: 0,
      scenario: { ...sample.srj, effort: config.effort } as SimpleRouteJson,
    })
    if (!solver.step)
      throw new Error("Benchmark requires a step-capable solver")
    while (!solver.solved && !solver.failed) {
      solver.step()
      if (
        (!output && solver.highDensityStitchSolver?.solved) ||
        performance.now() >= nextCheckpoint
      ) {
        checkpoint()
        nextCheckpoint = performance.now() + 250
      }
    }
  } catch (error) {
    result.error = String(error)
  }
  checkpoint()
  result.durationMs = performance.now() - started
  result.error ??= solver?.error ?? null
  writeJson(join(directory, "result.json"), result)
  try {
    result.metrics = evaluatePairOutput({
      inputSrj: sample.srj,
      outputSrj: output,
      srjWithPointPairs: solver?.srjWithPointPairs,
      solved: solver?.solved === true,
      failed: solver?.failed === true || result.error !== null,
      error: result.error,
      runtimeMs: result.durationMs,
    })
    result.logicalPaths = measureLogicalPaths(sample, result.metrics)
    result.metricsStatus = "measured"
  } catch (error) {
    result.error =
      `${result.error ?? ""} Metrics error: ${String(error)}`.trim()
  }
  writeJson(join(directory, "result.json"), result)
}

if (import.meta.main) await runWorker()
