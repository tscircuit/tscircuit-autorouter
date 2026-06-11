import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { writeHeapSnapshot } from "node:v8"
import { BaseSolver } from "lib/solvers/BaseSolver"

type PipelineStepLike = {
  solverName: string
  getConstructorParams?: (pipelineSolver: unknown) => unknown[]
}

type StageDebuggablePipelineSolver = BaseSolver & {
  pipelineDef: PipelineStepLike[]
  currentPipelineStepIndex: number
  getCurrentPhase: () => string
  timeSpentOnPhase?: Record<string, number>
  activeSubSolver?: BaseSolver | null
}

type SolverLike = {
  iterations: number
  getSolverName: () => string
}

type MemoryUsageSnapshot = ReturnType<typeof process.memoryUsage>

type PhaseCapture = {
  stageName: string
  stageNumber: number
  inputSummaryPath: string
  outputSummaryPath: string
  memoryPath: string
  heapSnapshotPath: string | null
  handoffPath: string
}

export type PipelineMemoryAnalysisResult = {
  outputDir: string
  captures: PhaseCapture[]
  solved: boolean
  failed: boolean
  error: string | null
}

const JSON_SPACING = 2
const MAX_SUMMARY_DEPTH = 4
const MAX_SUMMARY_KEYS = 10
const MAX_SUMMARY_ITEMS = 8

export class PipelineMemoryAnalysisRunner<
  TPipelineSolver extends StageDebuggablePipelineSolver,
> {
  readonly pipelineSolver: TPipelineSolver
  readonly outputDir: string
  readonly captureHeapSnapshots: boolean
  readonly runLabel: string

  private readonly captures: PhaseCapture[] = []
  private readonly phaseInputs = new Map<string, unknown>()

  constructor(opts: {
    pipelineSolver: TPipelineSolver
    outputDir: string
    runLabel: string
    captureHeapSnapshots?: boolean
  }) {
    this.pipelineSolver = opts.pipelineSolver
    this.outputDir = opts.outputDir
    this.runLabel = opts.runLabel
    this.captureHeapSnapshots = opts.captureHeapSnapshots ?? true
  }

  async run(): Promise<PipelineMemoryAnalysisResult> {
    await mkdir(this.outputDir, { recursive: true })

    let currentPhase = this.pipelineSolver.getCurrentPhase()
    if (currentPhase !== "none") {
      this.capturePhaseInput(currentPhase)
    }

    let thrownError: unknown = null
    while (!this.pipelineSolver.solved && !this.pipelineSolver.failed) {
      const previousPhase = currentPhase

      try {
        this.pipelineSolver.step()
      } catch (error) {
        thrownError = error
      }

      currentPhase = this.pipelineSolver.getCurrentPhase()

      if (currentPhase !== previousPhase && previousPhase !== "none") {
        await this.capturePhase(previousPhase)
      }

      if (currentPhase !== previousPhase && currentPhase !== "none") {
        this.capturePhaseInput(currentPhase)
      }

      if (thrownError) break
    }

    if (currentPhase !== "none" && !this.hasCapture(currentPhase)) {
      await this.capturePhase(currentPhase)
    }

    await writeJson(
      path.join(this.outputDir, "manifest.json"),
      {
        runLabel: this.runLabel,
        solved: this.pipelineSolver.solved,
        failed: this.pipelineSolver.failed,
        error:
          this.pipelineSolver.error ??
          (thrownError instanceof Error
            ? thrownError.message
            : thrownError
              ? String(thrownError)
              : null),
        captures: this.captures,
      },
      JSON_SPACING,
    )

    return {
      outputDir: this.outputDir,
      captures: [...this.captures],
      solved: this.pipelineSolver.solved,
      failed: this.pipelineSolver.failed,
      error:
        this.pipelineSolver.error ??
        (thrownError instanceof Error
          ? thrownError.message
          : thrownError
            ? String(thrownError)
            : null),
    }
  }

  private hasCapture(stageName: string) {
    return this.captures.some((capture) => capture.stageName === stageName)
  }

  private capturePhaseInput(stageName: string) {
    if (this.phaseInputs.has(stageName)) return

    const stepDef = this.pipelineSolver.pipelineDef.find(
      (step) => step.solverName === stageName,
    )
    if (!stepDef) {
      throw new Error(`Missing pipeline step definition for "${stageName}"`)
    }

    const constructorParams = stepDef.getConstructorParams?.(this.pipelineSolver)
    if (constructorParams === undefined) {
      throw new Error(`Missing constructor params callback for "${stageName}"`)
    }

    this.phaseInputs.set(stageName, summarizeValue(constructorParams))
  }

  private async capturePhase(stageName: string) {
    if (this.hasCapture(stageName)) return

    const stageNumber = this.getStageNumber(stageName)
    const stageSlug = `${String(stageNumber).padStart(2, "0")}-${safeName(stageName)}`
    const stageDir = path.join(this.outputDir, stageSlug)
    await mkdir(stageDir, { recursive: true })

    const inputSummary = this.phaseInputs.get(stageName)
    const stageSolver = this.getStageSolver(stageName)
    if (!stageSolver) {
      throw new Error(`Unable to resolve stage solver for "${stageName}"`)
    }

    const beforeGcMemory = process.memoryUsage()
    Bun.gc(true)
    const afterGcMemory = process.memoryUsage()

    const outputSummary = summarizeValue(getSolverOutput(stageSolver))
    const heapSnapshotPath = this.captureHeapSnapshots
      ? writeHeapSnapshot(path.join(stageDir, `${stageSlug}.heapsnapshot`))
      : null

    const afterSnapshotMemory = process.memoryUsage()
    Bun.gc(true)
    const afterSnapshotGcMemory = process.memoryUsage()

    const inputSummaryPath = path.join(stageDir, "input-summary.json")
    const outputSummaryPath = path.join(stageDir, "output-summary.json")
    const memoryPath = path.join(stageDir, "memory.json")
    const handoffPath = path.join(stageDir, "handoff.md")

    await writeJson(inputSummaryPath, inputSummary ?? null, JSON_SPACING)
    await writeJson(outputSummaryPath, outputSummary, JSON_SPACING)
    await writeJson(
      memoryPath,
      {
        beforeGcMemory,
        afterGcMemory,
        afterSnapshotMemory,
        afterSnapshotGcMemory,
        deltaFromAfterGcToAfterSnapshotGc: diffMemoryUsage(
          afterGcMemory,
          afterSnapshotGcMemory,
        ),
        solverIterations: stageSolver.iterations,
        solverName: stageSolver.getSolverName(),
        elapsedMs: this.pipelineSolver.timeSpentOnPhase?.[stageName] ?? null,
      },
      JSON_SPACING,
    )

    const previousCapture = this.captures[this.captures.length - 1]
    await writeFile(
      handoffPath,
      createHandoffMarkdown({
        stageName,
        stageNumber,
        stageDir,
        inputSummaryPath,
        outputSummaryPath,
        memoryPath,
        heapSnapshotPath,
        previousHandoffPath: previousCapture?.handoffPath ?? null,
        afterGcMemory,
        afterSnapshotGcMemory,
        elapsedMs: this.pipelineSolver.timeSpentOnPhase?.[stageName] ?? null,
        solverName: stageSolver.getSolverName(),
        solverIterations: stageSolver.iterations,
      }),
    )

    this.captures.push({
      stageName,
      stageNumber,
      inputSummaryPath,
      outputSummaryPath,
      memoryPath,
      heapSnapshotPath,
      handoffPath,
    })
  }

  private getStageNumber(stageName: string) {
    const stepIndex = this.pipelineSolver.pipelineDef.findIndex(
      (step) => step.solverName === stageName,
    )
    if (stepIndex === -1) {
      throw new Error(`Unable to locate stage number for "${stageName}"`)
    }
    return stepIndex + 1
  }

  private getStageSolver(stageName: string): (BaseSolver & SolverLike) | null {
    const candidate = (this.pipelineSolver as Record<string, unknown>)[stageName]
    if (isSolverLike(candidate)) {
      return candidate as BaseSolver & SolverLike
    }

    if (
      stageName === this.pipelineSolver.getCurrentPhase() &&
      isSolverLike(this.pipelineSolver.activeSubSolver)
    ) {
      return this.pipelineSolver.activeSubSolver as BaseSolver & SolverLike
    }

    return null
  }
}

