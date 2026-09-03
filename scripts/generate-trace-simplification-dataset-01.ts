#!/usr/bin/env bun

import {
  appendFile,
  mkdir,
  open,
  readFile,
  rename,
  stat,
  writeFile,
} from "node:fs/promises"
import { createReadStream } from "node:fs"
import { createInterface } from "node:readline"
import path from "node:path"
import {
  AutoroutingPipelineSolver11_Simplification,
  AutoroutingPipelineSolver7_MultiGraph,
} from "../lib"
import { convertPipeline7HdRoutesToSimplifiedPcbTraces } from "../lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import type { SimpleRouteJson } from "../lib/types"
import { loadScenarios } from "./benchmark/scenarios"

const SCHEMA_VERSION = 1
const DATASET_NAME = "dataset01"
const SIMPLIFICATION_PHASE = "traceSimplificationSolver"
const DEFAULT_OUTPUT = "datasets/trace-simplification-dataset-01.jsonl"

type DatasetRecord = {
  schemaVersion: typeof SCHEMA_VERSION
  problemId: string
  source: {
    dataset: typeof DATASET_NAME
    scenarioName: string
    sampleNumber: number
    autorouterGitRevision: string
    datasetPackageSpecifier: string
    effort: number
    router: "AutoroutingPipelineSolver7_MultiGraph"
    simplifier: "AutoroutingPipelineSolver11_Simplification"
    simplificationOptions: {
      iterations: number
      enableCrossingViaReduction: boolean
    }
  }
  input: SimpleRouteJson
  output: SimpleRouteJson
}

type GeneratorOptions = {
  outputPath: string
  start: number
  limit?: number
  effort: number
}

type ExpectedProvenance = {
  autorouterGitRevision: string
  datasetPackageSpecifier: string
  effort: number
}

type Checkpoint = {
  schemaVersion: typeof SCHEMA_VERSION
  dataset: typeof DATASET_NAME
  status: "running" | "complete" | "complete_with_errors" | "interrupted"
  totalProblems: number
  selectedProblems: number
  completedProblemIds: string[]
  failedProblemIds: string[]
  lastCompletedProblemId?: string
  lastAttemptedProblemId?: string
  updatedAt: string
}

const parsePositiveInteger = (raw: string, flag: string): number => {
  const value = Number.parseInt(raw, 10)
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${flag} must be a positive integer`)
  }
  return value
}

const parsePositiveNumber = (raw: string, flag: string): number => {
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${flag} must be a positive number`)
  }
  return value
}

