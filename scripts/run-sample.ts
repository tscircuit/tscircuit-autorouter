#!/usr/bin/env bun

import { appendFile, mkdir, readdir, readFile } from "node:fs/promises"
import path from "node:path"
import {
  AutoroutingPipeline1_OriginalUnravel,
  AutoroutingPipelineSolver2_PortPointPathing,
  AutoroutingPipelineSolver3_HgPortPointPathing,
  AutoroutingPipelineSolver4,
} from "../lib"
import { RELAXED_DRC_OPTIONS } from "../lib/testing/drcPresets"
import { getDrcErrors } from "../lib/testing/getDrcErrors"
import {
  PipelineStageDebugRunner,
  type StageDebuggablePipelineSolver,
} from "../lib/testing/PipelineStageDebugRunner"
import { convertToCircuitJson } from "../lib/testing/utils/convertToCircuitJson"
import type { SimpleRouteJson } from "../lib/types/srj-types"
import {
  DATASET_NAMES,
  type DatasetName,
  isDatasetName,
  loadScenarioBySampleNumber,
  toSimpleRouteJson,
} from "./benchmark/scenarios"

type PipelineId = 1 | 2 | 3 | 4

type SolverOptions = {
  effort?: number
}

type PipelineRunSolver = StageDebuggablePipelineSolver & {
  srjWithPointPairs?: SimpleRouteJson
  getOutputSimplifiedPcbTraces?: () => unknown[]
}

type PipelineSolverConstructor = new (
  srj: SimpleRouteJson,
  opts?: any,
) => PipelineRunSolver

type RunSampleOptions = {
  pipeline: PipelineId
  srjPath?: string
  sample?: number
  dataset: DatasetName
  outDir?: string
  pngSize: number
  effort?: number
}

const PIPELINE_SOLVERS: Record<
  PipelineId,
  {
    solverName: string
    SolverConstructor: PipelineSolverConstructor
  }
> = {
  1: {
    solverName: "AutoroutingPipeline1_OriginalUnravel",
    SolverConstructor: AutoroutingPipeline1_OriginalUnravel,
  },
  2: {
    solverName: "AutoroutingPipelineSolver2_PortPointPathing",
    SolverConstructor: AutoroutingPipelineSolver2_PortPointPathing,
  },
  3: {
    solverName: "AutoroutingPipelineSolver3_HgPortPointPathing",
    SolverConstructor: AutoroutingPipelineSolver3_HgPortPointPathing,
  },
  4: {
    solverName: "AutoroutingPipelineSolver4",
    SolverConstructor: AutoroutingPipelineSolver4,
  },
}

const printHelp = () => {
  console.log(
    [
      "Usage:",
      "  ./run-sample.sh [--pipeline 4] --srj-path path/to/srj.json",
      "  ./run-sample.sh [--pipeline 4] --sample 1 [--dataset dataset01]",
      "",
      "Options:",
      "  --pipeline N     Pipeline to run (1-4, defaults to 4)",
      "  --srj-path PATH  Path to a SimpleRouteJson file",
      "  --sample N       1-based sample index from the benchmark dataset order",
      `  --dataset NAME   Dataset used with --sample (${DATASET_NAMES.join(", ")}, defaults to dataset01)`,
      "  --out-dir PATH   Override the output directory (default: ./tmp/run-N)",
      "  --png-size N     Square PNG size in pixels, min 1024 (default: 1536)",
      "  --effort N       Override solver effort",
      "  -h, --help       Show this help",
      "",
      "Examples:",
      "  ./run-sample.sh --sample 1",
      "  ./run-sample.sh --pipeline 4 --sample 3 --dataset dataset01",
      "  ./run-sample.sh --srj-path fixtures/legacy/assets/e2e3.json",
    ].join("\n"),
  )
}

const parsePositiveInt = (rawValue: string, flagName: string) => {
  const value = Number.parseInt(rawValue, 10)
  if (!Number.isFinite(value) || value < 1) {
    throw new Error(`${flagName} must be a positive integer`)
  }
  return value
}

const toRelativePath = (targetPath: string) => {
  const relativePath = path.relative(process.cwd(), targetPath)
  if (relativePath === "") {
    return "."
  }
  return relativePath.startsWith(".") ? relativePath : `./${relativePath}`
}

const formatPoint = (point: { x: number; y: number } | null) => {
  if (!point) {
    return "n/a"
  }
  return `(${point.x.toFixed(3)}, ${point.y.toFixed(3)})`
}