const createHandoffMarkdown = ({
  stageName,
  stageNumber,
  inputSummaryPath,
  outputSummaryPath,
  memoryPath,
  heapSnapshotPath,
  previousHandoffPath,
  afterGcMemory,
  afterSnapshotGcMemory,
  elapsedMs,
  solverName,
  solverIterations,
}: {
  stageName: string
  stageNumber: number
  stageDir: string
  inputSummaryPath: string
  outputSummaryPath: string
  memoryPath: string
  heapSnapshotPath: string | null
  previousHandoffPath: string | null
  afterGcMemory: MemoryUsageSnapshot
  afterSnapshotGcMemory: MemoryUsageSnapshot
  elapsedMs: number | null
  solverName: string
  solverIterations: number
}) => {
  const lines = [
    `# Handoff: stage ${stageNumber} \`${stageName}\``,
    "",
    "Latest findings:",
    `- Solver: \`${solverName}\` with ${solverIterations} iterations.`,
    `- Elapsed time: ${formatMs(elapsedMs)}.`,
    `- Heap used after GC: ${formatBytes(afterGcMemory.heapUsed)}.`,
    `- Heap used after snapshot GC: ${formatBytes(afterSnapshotGcMemory.heapUsed)}.`,
    "",
    "References:",
    `- Input summary: ${toRelativeProjectPath(inputSummaryPath)}`,
    `- Output summary: ${toRelativeProjectPath(outputSummaryPath)}`,
    `- Memory metrics: ${toRelativeProjectPath(memoryPath)}`,
  ]

  if (heapSnapshotPath) {
    lines.push(`- Heap snapshot: ${toRelativeProjectPath(heapSnapshotPath)}`)
  }
  if (previousHandoffPath) {
    lines.push(`- Prior handoff: ${toRelativeProjectPath(previousHandoffPath)}`)
  }

  lines.push("")
  return `${lines.join("\n")}\n`
}

