import { appendFile, mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import {
  getPngBufferFromGraphicsObject,
  getSvgFromGraphicsObject,
} from "graphics-debug"
import type { GraphicsObject } from "graphics-debug"
import { BaseSolver } from "lib/solvers/BaseSolver"

type PipelineStepLike = {
  solverName: string
}

type VisualizingSolver = {
  visualize: () => GraphicsObject
  iterations?: number
  getSolverName?: () => string
}

export type StageDebuggablePipelineSolver = BaseSolver & {
  pipelineDef: PipelineStepLike[]
  currentPipelineStepIndex: number
  getCurrentPhase: () => string
  timeSpentOnPhase?: Record<string, number>
}

export type PipelineStageArtifact = {
  stageName: string
  stageNumber: number
  pngPath: string
  svgPath?: string
  graphicsJsonPath?: string
  stepPngPaths: string[]
}

export type PipelineStageDebugRunnerResult = {
  outputDir: string
  logsPath: string
  stageArtifacts: PipelineStageArtifact[]
  solved: boolean
  failed: boolean
  error: string | null
  stoppedAfterStage: string | null
}

export class PipelineStageDebugRunner<
  TPipelineSolver extends StageDebuggablePipelineSolver,
> {
  readonly pipelineSolver: TPipelineSolver
  readonly outputDir: string
  readonly logsPath: string
  readonly pngWidth: number
  readonly pngHeight: number
  readonly writeSvg: boolean
  readonly writeGraphicsJson: boolean
  readonly writeStepPngs: boolean
  readonly stopAfterStage?: string
  readonly context: Record<string, string | number | boolean | null | undefined>
  readonly onLog?: (line: string) => void

  private readonly stageArtifacts: PipelineStageArtifact[] = []

  constructor(opts: {
    pipelineSolver: TPipelineSolver
    outputDir: string
    pngWidth?: number
    pngHeight?: number
    writeSvg?: boolean
    writeGraphicsJson?: boolean
    writeStepPngs?: boolean
    stopAfterStage?: string
    context?: Record<string, string | number | boolean | null | undefined>
    onLog?: (line: string) => void
  }) {
    this.pipelineSolver = opts.pipelineSolver
    this.outputDir = opts.outputDir
    this.logsPath = path.join(this.outputDir, "logs.txt")
    this.pngWidth = opts.pngWidth ?? 1536
    this.pngHeight = opts.pngHeight ?? 1536
    this.writeSvg = opts.writeSvg ?? false
    this.writeGraphicsJson = opts.writeGraphicsJson ?? false
    this.writeStepPngs = opts.writeStepPngs ?? false
    this.stopAfterStage = opts.stopAfterStage
    this.context = opts.context ?? {}
    this.onLog = opts.onLog
  }

  async run(): Promise<PipelineStageDebugRunnerResult> {
    await mkdir(this.outputDir, { recursive: true })
    await writeFile(this.logsPath, "")

    await this.log(`startedAt=${new Date().toISOString()}`)
    for (const [key, value] of Object.entries(this.context)) {
      await this.log(`${key}=${value ?? ""}`)
    }
    await this.log(
      `pngSize=${this.pngWidth}x${this.pngHeight} outputDir=${this.toDisplayPath(this.outputDir)}`,
    )

    let currentPhase = this.pipelineSolver.getCurrentPhase()
    let stoppedAfterStage: string | null = null
    if (currentPhase !== "none") {
      await this.log(this.getStageEnterLogLine(currentPhase))
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
        await this.captureStage(previousPhase)
        if (previousPhase === this.stopAfterStage) {
          stoppedAfterStage = previousPhase
          break
        }
      }

      if (currentPhase !== previousPhase && currentPhase !== "none") {
        await this.log(this.getStageEnterLogLine(currentPhase))
      }

      if (thrownError) {
        break
      }
    }

    if (
      !stoppedAfterStage &&
      currentPhase !== "none" &&
      !this.hasStageArtifact(currentPhase)
    ) {
      await this.captureStage(currentPhase)
    }

    if (thrownError) {
      await this.log(`thrownError=${this.formatError(thrownError)}`)
    }

    const status = stoppedAfterStage
      ? "stopped"
      : this.pipelineSolver.solved
        ? "solved"
        : this.pipelineSolver.failed
          ? "failed"
          : "incomplete"
    await this.log(
      `completed status=${status} iterations=${this.pipelineSolver.iterations} error=${this.pipelineSolver.error ?? ""}`,
    )

    return {
      outputDir: this.outputDir,
      logsPath: this.logsPath,
      stageArtifacts: [...this.stageArtifacts],
      solved: this.pipelineSolver.solved,
      failed: this.pipelineSolver.failed,
      error:
        this.pipelineSolver.error ??
        (thrownError ? this.formatError(thrownError) : null),
      stoppedAfterStage,
    }
  }

  private hasStageArtifact(stageName: string) {
    return this.stageArtifacts.some(
      (artifact) => artifact.stageName === stageName,
    )
  }

  private async captureStage(stageName: string) {
    if (this.hasStageArtifact(stageName)) {
      return
    }

    const stageSolver = this.getStageSolver(stageName)
    if (!stageSolver) {
      throw new Error(`Unable to resolve solver for stage "${stageName}"`)
    }

    const stageNumber = this.getStageNumber(stageName)
    const pngPath = path.join(
      this.outputDir,
      `stage${String(stageNumber).padStart(2, "0")}-${this.getSafeStageName(stageName)}.png`,
    )
    const basePath = pngPath.slice(0, -".png".length)
    const graphics = stageSolver.visualize()

    const png = await getPngBufferFromGraphicsObject(graphics, {
      backgroundColor: "white",
      pngWidth: this.pngWidth,
      pngHeight: this.pngHeight,
    })

    await writeFile(pngPath, png)

    const stepPngPaths = this.writeStepPngs
      ? await this.writeStepPngsForGraphics(basePath, graphics)
      : []
    const svgPath = this.writeSvg ? `${basePath}.svg` : undefined
    const graphicsJsonPath = this.writeGraphicsJson
      ? `${basePath}.graphics.json`
      : undefined

    if (svgPath) {
      await writeFile(
        svgPath,
        getSvgFromGraphicsObject(graphics, { backgroundColor: "white" }),
      )
    }

    if (graphicsJsonPath) {
      await writeFile(graphicsJsonPath, JSON.stringify(graphics, null, 2))
    }

    const artifact = {
      stageName,
      stageNumber,
      pngPath,
      svgPath,
      graphicsJsonPath,
      stepPngPaths,
    } satisfies PipelineStageArtifact
    this.stageArtifacts.push(artifact)

    const elapsedTimeMs = this.pipelineSolver.timeSpentOnPhase?.[stageName]
    await this.log(
      `captured stage=${stageNumber} name=${stageName} solver=${stageSolver.getSolverName?.() ?? "unknown"} iterations=${stageSolver.iterations ?? 0} elapsedMs=${elapsedTimeMs?.toFixed(1) ?? "n/a"} png=${this.toDisplayPath(pngPath)} steps=${stepPngPaths.length}`,
    )
  }

  private async writeStepPngsForGraphics(
    basePath: string,
    graphics: GraphicsObject,
  ): Promise<string[]> {
    const stepPngPaths: string[] = []

    for (const step of this.getObjectSteps(graphics)) {
      const stepPngPath = `${basePath}.step-${step}.png`
      await writeFile(
        stepPngPath,
        await getPngBufferFromGraphicsObject(
          this.filterGraphicsByStep(graphics, step),
          {
            backgroundColor: "white",
            pngWidth: this.pngWidth,
            pngHeight: this.pngHeight,
          },
        ),
      )
      stepPngPaths.push(stepPngPath)
    }

    return stepPngPaths
  }

  private getObjectSteps(graphics: GraphicsObject): number[] {
    const steps = new Set<number>()
    const collect = (objects: Array<{ step?: number }> | undefined): void => {
      for (const object of objects ?? []) {
        if (typeof object.step === "number") steps.add(object.step)
      }
    }

    collect(graphics.points)
    collect(graphics.lines)
    collect(graphics.infiniteLines)
    collect(graphics.rects)
    collect(graphics.polygons)
    collect(graphics.circles)
    collect(graphics.texts)
    collect(graphics.arrows)

    return [...steps].sort((a, b) => a - b)
  }

  private filterGraphicsByStep(
    graphics: GraphicsObject,
    step: number,
  ): GraphicsObject {
    return {
      ...graphics,
      points: graphics.points?.filter(
        (object) => object.step === undefined || object.step === step,
      ),
      lines: graphics.lines?.filter(
        (object) => object.step === undefined || object.step === step,
      ),
      infiniteLines: graphics.infiniteLines?.filter(
        (object) => object.step === undefined || object.step === step,
      ),
      rects: graphics.rects?.filter(
        (object) => object.step === undefined || object.step === step,
      ),
      polygons: graphics.polygons?.filter(
        (object) => object.step === undefined || object.step === step,
      ),
      circles: graphics.circles?.filter(
        (object) => object.step === undefined || object.step === step,
      ),
      texts: graphics.texts?.filter(
        (object) => object.step === undefined || object.step === step,
      ),
      arrows: graphics.arrows?.filter(
        (object) => object.step === undefined || object.step === step,
      ),
    }
  }

  private getStageEnterLogLine(stageName: string) {
    const stageNumber = this.getStageNumber(stageName)
    return `enter stage=${stageNumber} name=${stageName}`
  }

  private getStageNumber(stageName: string) {
    const stepIndex = this.pipelineSolver.pipelineDef.findIndex(
      (step) => step.solverName === stageName,
    )
    return stepIndex === -1 ? this.stageArtifacts.length + 1 : stepIndex + 1
  }

  private getSafeStageName(stageName: string) {
    return (
      stageName
        .replace(/[^A-Za-z0-9_-]+/g, "-")
        .replace(/^-+/, "")
        .replace(/-+$/, "") || "stage"
    )
  }

  private getStageSolver(stageName: string): VisualizingSolver | null {
    const candidate = (this.pipelineSolver as Record<string, unknown>)[
      stageName
    ]
    if (this.isVisualizingSolver(candidate)) {
      return candidate
    }

    if (
      stageName === this.pipelineSolver.getCurrentPhase() &&
      this.isVisualizingSolver(this.pipelineSolver.activeSubSolver)
    ) {
      return this.pipelineSolver.activeSubSolver
    }

    return null
  }

  private isVisualizingSolver(value: unknown): value is VisualizingSolver {
    return (
      Boolean(value) &&
      typeof (value as VisualizingSolver).visualize === "function"
    )
  }

  private async log(line: string) {
    this.onLog?.(line)
    await appendFile(this.logsPath, `${line}\n`)
  }

  private toDisplayPath(filePath: string) {
    const relativePath = path.relative(process.cwd(), filePath)
    return relativePath && !relativePath.startsWith("..")
      ? `./${relativePath}`
      : filePath
  }

  private formatError(error: unknown) {
    return error instanceof Error ? error.message : String(error)
  }
}
