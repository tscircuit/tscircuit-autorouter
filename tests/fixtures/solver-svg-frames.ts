import {
  getBounds,
  getSvgFromGraphicsObject,
  mergeGraphics,
  translateGraphics,
  type GraphicsObject,
} from "graphics-debug"

type Bounds = {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

type SolverLike = {
  solved: boolean
  failed: boolean
  iterations: number
  error?: string | null
  activeSubSolver?: SolverLike | null
  pipelineDef?: Array<{ solverName: string }>
  currentPipelineStepIndex?: number
  currentPipelineStageIndex?: number
  getCurrentPhase?: () => string
  getCurrentStageName?: () => string
  getSolverName?: () => string
  step: () => void
  visualize?: () => GraphicsObject
  preview?: () => GraphicsObject
  finalVisualize?: () => GraphicsObject | null
}

type SvgFramesOptions = {
  /** Number of frames per row. Defaults to up to 3 columns. */
  columns?: number
  /** Space between frame cells in graphics units. Defaults to 16% of cell width. */
  gap?: number
  /** Fixed width for every frame cell in graphics units. Defaults to the widest frame. */
  cellWidth?: number
  /** Fixed height for every frame cell in graphics units. Defaults to the tallest frame. */
  cellHeight?: number
  /** SVG background color. Defaults to white for stable snapshots. */
  backgroundColor?: string
}

/** Graphics method to use for a captured frame. */
type SolverSvgFrameView = "visualize" | "preview"
type InternalSolverSvgFrameView = SolverSvgFrameView | "finalVisualize"

export type SolverSvgFrame =
  | {
      /** Captures the root solver after a specific root iteration. */
      type: "step"
      /** Root solver iteration to capture after advancing with step(). */
      step: number
      /** Overrides the graphics method for this frame. Defaults to visualize(). */
      view?: SolverSvgFrameView
    }
  | {
      /** Captures a named sub-solver in the pipeline. */
      type: "solver"
      /** Pipeline stage property name, such as "topologyPlanningSolver". */
      solverName: string
      /** Capture point inside the named solver. Defaults to "end". */
      step?: "start" | "end" | number
      /** Overrides the graphics method for this frame. Defaults to visualize(). */
      view?: SolverSvgFrameView
    }
  | {
      /** Captures the root pipeline, either mid-run or after completion. */
      type: "pipeline"
      /** Root pipeline iteration to capture, or "end" to solve the whole pipeline. Defaults to "end". */
      step?: "end" | number
      /** Overrides the graphics method. Pipeline end uses finalVisualize() internally when omitted. */
      view?: SolverSvgFrameView
    }

export type GraphicsSvgFrame = {
  /** Label prefix shown above this frame. */
  name: string
  /** Optional step label shown after the frame name. */
  step?: number | "start" | "end"
  /** Marks this frame as a completed pipeline output. */
  pipeline?: "end"
  /** Actual solver iteration reached when this frame was captured. */
  iteration?: number
  /** GraphicsObject rendered inside this frame cell. */
  graphics: GraphicsObject
}

type SolverSvgFramesParams = {
  /** Solver or pipeline instance that will be advanced while frames are captured in order. */
  solver: SolverLike
  /** Ordered list of root, pipeline, or sub-solver frames to render into the SVG sheet. */
  frames: SolverSvgFrame[]
} & SvgFramesOptions

type GraphicsSvgFramesParams = {
  /** Ordered graphics frames to render into the SVG sheet. */
  frames: GraphicsSvgFrame[]
} & SvgFramesOptions

const emptyGraphics: GraphicsObject = {
  points: [],
  lines: [],
  infiniteLines: [],
  rects: [],
  circles: [],
  polygons: [],
  arrows: [],
  texts: [],
}

export function getSolverSvgFrames({
  solver,
  frames,
  columns,
  gap,
  cellWidth,
  cellHeight,
  backgroundColor,
}: SolverSvgFramesParams): string {
  if (frames.length === 0) {
    throw new Error("getSolverSvgFrames requires at least one frame")
  }

  const graphicsFrames = frames.map((frame) =>
    captureSolverFrame({ solver, frame }),
  )

  return getGraphicsSvgFrames({
    frames: graphicsFrames,
    columns,
    gap,
    cellWidth,
    cellHeight,
    backgroundColor,
  })
}

export function getGraphicsSvgFrames({
  frames,
  columns = Math.min(frames.length, 3),
  gap,
  cellWidth,
  cellHeight,
  backgroundColor = "white",
}: GraphicsSvgFramesParams): string {
  if (frames.length === 0) {
    throw new Error("getGraphicsSvgFrames requires at least one frame")
  }

  const frameBounds = frames.map((frame) => getUsableBounds(frame.graphics))
  const measuredCellWidth =
    cellWidth ??
    Math.max(...frameBounds.map((bounds) => bounds.maxX - bounds.minX))
  const measuredCellHeight =
    cellHeight ??
    Math.max(...frameBounds.map((bounds) => bounds.maxY - bounds.minY))
  const cellGap = gap ?? measuredCellWidth * 0.16
  const labelFontSize = Math.min(measuredCellWidth, measuredCellHeight) * 0.055
  const labelGap = labelFontSize * 0.7
  const rowHeight = measuredCellHeight + labelFontSize * 1.8
  let framesGraphics: GraphicsObject = emptyGraphics

  for (let frameIndex = 0; frameIndex < frames.length; frameIndex++) {
    const frame = frames[frameIndex]!
    const bounds = frameBounds[frameIndex]!
    const column = frameIndex % columns
    const row = Math.floor(frameIndex / columns)
    const cellMinX = column * (measuredCellWidth + cellGap)
    const cellMinY = -row * (rowHeight + cellGap)
    framesGraphics = mergeGraphics(
      framesGraphics,
      createCellGraphics({
        frame,
        bounds,
        cellMinX,
        cellMinY,
        cellWidth: measuredCellWidth,
        cellHeight: measuredCellHeight,
        labelFontSize,
        labelGap,
      }),
    )
  }

  return getSvgFromGraphicsObject(framesGraphics, { backgroundColor })
}

function captureSolverFrame({
  solver,
  frame,
}: {
  solver: SolverLike
  frame: SolverSvgFrame
}): GraphicsSvgFrame {
  if (frame.type === "pipeline") {
    return capturePipelineFrame({ solver, frame })
  }

  if (frame.type === "step") {
    advanceToSolverIteration({
      solver,
      targetSolver: solver,
      iteration: frame.step,
    })

    return {
      name: getFrameName({ solver }),
      step: frame.step,
      iteration: solver.iterations,
      graphics: getSolverGraphics({
        solver,
        view: frame.view ?? "visualize",
      }),
    }
  }

  const step = frame.step ?? "end"
  const targetSolver = advanceToPipelineStageStart({
    solver,
    solverName: frame.solverName,
  })

  if (step === "end") {
    advanceToSolverEnd({ solver, solverName: frame.solverName })
  } else if (step !== "start") {
    advanceToSolverIteration({
      solver,
      targetSolver,
      solverName: frame.solverName,
      iteration: step,
    })
  }

  return {
    name: getFrameName({ solver: targetSolver, solverName: frame.solverName }),
    step,
    iteration: targetSolver.iterations,
    graphics: getSolverGraphics({
      solver: targetSolver,
      view: frame.view ?? "visualize",
    }),
  }
}

function capturePipelineFrame({
  solver,
  frame,
}: {
  solver: SolverLike
  frame: Extract<SolverSvgFrame, { type: "pipeline" }>
}): GraphicsSvgFrame {
  if (typeof frame.step === "number") {
    advanceToSolverIteration({
      solver,
      targetSolver: solver,
      iteration: frame.step,
    })

    return {
      name: getFrameName({ solver }),
      step: frame.step,
      iteration: solver.iterations,
      graphics: getSolverGraphics({
        solver,
        view: frame.view ?? "visualize",
      }),
    }
  }

  while (!solver.solved && !solver.failed) {
    solver.step()
  }
  if (solver.failed) {
    throw new Error(solver.error ?? "Solver failed before pipeline end")
  }

  return {
    name: getFrameName({ solver }),
    pipeline: "end",
    iteration: solver.iterations,
    graphics: getSolverGraphics({
      solver,
      view: frame.view ?? "finalVisualize",
    }),
  }
}

function advanceToPipelineStageStart({
  solver,
  solverName,
}: {
  solver: SolverLike
  solverName: string
}): SolverLike {
  const targetStageIndex = getPipelineStageIndex({ solver, solverName })

  while (!solver.solved && !solver.failed) {
    const stageSolver = getPipelineStageSolver({ solver, solverName })
    if (stageSolver) return stageSolver

    if (getPipelineCurrentStageIndex(solver) > targetStageIndex) {
      throw new Error(`Pipeline stage "${solverName}" has already ended`)
    }

    solver.step()
  }

  throwIfFailed(solver)
  throw new Error(`Pipeline stage "${solverName}" never started`)
}

function advanceToSolverEnd({
  solver,
  solverName,
}: {
  solver: SolverLike
  solverName?: string
}): void {
  if (!solverName) {
    while (!solver.solved && !solver.failed) solver.step()
    throwIfFailed(solver)
    return
  }

  const targetStageIndex = getPipelineStageIndex({ solver, solverName })
  advanceToPipelineStageStart({ solver, solverName })
  while (!solver.solved && !solver.failed) {
    if (getPipelineCurrentStageIndex(solver) > targetStageIndex) return
    solver.step()
  }
  throwIfFailed(solver)
}

function advanceToSolverIteration({
  solver,
  targetSolver,
  solverName,
  iteration,
}: {
  solver: SolverLike
  targetSolver: SolverLike
  solverName?: string
  iteration: number
}): void {
  if (iteration < 0) {
    throw new Error(`Solver iteration must be non-negative, got ${iteration}`)
  }

  while (
    targetSolver.iterations < iteration &&
    !targetSolver.solved &&
    !targetSolver.failed
  ) {
    solverName ? solver.step() : targetSolver.step()
  }

  throwIfFailed(solver)
  throwIfFailed(targetSolver)
  if (targetSolver.iterations < iteration) {
    throw new Error(
      `${solverName ?? getFrameName({ solver: targetSolver })} ended before iteration ${iteration}`,
    )
  }
}

function getSolverGraphics({
  solver,
  view,
}: {
  solver: SolverLike
  view: InternalSolverSvgFrameView
}): GraphicsObject {
  const graphics =
    view === "finalVisualize"
      ? (solver.finalVisualize?.() ?? solver.visualize?.())
      : view === "preview"
        ? solver.preview?.()
        : solver.visualize?.()

  if (!graphics) {
    throw new Error(`${getFrameName({ solver })} did not provide ${view}`)
  }

  return cloneGraphicsObject(graphics)
}

function createCellGraphics({
  frame,
  bounds,
  cellMinX,
  cellMinY,
  cellWidth,
  cellHeight,
  labelFontSize,
  labelGap,
}: {
  frame: GraphicsSvgFrame
  bounds: Bounds
  cellMinX: number
  cellMinY: number
  cellWidth: number
  cellHeight: number
  labelFontSize: number
  labelGap: number
}): GraphicsObject {
  const width = bounds.maxX - bounds.minX
  const height = bounds.maxY - bounds.minY
  const label = getFrameLabel(frame)
  const labelWidth = label.length * labelFontSize * 0.62
  const adjustedFontSize =
    labelWidth > cellWidth
      ? (cellWidth / labelWidth) * labelFontSize
      : labelFontSize

  return mergeGraphics(
    {
      rects: [
        {
          center: { x: cellMinX + cellWidth / 2, y: cellMinY + cellHeight / 2 },
          width: cellWidth,
          height: cellHeight,
          fill: "rgba(255,255,255,0)",
          stroke: "rgba(40,40,40,0.24)",
          label,
        },
      ],
    },
    mergeGraphics(
      translateGraphics(
        frame.graphics,
        cellMinX + (cellWidth - width) / 2 - bounds.minX,
        cellMinY + (cellHeight - height) / 2 - bounds.minY,
      ),
      {
        texts: [
          {
            x: cellMinX + cellWidth / 2,
            y: cellMinY + cellHeight + labelGap,
            text: label,
            anchorSide: "bottom_center",
            fontSize: adjustedFontSize,
            color: "black",
          },
        ],
      },
    ),
  )
}

function getUsableBounds(graphics: GraphicsObject): Bounds {
  const bounds = getBounds(graphics)
  const width = bounds.maxX - bounds.minX
  const height = bounds.maxY - bounds.minY

  if (width > 0 && height > 0) return bounds

  return {
    minX: -1,
    maxX: 1,
    minY: -1,
    maxY: 1,
  }
}

function getFrameLabel(frame: GraphicsSvgFrame): string {
  if (typeof frame.step === "number") {
    return `${frame.name} step ${frame.step}`
  }

  if (frame.step) {
    const stepLabel = frame.step
    const iterationLabel =
      typeof frame.iteration === "number" ? ` step ${frame.iteration}` : ""
    return `${frame.name} ${stepLabel}${iterationLabel}`
  }

  const stepLabel =
    typeof frame.iteration === "number" ? ` step ${frame.iteration}` : ""

  return `${frame.name} pipeline end${stepLabel}`
}

function getFrameName({
  solver,
  solverName,
}: {
  solver: SolverLike
  solverName?: string
}): string {
  const reportedName = solver.getSolverName?.()
  const constructorName =
    typeof solver.constructor?.name === "string"
      ? solver.constructor.name
      : null

  return solverName ?? reportedName ?? constructorName ?? "solver"
}

function getPipelineCurrentStageIndex(solver: SolverLike): number {
  if (typeof solver.currentPipelineStageIndex === "number") {
    return solver.currentPipelineStageIndex
  }
  if (typeof solver.currentPipelineStepIndex === "number") {
    return solver.currentPipelineStepIndex
  }
  if (solver.pipelineDef && solver.solved) {
    return solver.pipelineDef.length
  }

  throw new Error("Solver does not expose a pipeline stage index")
}

function getPipelineStageIndex({
  solver,
  solverName,
}: {
  solver: SolverLike
  solverName: string
}): number {
  const stageIndex =
    solver.pipelineDef?.findIndex((stage) => stage.solverName === solverName) ??
    -1

  if (stageIndex >= 0) return stageIndex

  throw new Error(`Pipeline does not have stage "${solverName}"`)
}

function getPipelineStageSolver({
  solver,
  solverName,
}: {
  solver: SolverLike
  solverName: string
}): SolverLike | null {
  const stageSolver = (solver as Record<string, unknown>)[solverName]
  if (isSolverLike(stageSolver)) return stageSolver

  const currentStageName =
    solver.getCurrentStageName?.() ?? solver.getCurrentPhase?.() ?? null
  if (currentStageName === solverName && isSolverLike(solver.activeSubSolver)) {
    return solver.activeSubSolver
  }

  return null
}

function throwIfFailed(solver: SolverLike): void {
  if (!solver.failed) {
    return
  }

  const failureMessage = solver.error ?? `${getFrameName({ solver })} failed`
  throw new Error(failureMessage)
}

function isSolverLike(value: unknown): value is SolverLike {
  const candidate = value as Partial<SolverLike> | null
  const hasState =
    typeof candidate?.solved === "boolean" &&
    typeof candidate.failed === "boolean" &&
    typeof candidate.iterations === "number"

  return hasState && typeof candidate.step === "function"
}

function cloneGraphicsObject(graphics: GraphicsObject): GraphicsObject {
  return {
    ...graphics,
    points: graphics.points?.map((point) => ({ ...point })),
    lines: graphics.lines?.map((line) => ({
      ...line,
      points: line.points.map((point) => ({ ...point })),
    })),
    infiniteLines: graphics.infiniteLines?.map((line) => ({
      ...line,
      directionVector: { ...line.directionVector },
      origin: { ...line.origin },
    })),
    rects: graphics.rects?.map((rect) => ({
      ...rect,
      center: { ...rect.center },
    })),
    circles: graphics.circles?.map((circle) => ({
      ...circle,
      center: { ...circle.center },
    })),
    polygons: graphics.polygons?.map((polygon) => ({
      ...polygon,
      points: polygon.points.map((point) => ({ ...point })),
    })),
    arrows: graphics.arrows?.map((arrow) => ({
      ...arrow,
      start: { ...arrow.start },
      end: { ...arrow.end },
    })),
    texts: graphics.texts?.map((text) => ({ ...text })),
  }
}