const getApproximateErrorLocation = (
  error: Record<string, unknown>,
  circuitJson: Array<Record<string, unknown>>,
) => {
  if (
    "center" in error &&
    error.center &&
    typeof error.center === "object" &&
    "x" in error.center &&
    "y" in error.center
  ) {
    const center = error.center as { x: number; y: number }
    return { x: center.x, y: center.y }
  }

  if (typeof error.pcb_trace_id === "string") {
    const trace = circuitJson.find(
      (element) =>
        element.type === "pcb_trace" &&
        element.pcb_trace_id === error.pcb_trace_id,
    )
    const route = Array.isArray(trace?.route) ? trace.route : []
    const points = route.flatMap((segment) => {
      if (
        segment &&
        typeof segment === "object" &&
        typeof segment.x === "number" &&
        typeof segment.y === "number"
      ) {
        return [{ x: segment.x, y: segment.y }]
      }
      return []
    })

    if (points.length > 0) {
      const sum = points.reduce(
        (acc, point) => ({
          x: acc.x + point.x,
          y: acc.y + point.y,
        }),
        { x: 0, y: 0 },
      )
      return {
        x: sum.x / points.length,
        y: sum.y / points.length,
      }
    }
  }

  const pcbPortIds = Array.isArray(error.pcb_port_ids)
    ? error.pcb_port_ids.filter(
        (value): value is string => typeof value === "string",
      )
    : []
  if (pcbPortIds.length > 0) {
    const ports = circuitJson.filter(
      (element) =>
        element.type === "pcb_port" &&
        typeof element.pcb_port_id === "string" &&
        pcbPortIds.includes(element.pcb_port_id) &&
        typeof element.x === "number" &&
        typeof element.y === "number",
    ) as Array<Record<string, number>>

    if (ports.length > 0) {
      const sum = ports.reduce(
        (acc, port) => ({
          x: acc.x + port.x,
          y: acc.y + port.y,
        }),
        { x: 0, y: 0 },
      )
      return {
        x: sum.x / ports.length,
        y: sum.y / ports.length,
      }
    }
  }

  return null
}

const formatDrcIdentifiers = (error: Record<string, unknown>) => {
  const idFields = [
    "pcb_error_id",
    "pcb_placement_error_id",
    "source_trace_id",
    "pcb_trace_id",
    "source_port_id",
  ] as const

  const parts = idFields.flatMap((fieldName) => {
    const value = error[fieldName]
    return typeof value === "string" && value.length > 0
      ? [`${fieldName}=${value}`]
      : []
  })

  const pcbPortIds = Array.isArray(error.pcb_port_ids)
    ? error.pcb_port_ids.filter(
        (value): value is string => typeof value === "string",
      )
    : []
  if (pcbPortIds.length > 0) {
    parts.push(`pcb_port_ids=${pcbPortIds.join(",")}`)
  }

  return parts.join(" ")
}

const toUnknownRecord = (value: object): Record<string, unknown> =>
  value as unknown as Record<string, unknown>

const emitLogLines = async (
  logsPath: string,
  lines: string[],
  onLog?: (line: string) => void,
) => {
  for (const line of lines) {
    onLog?.(line)
  }
  await appendFile(logsPath, `${lines.join("\n")}\n`)
}

const parseArgs = (): RunSampleOptions => {
  const args = process.argv.slice(2)
  const options: RunSampleOptions = {
    pipeline: 4,
    dataset: "dataset01",
    pngSize: 1536,
  }

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]

    if (arg === "-h" || arg === "--help") {
      printHelp()
      process.exit(0)
    }

    if (arg === "--pipeline") {
      const pipelineId = parsePositiveInt(args[i + 1] ?? "", "--pipeline")
      if (!(pipelineId in PIPELINE_SOLVERS)) {
        throw new Error("--pipeline must be one of 1, 2, 3, or 4")
      }
      options.pipeline = pipelineId as PipelineId
      i += 1
      continue
    }

    if (arg === "--srj-path") {
      const srjPath = args[i + 1]
      if (!srjPath || srjPath.startsWith("-")) {
        throw new Error("--srj-path requires a value")
      }
      options.srjPath = srjPath
      i += 1
      continue
    }

    if (arg === "--sample") {
      options.sample = parsePositiveInt(args[i + 1] ?? "", "--sample")
      i += 1
      continue
    }

    if (arg === "--dataset") {
      const dataset = args[i + 1]
      if (!dataset || dataset.startsWith("-")) {
        throw new Error("--dataset requires a value")
      }
      if (!isDatasetName(dataset)) {
        throw new Error(
          `Unknown dataset "${dataset}". Available: ${DATASET_NAMES.join(", ")}`,
        )
      }
      options.dataset = dataset
      i += 1
      continue
    }

    if (arg === "--out-dir") {
      const outDir = args[i + 1]
      if (!outDir || outDir.startsWith("-")) {
        throw new Error("--out-dir requires a value")
      }
      options.outDir = outDir
      i += 1
      continue
    }

    if (arg === "--png-size") {
      options.pngSize = parsePositiveInt(args[i + 1] ?? "", "--png-size")
      i += 1
      continue
    }

    if (arg === "--effort") {
      options.effort = parsePositiveInt(args[i + 1] ?? "", "--effort")
      i += 1
      continue
    }

    throw new Error(`Unknown argument: ${arg}`)
  }

  if (Boolean(options.srjPath) === Boolean(options.sample)) {
    throw new Error("Provide exactly one of --srj-path or --sample")
  }

  if (options.pngSize < 1024) {
    throw new Error("--png-size must be at least 1024")
  }

  return options
}

