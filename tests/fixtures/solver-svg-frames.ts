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

type SvgFrameLayer = number | "split"

type SvgFrameLayerOptions = {
  /** Numeric z-layer to show, or "split" to stack all detected z-layers inside this frame. */
  layer?: SvgFrameLayer
}

type LayeredGraphicsItem = {
  layer?: string
  label?: string
  text?: string
}

type SplitLayerSlot = {
  width: number
  height: number
}

type TitleSegment = {
  text: string
  color: string
}

/** Graphics method to use for a captured frame. */
type SolverSvgFrameView = "visualize" | "preview"
type InternalSolverSvgFrameView = SolverSvgFrameView | "finalVisualize"

export type SolverSvgFrame = (
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
) &
  SvgFrameLayerOptions

export type GraphicsSvgFrame = {
  /** Label prefix shown above this frame. */
  name: string
  /** Render only the label, without solver step/layer metadata. */
  hideMetadata?: boolean
  /** Optional step label shown after the frame name. */
  step?: number | "start" | "end"
  /** Marks this frame as a completed pipeline output. */
  pipeline?: "end"
  /** Actual solver iteration reached when this frame was captured. */
  iteration?: number
  /** GraphicsObject rendered inside this frame cell. */
  graphics: GraphicsObject
  /** Numeric z-layer shown in this frame, or "split" to stack all detected z-layers inside this frame. */
  layer?: SvgFrameLayer
}

type SolverSvgFramesParams = {
  /** Solver or pipeline instance that will be advanced while frames are captured in order. */
  solver: SolverLike
  /** Ordered list of root, pipeline, or sub-solver frames to render into the SVG sheet. */
  frames: SolverSvgFrame[]
} & SvgFramesOptions

type SolverGraphicsFramesParams = Pick<
  SolverSvgFramesParams,
  "solver" | "frames"
>

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
  const graphicsFrames = getSolverGraphicsFrames({ solver, frames })

  return getGraphicsSvgFrames({
    frames: graphicsFrames,
    columns,
    gap,
    cellWidth,
    cellHeight,
    backgroundColor,
  })
}

export function getSolverGraphicsFrames({
  solver,
  frames,
}: SolverGraphicsFramesParams): GraphicsSvgFrame[] {
  if (frames.length === 0) {
    throw new Error("getSolverGraphicsFrames requires at least one frame")
  }

  return frames.map((frame) => captureSolverFrame({ solver, frame }))
}

