#!/usr/bin/env bun

import { mkdir, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import type { TinyHypergraphMemoryCheckpoint } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import { TinyHypergraphPortPointPathingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import type { HgPortPointPathingSolverParams } from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver/types"
import { prepareParamsForDownload } from "lib/testing/utils/prepareParamsForDownload"
import { loadScenarioBySampleNumber } from "./benchmark/scenarios"

type MemoryUsageSnapshot = ReturnType<typeof process.memoryUsage>

type ProfileCheckpoint = {
  label: string
  elapsedMs: number
  memoryBeforeGc: MemoryUsageSnapshot
  memoryAfterGc: MemoryUsageSnapshot
  deltaFromPreviousAfterGc: Record<keyof MemoryUsageSnapshot, number>
  stats?: Record<string, number | string | boolean | null | undefined>
}

type SolverOutputSummary = {
  nodeCount: number
  inputNodeCount: number
  routedPortPointCount: number
  inputPortPointCount: number
}

export type PortPointMemoryProfileRun = {
  runLabel: string
  durationMs: number
  solved: boolean
  failed: boolean
  error: string | null
  currentStage: string | null
  checkpoints: ProfileCheckpoint[]
  stats: Record<string, unknown>
  outputSummary: SolverOutputSummary
}

const DEFAULT_RUNS = 3
const DEFAULT_SAMPLE_NUMBER = 1
const OUTPUT_ROOT = path.join(
  process.cwd(),
  "ai-artifacts",
  "memory-analysis",
  "pipeline7-srj18-sample001",
  "deep-portpoint-tiny",
)

const formatBytes = (value: number) => `${(value / 1024 / 1024).toFixed(1)} MiB`

const diffMemoryUsage = (
  current: MemoryUsageSnapshot,
  previous: MemoryUsageSnapshot | null,
): Record<keyof MemoryUsageSnapshot, number> => ({
  rss: current.rss - (previous?.rss ?? 0),
  heapTotal: current.heapTotal - (previous?.heapTotal ?? 0),
  heapUsed: current.heapUsed - (previous?.heapUsed ?? 0),
  external: current.external - (previous?.external ?? 0),
  arrayBuffers: current.arrayBuffers - (previous?.arrayBuffers ?? 0),
})

const captureMemory = (
  previousAfterGc: MemoryUsageSnapshot | null,
  label: string,
  startTime: number,
  stats?: Record<string, number | string | boolean | null | undefined>,
): ProfileCheckpoint => {
  const memoryBeforeGc = process.memoryUsage()
  Bun.gc(true)
  const memoryAfterGc = process.memoryUsage()

  return {
    label,
    elapsedMs: performance.now() - startTime,
    memoryBeforeGc,
    memoryAfterGc,
    deltaFromPreviousAfterGc: diffMemoryUsage(memoryAfterGc, previousAfterGc),
    stats,
  }
}

const getPortPointStageConstructorParams = async (
  sampleNumber = DEFAULT_SAMPLE_NUMBER,
) => {
  const sample = await loadScenarioBySampleNumber("srj18", sampleNumber)
  const pipeline = new AutoroutingPipelineSolver7_MultiGraph(
    structuredClone(sample.scenario),
  )

  while (pipeline.getCurrentPhase() !== "portPointPathingSolver") {
    pipeline.step()
  }

  const stepDef = pipeline.pipelineDef.find(
    (step) => step.solverName === "portPointPathingSolver",
  ) as
    | {
        getConstructorParams: (
          solver: AutoroutingPipelineSolver7_MultiGraph,
        ) => [HgPortPointPathingSolverParams]
      }
    | undefined

  if (!stepDef) {
    throw new Error("Unable to locate portPointPathingSolver step definition")
  }

  const [params] = stepDef.getConstructorParams(pipeline)
  return {
    sampleName: sample.scenarioName,
    params,
  }
}

export const extractPipeline7PortPointPathingParams = async (
  sampleNumber = DEFAULT_SAMPLE_NUMBER,
) => getPortPointStageConstructorParams(sampleNumber)

export const runTinyHypergraphPortPointProfile = async (opts: {
  params: HgPortPointPathingSolverParams
  runLabel: string
  outputDir?: string
}) => {
  const checkpoints: ProfileCheckpoint[] = []
  const startTime = performance.now()
  let previousAfterGc: MemoryUsageSnapshot | null = null

  const addCheckpoint = (
    label: string,
    stats?: Record<string, number | string | boolean | null | undefined>,
  ) => {
    const checkpoint = captureMemory(previousAfterGc, label, startTime, stats)
    previousAfterGc = checkpoint.memoryAfterGc
    checkpoints.push(checkpoint)
  }

  addCheckpoint("run:start", {
    pid: process.pid,
    cpuCount: os.cpus().length,
  })

  const instrumentedParams = structuredClone(opts.params) as HgPortPointPathingSolverParams & {
    __memoryInstrumentation?: (checkpoint: TinyHypergraphMemoryCheckpoint) => void
  }
  instrumentedParams.__memoryInstrumentation = (checkpoint) => {
    addCheckpoint(`solver:${checkpoint.label}`, checkpoint.stats)
  }

  const solver = new TinyHypergraphPortPointPathingSolver(instrumentedParams)
  addCheckpoint("solver:constructed", {
    maxIterations: solver.MAX_ITERATIONS,
  })

  let lastStage = String((solver.stats.currentStage as string | undefined) ?? "unstarted")
  addCheckpoint(`solver:stage:${lastStage}`)

  while (!solver.solved && !solver.failed) {
    solver.step()
    const currentStage = String(
      (solver.stats.currentStage as string | undefined) ??
        (solver.solved ? "solved" : "unknown"),
    )
    if (currentStage !== lastStage) {
      addCheckpoint(`solver:stage:${currentStage}`, {
        iterations: solver.iterations,
      })
      lastStage = currentStage
    }
  }

  addCheckpoint("solver:after-solve", {
    solved: solver.solved,
    failed: solver.failed,
    iterations: solver.iterations,
  })

  const output = solver.getOutput()
  addCheckpoint("solver:after-getOutput", {
    nodeCount: output.nodesWithPortPoints.length,
    inputNodeCount: output.inputNodeWithPortPoints.length,
  })

  const outputSummary: SolverOutputSummary = {
    nodeCount: output.nodesWithPortPoints.length,
    inputNodeCount: output.inputNodeWithPortPoints.length,
    routedPortPointCount: output.nodesWithPortPoints.reduce(
      (sum, node) => sum + node.portPoints.length,
      0,
    ),
    inputPortPointCount: output.inputNodeWithPortPoints.reduce(
      (sum, node) => sum + node.portPoints.length,
      0,
    ),
  }

  const result: PortPointMemoryProfileRun = {
    runLabel: opts.runLabel,
    durationMs: performance.now() - startTime,
    solved: solver.solved,
    failed: solver.failed,
    error: solver.error ?? null,
    currentStage:
      typeof solver.stats.currentStage === "string"
        ? solver.stats.currentStage
        : null,
    checkpoints,
    stats: solver.stats,
    outputSummary,
  }

  if (opts.outputDir) {
    await mkdir(opts.outputDir, { recursive: true })
    await writeFile(
      path.join(opts.outputDir, "checkpoints.json"),
      `${JSON.stringify(result, null, 2)}\n`,
    )
  }

  return result
}

const parsePositiveIntegerArg = (flag: string, fallback: number) => {
  const argIndex = process.argv.indexOf(flag)
  if (argIndex === -1) {
    return fallback
  }

  const rawValue = process.argv[argIndex + 1]
  const parsed = Number.parseInt(rawValue ?? "", 10)
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(`${flag} must be a positive integer`)
  }

  return parsed
}

const parseStringArg = (flag: string) => {
  const argIndex = process.argv.indexOf(flag)
  return argIndex === -1 ? undefined : process.argv[argIndex + 1]
}

const summarizeRuns = (runs: PortPointMemoryProfileRun[]) => {
  const stageTotals = new Map<string, number[]>()

  for (const run of runs) {
    for (const checkpoint of run.checkpoints) {
      const values = stageTotals.get(checkpoint.label) ?? []
      values.push(checkpoint.memoryAfterGc.heapUsed)
      stageTotals.set(checkpoint.label, values)
    }
  }

  const averageHeapUsedByCheckpoint = [...stageTotals.entries()]
    .map(([label, values]) => ({
      label,
      avgHeapUsedBytes:
        values.reduce((sum, value) => sum + value, 0) / values.length,
    }))
    .sort((left, right) => right.avgHeapUsedBytes - left.avgHeapUsedBytes)

  const largestHeapJumpByRun = runs.map((run) => {
    const largestCheckpoint = run.checkpoints
      .slice(1)
      .reduce<ProfileCheckpoint | null>((largest, checkpoint) => {
        if (
          !largest ||
          checkpoint.deltaFromPreviousAfterGc.heapUsed >
            largest.deltaFromPreviousAfterGc.heapUsed
        ) {
          return checkpoint
        }
        return largest
      }, null)

    return {
      runLabel: run.runLabel,
      label: largestCheckpoint?.label ?? "n/a",
      heapJumpBytes:
        largestCheckpoint?.deltaFromPreviousAfterGc.heapUsed ?? 0,
    }
  })

  return {
    runCount: runs.length,
    averageDurationMs:
      runs.reduce((sum, run) => sum + run.durationMs, 0) / runs.length,
    averageHeapUsedByCheckpoint,
    largestHeapJumpByRun,
  }
}

const createMarkdownSummary = (runs: PortPointMemoryProfileRun[]) => {
  const summary = summarizeRuns(runs)
  const hottestCheckpoints = summary.averageHeapUsedByCheckpoint.slice(0, 8)
  const getCheckpointValues = (label: string) =>
    runs
      .map((run) => run.checkpoints.find((checkpoint) => checkpoint.label === label))
      .filter((checkpoint): checkpoint is ProfileCheckpoint => Boolean(checkpoint))
  const avgMiB = (values: number[]) =>
    values.reduce((sum, value) => sum + value, 0) / values.length / 1024 / 1024
  const duplicatePrepass = getCheckpointValues(
    "solver:constructor:after-duplicateCongestedPortPrepass",
  )
  const solveGraph = getCheckpointValues("solver:stage:solveGraph")
  const optimizeSection = getCheckpointValues("solver:stage:optimizeSection")
  const afterSolve = getCheckpointValues("solver:after-solve")
  const duplicateJumpMiB = avgMiB(
    duplicatePrepass.map(
      (checkpoint) => checkpoint.deltaFromPreviousAfterGc.heapUsed,
    ),
  )
  const solveGraphReleaseMiB = avgMiB(
    solveGraph.map((checkpoint) => checkpoint.deltaFromPreviousAfterGc.heapUsed),
  )
  const optimizeSectionJumpMiB = avgMiB(
    optimizeSection.map(
      (checkpoint) => checkpoint.deltaFromPreviousAfterGc.heapUsed,
    ),
  )
  const finalRetainedHeapMiB = avgMiB(
    afterSolve.map((checkpoint) => checkpoint.memoryAfterGc.heapUsed),
  )
  const finalRetainedRssMiB = avgMiB(
    afterSolve.map((checkpoint) => checkpoint.memoryAfterGc.rss),
  )
  const averageDuplicatePortCount =
    runs.reduce(
      (sum, run) => sum + Number(run.stats.duplicateCongestedPortCount ?? 0),
      0,
    ) / runs.length
  const averageDuplicatePortSourceCount =
    runs.reduce(
      (sum, run) =>
        sum + Number(run.stats.duplicateCongestedPortSourceCount ?? 0),
      0,
    ) / runs.length

  return [
    "# Deep portPoint tiny-hypergraph memory findings",
    "",
    `- Runs: ${summary.runCount}.`,
    `- Average isolated solver duration: ${summary.averageDurationMs.toFixed(1)}ms.`,
    `- Duplicate congested-port prepass is the dominant retained-heap jump: about +${duplicateJumpMiB.toFixed(1)} MiB after GC.`,
    `- First \`solveGraph\` step releases about ${solveGraphReleaseMiB.toFixed(1)} MiB of JS heap on average, which means much of the spike is constructor-era object retention rather than long-lived solver state.`,
    `- \`optimizeSection\` adds only about +${optimizeSectionJumpMiB.toFixed(1)} MiB and finishes in about ${(
      runs.reduce(
        (sum, run) =>
          sum + Number((run.stats.stageStats as any)?.optimizeSection?.timeSpent ?? 0),
        0,
      ) / runs.length
    ).toFixed(3)}ms.`,
    `- Final retained memory after solve stays near ${finalRetainedHeapMiB.toFixed(1)} MiB heap / ${finalRetainedRssMiB.toFixed(1)} MiB RSS.`,
    `- Duplicate prepass consistently duplicates about ${averageDuplicatePortCount.toFixed(0)} ports across ${averageDuplicatePortSourceCount.toFixed(0)} source ports.`,
    "- Highest average retained-heap checkpoints:",
    ...hottestCheckpoints.map(
      (checkpoint) =>
        `- \`${checkpoint.label}\`: ${formatBytes(checkpoint.avgHeapUsedBytes)}.`,
    ),
    "- Largest retained-heap jumps per run:",
    ...summary.largestHeapJumpByRun.map(
      (jump) =>
        `- \`${jump.runLabel}\`: \`${jump.label}\` (${formatBytes(jump.heapJumpBytes)}).`,
    ),
    "",
  ].join("\n")
}

const runSingleProfile = async (opts: {
  sampleNumber: number
  outputRoot: string
  runLabel: string
}) => {
  const { sampleName, params } = await extractPipeline7PortPointPathingParams(
    opts.sampleNumber,
  )
  await mkdir(opts.outputRoot, { recursive: true })
  await writeFile(
    path.join(opts.outputRoot, "portPointPathingSolver_input.json"),
    `${JSON.stringify(prepareParamsForDownload([params]), null, 2)}\n`,
  )

  const runOutputDir = path.join(opts.outputRoot, opts.runLabel)
  console.log(`[deep-portpoint] starting ${opts.runLabel}`)
  const runResult = await runTinyHypergraphPortPointProfile({
    params,
    runLabel: opts.runLabel,
    outputDir: runOutputDir,
  })
  await writeFile(
    path.join(runOutputDir, "single-run.json"),
    `${JSON.stringify({ sampleName, run: runResult }, null, 2)}\n`,
  )
  console.log(
    `[deep-portpoint] finished ${opts.runLabel} solved=${runResult.solved} failed=${runResult.failed} durationMs=${runResult.durationMs.toFixed(1)}`,
  )
}

const main = async () => {
  const runs = parsePositiveIntegerArg("--runs", DEFAULT_RUNS)
  const sampleNumber = parsePositiveIntegerArg("--sample", DEFAULT_SAMPLE_NUMBER)
  const outputRoot = parseStringArg("--output-root") ?? OUTPUT_ROOT
  const childRunLabel = parseStringArg("--child-run-label")

  if (childRunLabel) {
    await runSingleProfile({
      sampleNumber,
      outputRoot,
      runLabel: childRunLabel,
    })
    return
  }

  const profileRuns: PortPointMemoryProfileRun[] = []
  let sampleName = ""

  for (let runIndex = 0; runIndex < runs; runIndex += 1) {
    const runLabel = `run-${String(runIndex + 1).padStart(3, "0")}`
    const child = Bun.spawnSync(
      [
        "bun",
        "run",
        import.meta.path,
        "--runs",
        "1",
        "--sample",
        String(sampleNumber),
        "--output-root",
        outputRoot,
        "--child-run-label",
        runLabel,
      ],
      {
        cwd: process.cwd(),
        stdout: "inherit",
        stderr: "inherit",
      },
    )

    if (child.exitCode !== 0) {
      throw new Error(`Child run ${runLabel} failed with exit code ${child.exitCode}`)
    }

    const singleRun = await Bun.file(
      path.join(outputRoot, runLabel, "single-run.json"),
    ).json()
    sampleName = singleRun.sampleName
    profileRuns.push(singleRun.run)
  }

  const rollup = summarizeRuns(profileRuns)
  await writeFile(
    path.join(outputRoot, "rollup.json"),
    `${JSON.stringify(
      {
        sampleName,
        runs: profileRuns,
        rollup,
      },
      null,
      2,
    )}\n`,
  )
  await writeFile(
    path.join(outputRoot, "latest-findings.md"),
    `${createMarkdownSummary(profileRuns)}\n`,
  )
}

if (import.meta.main) {
  await main()
}