const loadSrjFromPath = async (srjPath: string) => {
  const absolutePath = path.resolve(process.cwd(), srjPath)
  const rawFile = await readFile(absolutePath, "utf8")
  const parsedFile = JSON.parse(rawFile)
  const srj = toSimpleRouteJson(parsedFile)

  if (!srj) {
    throw new Error(
      `File ${absolutePath} does not contain a SimpleRouteJson-compatible payload`,
    )
  }

  return {
    scenario: srj,
    scenarioName: path.basename(absolutePath, path.extname(absolutePath)),
    sourceLabel: toRelativePath(absolutePath),
  }
}

const getNextRunDirectory = async () => {
  const tmpDir = path.join(process.cwd(), "tmp")
  await mkdir(tmpDir, { recursive: true })

  const entries = await readdir(tmpDir, { withFileTypes: true })
  const existingRunNumbers = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => /^run-(\d+)$/.exec(entry.name)?.[1])
    .filter((match): match is string => Boolean(match))
    .map((match) => Number.parseInt(match, 10))

  const nextRunNumber =
    existingRunNumbers.length === 0 ? 1 : Math.max(...existingRunNumbers) + 1

  return {
    runNumber: nextRunNumber,
    outputDir: path.join(tmpDir, `run-${nextRunNumber}`),
  }
}

const main = async () => {
  const options = parseArgs()
  const pipelineConfig = PIPELINE_SOLVERS[options.pipeline]

  const input =
    options.srjPath !== undefined
      ? await loadSrjFromPath(options.srjPath)
      : await loadScenarioBySampleNumber(
          options.dataset,
          options.sample!,
          options.effort,
        )

  const resolvedOutputDir = options.outDir
    ? path.resolve(process.cwd(), options.outDir)
    : (await getNextRunDirectory()).outputDir

  const pipelineSolver = new pipelineConfig.SolverConstructor(input.scenario, {
    effort: options.effort,
  })
  const onLog = (line: string) => {
    console.log(line)
  }

  const runner = new PipelineStageDebugRunner({
    pipelineSolver,
    outputDir: resolvedOutputDir,
    pngWidth: options.pngSize,
    pngHeight: options.pngSize,
    context: {
      pipeline: options.pipeline,
      solver: pipelineConfig.solverName,
      dataset: options.sample ? options.dataset : "",
      sample: options.sample ?? "",
      scenarioName: input.scenarioName,
      srjSource: input.sourceLabel,
    },
    onLog,
  })

  const result = await runner.run()
  let relaxedDrcPassed: boolean | null = null
  let drcErrors: Array<Record<string, unknown>> = []

  if (result.solved && !result.failed) {
    const traces = pipelineSolver.getOutputSimplifiedPcbTraces?.() ?? []
    const circuitJson = convertToCircuitJson(
      pipelineSolver.srjWithPointPairs ?? input.scenario,
      traces as any,
      input.scenario.minTraceWidth,
      input.scenario.minViaDiameter,
    ) as Array<Record<string, unknown>>
    const drcResult = getDrcErrors(circuitJson as any, RELAXED_DRC_OPTIONS)
    relaxedDrcPassed = drcResult.errors.length === 0
    drcErrors = drcResult.errorsWithCenters.map((error) => {
      const errorRecord = toUnknownRecord(error)
      return {
        ...errorRecord,
        resolvedLocation: getApproximateErrorLocation(errorRecord, circuitJson),
      }
    })

    await emitLogLines(
      result.logsPath,
      [
        "postrun",
        `drc.relaxedPassed=${relaxedDrcPassed}`,
        `drc.errorCount=${drcErrors.length}`,
        ...drcErrors.map((error, index) => {
          const message =
            typeof error.message === "string"
              ? error.message.replace(/\s+/g, " ").trim()
              : ""
          const location = formatPoint(
            (error.resolvedLocation as { x: number; y: number } | null) ?? null,
          )
          const identifiers = formatDrcIdentifiers(error)
          return `drc[${index + 1}] type=${error.error_type ?? error.type ?? "unknown"} location=${location} ${identifiers} message=${JSON.stringify(message)}`
        }),
      ],
      onLog,
    )
  } else {
    await emitLogLines(
      result.logsPath,
      ["postrun", "drc.relaxedPassed=n/a", "drc.errorCount=n/a"],
      onLog,
    )
  }

  const success = result.solved && !result.failed
  const drcSummary =
    relaxedDrcPassed === null ? "not-run" : relaxedDrcPassed ? "pass" : "fail"

  console.log(`Success: ${success ? "yes" : "no"}`)
  console.log(`Relaxed DRC: ${drcSummary}`)
  console.log(
    `DRC errors: ${relaxedDrcPassed === null ? "n/a" : String(drcErrors.length)}`,
  )
  console.log(`Output dir: ${toRelativePath(result.outputDir)}`)
  console.log(`Logs: ${toRelativePath(result.logsPath)}`)
  console.log(`Stage PNGs: ${result.stageArtifacts.length}`)

  if (drcErrors.length > 0) {
    console.log(`DRC details written to: ${toRelativePath(result.logsPath)}`)
  }

  if (!success) {
    console.error(result.error ?? "Pipeline run failed")
    process.exit(1)
  }
}

await main()