export function getGraphicsSvgFrames({
  frames,
  columns,
  gap,
  cellWidth,
  cellHeight,
  backgroundColor = "white",
}: GraphicsSvgFramesParams): string {
  if (frames.length === 0) {
    throw new Error("getGraphicsSvgFrames requires at least one frame")
  }

  const splitLayerSlot = getSplitLayerSlot(frames)
  const renderedFrames = frames.map((frame) =>
    prepareFrameForRendering(frame, splitLayerSlot),
  )
  const frameColumns = columns ?? Math.min(renderedFrames.length, 3)
  const frameBounds = renderedFrames.map((frame) =>
    getUsableBounds(frame.graphics),
  )
  const measuredCellWidth =
    cellWidth ??
    Math.max(...frameBounds.map((bounds) => bounds.maxX - bounds.minX))
  const measuredCellHeight =
    cellHeight ??
    Math.max(...frameBounds.map((bounds) => bounds.maxY - bounds.minY))
  const cellGap = gap ?? measuredCellWidth * 0.16
  const labelFontSize = Math.min(measuredCellWidth, measuredCellHeight) * 0.082
  const labelGap = labelFontSize * 0.7
  const rowHeight = measuredCellHeight + labelFontSize * 3.4
  let framesGraphics: GraphicsObject = emptyGraphics

  for (let frameIndex = 0; frameIndex < renderedFrames.length; frameIndex++) {
    const frame = renderedFrames[frameIndex]!
    const bounds = frameBounds[frameIndex]!
    const column = frameIndex % frameColumns
    const row = Math.floor(frameIndex / frameColumns)
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

function prepareFrameForRendering(
  frame: GraphicsSvgFrame,
  splitLayerSlot: SplitLayerSlot,
): GraphicsSvgFrame {
  if (frame.layer === "split") {
    return {
      ...frame,
      graphics: createSplitLayerGraphics(frame.graphics, splitLayerSlot),
    }
  }

  if (typeof frame.layer === "number") {
    if (!Number.isInteger(frame.layer) || frame.layer < 0) return frame

    return {
      ...frame,
      graphics: filterGraphicsObjectByLayers(frame.graphics, [frame.layer]),
    }
  }

  return frame
}

function getSplitLayerSlot(frames: GraphicsSvgFrame[]): SplitLayerSlot {
  const frameBounds = frames.map((frame) => getUsableBounds(frame.graphics))
  const width = Math.max(
    ...frameBounds.map((bounds) => bounds.maxX - bounds.minX),
  )
  const height = Math.max(
    ...frameBounds.map((bounds) => bounds.maxY - bounds.minY),
  )

  return { width, height }
}

function createSplitLayerGraphics(
  graphics: GraphicsObject,
  splitLayerSlot: SplitLayerSlot,
): GraphicsObject {
  const splitLayerList = getGraphicsObjectLayers(graphics)
  if (splitLayerList.length === 0) return cloneGraphicsObject(graphics)

  const bounds = getUsableBounds(graphics)
  const graphicsWidth = bounds.maxX - bounds.minX
  const graphicsHeight = bounds.maxY - bounds.minY
  const slotWidth = Math.max(splitLayerSlot.width, graphicsWidth)
  const slotHeight = Math.max(splitLayerSlot.height, graphicsHeight)
  const slotMinX = bounds.minX + graphicsWidth / 2 - slotWidth / 2
  const slotMinY = bounds.minY + graphicsHeight / 2 - slotHeight / 2
  const layerGap = Math.max(slotHeight * 0.12, 0.2)
  const labelGap = Math.max(slotWidth * 0.05, 0.2)
  const labelFontSize = Math.max(Math.min(slotWidth, slotHeight) * 0.08, 0.12)
  let splitGraphics: GraphicsObject = emptyGraphics

  for (let layerIndex = 0; layerIndex < splitLayerList.length; layerIndex++) {
    const layer = splitLayerList[layerIndex]!
    const layerGraphics = filterGraphicsObjectByLayers(graphics, [layer])
    const layerBounds = getUsableBounds(layerGraphics)
    const layerWidth = layerBounds.maxX - layerBounds.minX
    const layerHeight = layerBounds.maxY - layerBounds.minY
    const yOffset = -layerIndex * (slotHeight + layerGap)

    splitGraphics = mergeGraphics(
      splitGraphics,
      mergeGraphics(
        translateGraphics(
          layerGraphics,
          slotMinX + (slotWidth - layerWidth) / 2 - layerBounds.minX,
          slotMinY +
            (slotHeight - layerHeight) / 2 +
            yOffset -
            layerBounds.minY,
        ),
        {
          rects: [
            {
              center: {
                x: slotMinX + slotWidth / 2,
                y: slotMinY + slotHeight / 2 + yOffset,
              },
              width: slotWidth,
              height: slotHeight,
              fill: "rgba(255,255,255,0)",
              stroke: "rgba(40,40,40,0.14)",
              label: `z${layer}`,
            },
          ],
          texts: [
            {
              x: slotMinX - labelGap,
              y: slotMinY + slotHeight / 2 + yOffset,
              text: `z${layer}`,
              anchorSide: "center_right",
              fontSize: labelFontSize,
              color: "black",
            },
          ],
        },
      ),
    )
  }

  return splitGraphics
}

function getGraphicsObjectLayers(graphics: GraphicsObject): number[] {
  const layerSet = new Set<number>()
  const addElementLayers = (item: LayeredGraphicsItem): void => {
    for (const layer of parseGraphicsItemLayers(item)) {
      layerSet.add(layer)
    }
  }

  graphics.points?.forEach(addElementLayers)
  graphics.lines?.forEach(addElementLayers)
  graphics.infiniteLines?.forEach(addElementLayers)
  graphics.rects?.forEach(addElementLayers)
  graphics.circles?.forEach(addElementLayers)
  graphics.polygons?.forEach(addElementLayers)
  graphics.arrows?.forEach(addElementLayers)
  graphics.texts?.forEach(addElementLayers)

  return [...layerSet].sort((a, b) => a - b)
}

function filterGraphicsObjectByLayers(
  graphics: GraphicsObject,
  layers: number[],
): GraphicsObject {
  const shouldKeep = (item: LayeredGraphicsItem): boolean =>
    isVisibleOnAnyLayer(item, layers)

  return cloneGraphicsObject({
    ...graphics,
    points: graphics.points?.filter(shouldKeep),
    lines: graphics.lines?.filter(shouldKeep),
    infiniteLines: graphics.infiniteLines?.filter(shouldKeep),
    rects: graphics.rects?.filter(shouldKeep),
    circles: graphics.circles?.filter(shouldKeep),
    polygons: graphics.polygons?.filter(shouldKeep),
    arrows: graphics.arrows?.filter(shouldKeep),
    texts: graphics.texts?.filter(shouldKeep),
  })
}

function isVisibleOnAnyLayer(
  item: LayeredGraphicsItem,
  selectedLayers: number[],
): boolean {
  const elementLayers = parseGraphicsItemLayers(item)
  if (elementLayers.length === 0) return true

  return elementLayers.some((layer) => selectedLayers.includes(layer))
}

function parseGraphicsItemLayers(item: LayeredGraphicsItem): number[] {
  const layerLayers = parseGraphicsLayer(item.layer)
  if (layerLayers.length > 0) return layerLayers

  const labelLayers = parseGraphicsLayerText(item.label)
  if (labelLayers.length > 0) return labelLayers

  return parseGraphicsLayerText(item.text)
}

function parseGraphicsLayer(graphicsLayer: string | undefined): number[] {
  const trimmedLayer = graphicsLayer?.trim()
  if (!trimmedLayer?.startsWith("z")) return []

  return parseLayerNumberList(trimmedLayer.slice(1).replaceAll("z", ""))
}

function parseGraphicsLayerText(text: string | undefined): number[] {
  if (!text) return []

  const layerSet = new Set<number>()
  for (const match of text.matchAll(
    /\b(?:availableZ|z):\s*([0-9]+(?:\s*,\s*[0-9]+)*)/gi,
  )) {
    parseLayerNumberList(match[1]!).forEach((layer) => layerSet.add(layer))
  }
  for (const match of text.matchAll(/(?:^|[^a-zA-Z0-9])z([0-9]+)\b/gi)) {
    const layer = Number(match[1])
    if (Number.isInteger(layer) && layer >= 0) layerSet.add(layer)
  }

  return [...layerSet].sort((a, b) => a - b)
}

function parseLayerNumberList(layerList: string): number[] {
  const layerSet = new Set<number>()

  for (const layerText of layerList.split(",")) {
    const layer = Number(layerText.trim())
    if (Number.isInteger(layer) && layer >= 0) layerSet.add(layer)
  }

  return [...layerSet].sort((a, b) => a - b)
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
      layer: frame.layer,
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
    layer: frame.layer,
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
      layer: frame.layer,
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
    layer: frame.layer,
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
  const titleLines = getFrameTitleLines(frame)
  const label = titleLines
    .map((line) => line.map((segment) => segment.text).join(""))
    .join(" ")
  const labelWidth = Math.max(
    ...titleLines.map((line) => getTitleSegmentsWidth(line, labelFontSize)),
  )
  const adjustedFontSize =
    labelWidth > cellWidth
      ? (cellWidth / labelWidth) * labelFontSize
      : labelFontSize
  const borderStrokeWidth = Math.max(
    Math.min(cellWidth, cellHeight) * 0.006,
    0.05,
  )

  return mergeGraphics(
    {
      rects: [
        {
          center: { x: cellMinX + cellWidth / 2, y: cellMinY + cellHeight / 2 },
          width: cellWidth,
          height: cellHeight,
          fill: "rgba(255,255,255,0)",
          stroke: "rgba(25,25,25,0.42)",
          label,
        },
      ],
      lines: createFrameBorderLines({
        cellMinX,
        cellMinY,
        cellWidth,
        cellHeight,
        strokeWidth: borderStrokeWidth,
      }),
    },
    mergeGraphics(
      translateGraphics(
        frame.graphics,
        cellMinX + (cellWidth - width) / 2 - bounds.minX,
        cellMinY + (cellHeight - height) / 2 - bounds.minY,
      ),
      {
        texts: createTitleTexts({
          lines: titleLines,
          x: cellMinX + cellWidth / 2,
          y: cellMinY + cellHeight + labelGap,
          maxWidth: cellWidth,
          fontSize: adjustedFontSize,
        }),
      },
    ),
  )
}

function createFrameBorderLines({
  cellMinX,
  cellMinY,
  cellWidth,
  cellHeight,
  strokeWidth,
}: {
  cellMinX: number
  cellMinY: number
  cellWidth: number
  cellHeight: number
  strokeWidth: number
}): NonNullable<GraphicsObject["lines"]> {
  const minX = cellMinX
  const maxX = cellMinX + cellWidth
  const minY = cellMinY
  const maxY = cellMinY + cellHeight
  const strokeColor = "rgba(25,25,25,0.62)"

  return [
    {
      points: [
        { x: minX, y: minY },
        { x: maxX, y: minY },
      ],
      strokeColor,
      strokeWidth,
    },
    {
      points: [
        { x: maxX, y: minY },
        { x: maxX, y: maxY },
      ],
      strokeColor,
      strokeWidth,
    },
    {
      points: [
        { x: maxX, y: maxY },
        { x: minX, y: maxY },
      ],
      strokeColor,
      strokeWidth,
    },
    {
      points: [
        { x: minX, y: maxY },
        { x: minX, y: minY },
      ],
      strokeColor,
      strokeWidth,
    },
  ]
}

function createTitleTexts({
  lines,
  x,
  y,
  maxWidth,
  fontSize,
}: {
  lines: TitleSegment[][]
  x: number
  y: number
  maxWidth: number
  fontSize: number
}): NonNullable<GraphicsObject["texts"]> {
  const lineGap = fontSize * 1.12
  const titleTexts: NonNullable<GraphicsObject["texts"]> = []

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex]!
    const lineFontSize = getFittedFontSize({
      segments: line,
      fontSize,
      maxWidth,
    })
    const lineY = y + (lines.length - lineIndex - 1) * lineGap
    let segmentX = x - getTitleSegmentsWidth(line, lineFontSize) / 2

    for (const segment of line) {
      const segmentWidth = getTextWidth(segment.text, lineFontSize)
      titleTexts.push({
        x: segmentX,
        y: lineY,
        text: segment.text,
        anchorSide: "bottom_left",
        fontSize: lineFontSize,
        color: segment.color,
      })
      segmentX += segmentWidth
    }
  }

  return titleTexts
}