const parseArgs = (args: string[]): GeneratorOptions => {
  const options: GeneratorOptions = {
    outputPath: path.resolve(DEFAULT_OUTPUT),
    start: 1,
    effort: 1,
  }

  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    if (arg === "--output") {
      options.outputPath = path.resolve(
        args[++index] ?? (() => { throw new Error("--output requires a path") })(),
      )
    } else if (arg === "--start") {
      options.start = parsePositiveInteger(
        args[++index] ?? (() => { throw new Error("--start requires a value") })(),
        "--start",
      )
    } else if (arg === "--limit") {
      options.limit = parsePositiveInteger(
        args[++index] ?? (() => { throw new Error("--limit requires a value") })(),
        "--limit",
      )
    } else if (arg === "--effort") {
      options.effort = parsePositiveNumber(
        args[++index] ?? (() => { throw new Error("--effort requires a value") })(),
        "--effort",
      )
    } else if (arg === "--help" || arg === "-h") {
      console.log(
        [
          "Generate Dataset 01 TraceSimplificationSolver JSON-in/JSON-out pairs.",
          "",
          `Usage: bun ${path.basename(import.meta.path)} [options]`,
          "",
          `  --output PATH  JSONL destination (default: ${DEFAULT_OUTPUT})`,
          "  --start N      First 1-based Dataset 01 sample (default: 1)",
          "  --limit N      Process at most N samples",
          "  --effort N     Pipeline effort (default: 1)",
          "",
          "Existing valid records are always resumed by problemId. A partial final",
          "line is truncated automatically. Upstream failures are logged separately",
          "and retried on the next invocation.",
        ].join("\n"),
      )
      process.exit(0)
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  return options
}

const truncateIncompleteFinalLine = async (
  outputPath: string,
): Promise<number> => {
  let fileSize = 0
  try {
    fileSize = (await stat(outputPath)).size
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0
    throw error
  }
  if (fileSize === 0) return 0

  const file = await open(outputPath, "r+")
  try {
    const lastByte = new Uint8Array(1)
    await file.read(lastByte, 0, 1, fileSize - 1)
    if (lastByte[0] === 0x0a) return 0

    const chunkSize = 64 * 1024
    let cursor = fileSize
    while (cursor > 0) {
      const start = Math.max(0, cursor - chunkSize)
      const chunk = new Uint8Array(cursor - start)
      await file.read(chunk, 0, chunk.length, start)
      const newlineIndex = chunk.lastIndexOf(0x0a)
      if (newlineIndex >= 0) {
        const validSize = start + newlineIndex + 1
        await file.truncate(validSize)
        return fileSize - validSize
      }
      cursor = start
    }

    await file.truncate(0)
    return fileSize
  } finally {
    await file.close()
  }
}

export const recoverCompletedProblemIds = async (
  outputPath: string,
  expectedProvenance?: ExpectedProvenance,
): Promise<Set<string>> => {
  const truncatedBytes = await truncateIncompleteFinalLine(outputPath)
  if (truncatedBytes > 0) {
    console.log(`Recovered ${outputPath} by truncating ${truncatedBytes} bytes`)
  }

  const completed = new Set<string>()
  try {
    await stat(outputPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return completed
    throw error
  }

  const lines = createInterface({
    input: createReadStream(outputPath),
    crlfDelay: Number.POSITIVE_INFINITY,
  })
  let lineNumber = 0
  for await (const line of lines) {
    lineNumber++
    if (!line.trim()) continue
    let record: Partial<DatasetRecord>
    try {
      record = JSON.parse(line)
    } catch (error) {
      throw new Error(`Invalid JSON at ${outputPath}:${lineNumber}: ${error}`)
    }
    if (
      record.schemaVersion !== SCHEMA_VERSION ||
      typeof record.problemId !== "string" ||
      !record.input ||
      !record.output
    ) {
      throw new Error(`Invalid dataset record at ${outputPath}:${lineNumber}`)
    }
    if (
      expectedProvenance &&
      (record.source?.autorouterGitRevision !==
        expectedProvenance.autorouterGitRevision ||
        record.source?.datasetPackageSpecifier !==
          expectedProvenance.datasetPackageSpecifier ||
        record.source?.effort !== expectedProvenance.effort ||
        record.source?.router !== "AutoroutingPipelineSolver7_MultiGraph" ||
        record.source?.simplifier !==
          "AutoroutingPipelineSolver11_Simplification" ||
        record.source?.simplificationOptions?.iterations !== 2 ||
        record.source?.simplificationOptions?.enableCrossingViaReduction !==
          true)
    ) {
      throw new Error(
        `Incompatible provenance at ${outputPath}:${lineNumber}; use a new output path`,
      )
    }
    if (completed.has(record.problemId)) {
      throw new Error(`Duplicate problemId ${record.problemId} at line ${lineNumber}`)
    }
    completed.add(record.problemId)
  }
  return completed
}

const writeCheckpoint = async (
  checkpointPath: string,
  checkpoint: Checkpoint,
): Promise<void> => {
  const temporaryPath = `${checkpointPath}.tmp`
  await writeFile(temporaryPath, `${JSON.stringify(checkpoint, null, 2)}\n`)
  await rename(temporaryPath, checkpointPath)
}

const appendJsonLine = async (outputPath: string, value: unknown): Promise<void> => {
  const file = await open(outputPath, "a")
  try {
    await file.write(`${JSON.stringify(value)}\n`)
    await file.sync()
  } finally {
    await file.close()
  }
}

const runUntilPhase = (
  pipeline: AutoroutingPipelineSolver7_MultiGraph,
  phase: string,
): void => {
  while (
    !pipeline.failed &&
    !pipeline.solved &&
    pipeline.getCurrentPhase() !== phase
  ) {
    pipeline.step()
  }
  if (pipeline.failed) {
    throw new Error(pipeline.error ?? `Pipeline failed before ${phase}`)
  }
  if (pipeline.solved || pipeline.getCurrentPhase() !== phase) {
    throw new Error(`Pipeline ended before reaching ${phase}`)
  }
}

const createRecord = (
  scenarioName: string,
  sampleNumber: number,
  srj: SimpleRouteJson,
  effort: number,
  autorouterGitRevision: string,
  datasetPackageSpecifier: string,
): DatasetRecord => {
  const pipeline = new AutoroutingPipelineSolver7_MultiGraph(
    structuredClone(srj),
    { cacheProvider: null, effort },
  )
  runUntilPhase(pipeline, SIMPLIFICATION_PHASE)

  const simplificationOptions = {
    iterations: 2,
    enableCrossingViaReduction: true,
  }
  const input: SimpleRouteJson = {
    ...structuredClone(pipeline.originalSrj),
    traces: convertPipeline7HdRoutesToSimplifiedPcbTraces({
      connections: pipeline.netToPointPairsSolver?.newConnections ?? [],
      originalConnections: pipeline.originalSrj.connections,
      hdRoutes: pipeline.highDensityStitchSolver!.mergedHdRoutes,
      layerCount: pipeline.srj.layerCount,
      obstacles: pipeline.srj.obstacles,
      defaultViaHoleDiameter: pipeline.viaHoleDiameter,
      connMap: pipeline.connMap,
    }),
  }
  const simplifier = new AutoroutingPipelineSolver11_Simplification(
    structuredClone(input),
    simplificationOptions,
  )
  simplifier.solve()
  if (simplifier.failed) {
    throw new Error(simplifier.error ?? "Pipeline 11 simplification failed")
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    problemId: `${DATASET_NAME}:${scenarioName}`,
    source: {
      dataset: DATASET_NAME,
      scenarioName,
      sampleNumber,
      autorouterGitRevision,
      datasetPackageSpecifier,
      effort,
      router: "AutoroutingPipelineSolver7_MultiGraph",
      simplifier: "AutoroutingPipelineSolver11_Simplification",
      simplificationOptions,
    },
    input,
    output: simplifier.getOutputSimpleRouteJson(),
  }
}

const getSourceVersions = async (): Promise<{
  autorouterGitRevision: string
  datasetPackageSpecifier: string
}> => {
  const packageJson = JSON.parse(
    await readFile(path.resolve("package.json"), "utf8"),
  ) as { devDependencies: Record<string, string> }
  const gitProcess = Bun.spawn(["git", "rev-parse", "HEAD"], {
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "inherit",
  })
  const autorouterGitRevision = (await new Response(gitProcess.stdout).text()).trim()
  if ((await gitProcess.exited) !== 0 || !autorouterGitRevision) {
    throw new Error("Unable to determine autorouter git revision")
  }
  return {
    autorouterGitRevision,
    datasetPackageSpecifier:
      packageJson.devDependencies["@tscircuit/autorouting-dataset-01"],
  }
}

const main = async (): Promise<void> => {
  const options = parseArgs(process.argv.slice(2))
  const checkpointPath = `${options.outputPath}.checkpoint.json`
  const errorPath = `${options.outputPath}.errors.jsonl`
  await mkdir(path.dirname(options.outputPath), { recursive: true })

  const versions = await getSourceVersions()
  const completed = await recoverCompletedProblemIds(options.outputPath, {
    ...versions,
    effort: options.effort,
  })
  const scenarios = await loadScenarios(DATASET_NAME)
  const selected = scenarios.slice(
    options.start - 1,
    options.limit === undefined
      ? undefined
      : options.start - 1 + options.limit,
  )
  const failed = new Set<string>()
  let lastCompletedProblemId = [...completed].at(-1)
  let lastAttemptedProblemId: string | undefined
  let interrupted = false
  process.on("SIGINT", () => { interrupted = true })
  process.on("SIGTERM", () => { interrupted = true })

  const checkpoint = async (
    status: Checkpoint["status"],
  ): Promise<void> => writeCheckpoint(checkpointPath, {
    schemaVersion: SCHEMA_VERSION,
    dataset: DATASET_NAME,
    status,
    totalProblems: scenarios.length,
    selectedProblems: selected.length,
    completedProblemIds: [...completed].sort(),
    failedProblemIds: [...failed].sort(),
    lastCompletedProblemId,
    lastAttemptedProblemId,
    updatedAt: new Date().toISOString(),
  })

  await checkpoint("running")
  console.log(
    `Dataset 01: ${completed.size} existing, ${selected.length} selected, ${scenarios.length} total`,
  )

  for (const [selectedIndex, [scenarioName, srj]] of selected.entries()) {
    if (interrupted) break
    const sampleNumber = options.start + selectedIndex
    const problemId = `${DATASET_NAME}:${scenarioName}`
    if (completed.has(problemId)) {
      console.log(`[${sampleNumber}/${scenarios.length}] skip ${problemId}`)
      continue
    }

    lastAttemptedProblemId = problemId
    console.log(`[${sampleNumber}/${scenarios.length}] solve ${problemId}`)
    try {
      const record = createRecord(
        scenarioName,
        sampleNumber,
        srj,
        options.effort,
        versions.autorouterGitRevision,
        versions.datasetPackageSpecifier,
      )
      await appendJsonLine(options.outputPath, record)
      completed.add(problemId)
      lastCompletedProblemId = problemId
      console.log(
        `[${sampleNumber}/${scenarios.length}] wrote ${problemId} (${record.input.traces?.length ?? 0} traces)`,
      )
    } catch (error) {
      failed.add(problemId)
      await appendFile(
        errorPath,
        `${JSON.stringify({
          problemId,
          sampleNumber,
          error: error instanceof Error ? error.stack ?? error.message : String(error),
          occurredAt: new Date().toISOString(),
        })}\n`,
      )
      console.error(`[${sampleNumber}/${scenarios.length}] failed ${problemId}: ${error}`)
    }
    await checkpoint("running")
  }

  const status: Checkpoint["status"] = interrupted
    ? "interrupted"
    : failed.size > 0
      ? "complete_with_errors"
      : "complete"
  await checkpoint(status)
  console.log(
    `${status}: ${completed.size} records in ${options.outputPath}; ${failed.size} failures`,
  )
  if (interrupted || failed.size > 0) process.exitCode = 1
}

if (import.meta.main) {
  await main()
}