const getSolverOutput = (solver: BaseSolver) => {
  const candidate = solver as BaseSolver & Record<string, unknown>

  if (typeof candidate.getOutput === "function") {
    return candidate.getOutput()
  }
  if (typeof candidate.getOutputSimpleRouteJson === "function") {
    return candidate.getOutputSimpleRouteJson()
  }
  if (typeof candidate.getNewSimpleRouteJson === "function") {
    return candidate.getNewSimpleRouteJson()
  }
  if (typeof candidate.getHdRoutesWithWidths === "function") {
    return candidate.getHdRoutesWithWidths()
  }
  if (candidate.outputNodes) return candidate.outputNodes
  if (candidate.edges) return candidate.edges
  if (candidate.routes) return candidate.routes
  if (candidate.mergedHdRoutes) return candidate.mergedHdRoutes
  if (candidate.simplifiedHdRoutes) return candidate.simplifiedHdRoutes

  return candidate
}

const summarizeValue = (value: unknown, depth = 0): unknown => {
  if (
    value === null ||
    value === undefined ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value
  }

  if (depth >= MAX_SUMMARY_DEPTH) {
    return {
      type: getTypeName(value),
      truncated: true,
    }
  }

  if (Array.isArray(value)) {
    return {
      type: "array",
      length: value.length,
      items: value.slice(0, MAX_SUMMARY_ITEMS).map((item) =>
        summarizeValue(item, depth + 1),
      ),
    }
  }

  if (value instanceof Map) {
    return {
      type: "Map",
      size: value.size,
      entries: [...value.entries()]
        .slice(0, MAX_SUMMARY_ITEMS)
        .map(([key, entryValue]) => [
          summarizeValue(key, depth + 1),
          summarizeValue(entryValue, depth + 1),
        ]),
    }
  }

  if (value instanceof Set) {
    return {
      type: "Set",
      size: value.size,
      values: [...value.values()]
        .slice(0, MAX_SUMMARY_ITEMS)
        .map((item) => summarizeValue(item, depth + 1)),
    }
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>
    if (
      Array.isArray(record.connections) &&
      Array.isArray(record.obstacles) &&
      typeof record.layerCount === "number" &&
      record.bounds
    ) {
      return {
        type: "SimpleRouteJson",
        id: record.id ?? null,
        layerCount: record.layerCount,
        connectionCount: record.connections.length,
        obstacleCount: record.obstacles.length,
        traceCount: Array.isArray(record.traces) ? record.traces.length : 0,
        bounds: summarizeValue(record.bounds, depth + 1),
        connectionNames: (record.connections as Array<Record<string, unknown>>)
          .slice(0, MAX_SUMMARY_ITEMS)
          .map((connection) => connection.name ?? null),
      }
    }

    const keys = Object.keys(record)
    return {
      type: getTypeName(value),
      keyCount: keys.length,
      keys: keys.slice(0, MAX_SUMMARY_KEYS),
      sample: Object.fromEntries(
        keys
          .slice(0, MAX_SUMMARY_KEYS)
          .map((key) => [key, summarizeValue(record[key], depth + 1)]),
      ),
    }
  }

  return {
    type: typeof value,
    value: String(value),
  }
}

const getTypeName = (value: unknown) =>
  value && typeof value === "object"
    ? (value as { constructor?: { name?: string } }).constructor?.name ??
      "object"
    : typeof value

const diffMemoryUsage = (
  before: MemoryUsageSnapshot,
  after: MemoryUsageSnapshot,
) => ({
  rss: after.rss - before.rss,
  heapTotal: after.heapTotal - before.heapTotal,
  heapUsed: after.heapUsed - before.heapUsed,
  external: after.external - before.external,
  arrayBuffers: after.arrayBuffers - before.arrayBuffers,
})

const formatMs = (value: number | null) =>
  value === null ? "n/a" : `${value.toFixed(1)}ms`

const formatBytes = (value: number) => `${(value / (1024 * 1024)).toFixed(2)} MiB`

const safeName = (value: string) =>
  value.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "")

const isSolverLike = (value: unknown): value is SolverLike =>
  Boolean(value) &&
  typeof (value as SolverLike).getSolverName === "function" &&
  typeof (value as SolverLike).iterations === "number"

const toRelativeProjectPath = (filePath: string) => {
  const relativePath = path.relative(process.cwd(), filePath)
  return relativePath && !relativePath.startsWith("..")
    ? `./${relativePath}`
    : filePath
}

const writeJson = async (filePath: string, value: unknown, spacing: number) => {
  await writeFile(filePath, `${JSON.stringify(value, null, spacing)}\n`)
}