function getFittedFontSize({
  segments,
  fontSize,
  maxWidth,
}: {
  segments: TitleSegment[]
  fontSize: number
  maxWidth: number
}): number {
  const titleWidth = getTitleSegmentsWidth(segments, fontSize)
  if (titleWidth <= maxWidth) return fontSize

  return (maxWidth / titleWidth) * fontSize
}

function getTitleSegmentsWidth(
  segments: TitleSegment[],
  fontSize: number,
): number {
  return segments.reduce(
    (width, segment) => width + getTextWidth(segment.text, fontSize),
    0,
  )
}

function getTextWidth(text: string, fontSize: number): number {
  return text.length * fontSize * 0.62
}

function getFrameTitleLines(frame: GraphicsSvgFrame): TitleSegment[][] {
  if (frame.hideMetadata) {
    return [[{ text: frame.name, color: "rgb(18,18,18)" }]]
  }

  const phase = getFramePhase(frame)
  const stepValue = getFrameStepValue(frame)
  const layerValue = getFrameLayerValue(frame)
  const nameText = phase === "step" ? frame.name : `${frame.name}:${phase}`
  const nameSegments: TitleSegment[] = [
    { text: nameText, color: "rgb(18,18,18)" },
  ]
  const metadataSegments: TitleSegment[] = []

  metadataSegments.push(
    {
      text: `step:${stepValue}`,
      color: "rgb(190,92,12)",
    },
    { text: ` layer:${layerValue}`, color: "rgb(120,58,175)" },
  )

  return [nameSegments, metadataSegments]
}

function getFramePhase(frame: GraphicsSvgFrame): string {
  if (frame.step === "start") return "start"
  if (frame.step === "end") return "end"
  if (frame.pipeline === "end") return "end"
  if (typeof frame.step === "number") return "step"

  return "frame"
}

function getFrameStepValue(frame: GraphicsSvgFrame): string {
  if (typeof frame.iteration === "number") {
    return String(frame.iteration)
  }

  if (typeof frame.step === "number") {
    return String(frame.step)
  }

  return "unknown"
}

function getFrameLayerValue(frame: GraphicsSvgFrame): string {
  if (frame.layer === "split") return "split"
  if (typeof frame.layer === "number") return `z${frame.layer}`

  return "all"
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
