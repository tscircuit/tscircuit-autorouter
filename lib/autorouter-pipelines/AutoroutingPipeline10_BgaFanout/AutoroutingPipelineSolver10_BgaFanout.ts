import {
  FanoutSolver,
  type Bounds as FanoutBounds,
  type FanoutAvailableCornerAndSideInput,
  type FanoutBorderTarget,
  type FanoutBusSpec,
  type FanoutDirection,
  type FanoutSolverOptions,
  type FanoutSolverOutput,
} from "@tscircuit/fanout-solver"
import {
  BasePipelineSolver,
  BaseSolver,
  definePipelineStep,
  type PipelineStep,
} from "@tscircuit/solver-utils"
import type { GraphicsObject } from "graphics-debug"
import {
  AutoroutingPipelineSolver9_PreloadedTraceGraph,
  type AutoroutingPipelineSolverOptions,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import {
  ComponentDetectionSolver,
  type ComponentDetectionSolverOutput,
  type DetectedComponent,
} from "lib/solvers/ComponentDetectionSolver/ComponentDetectionSolver"
import type { SimpleRouteJson, SimplifiedPcbTraces } from "lib/types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"

const MAX_FANOUT_BOUNDARY_MARGIN_MM = 4.5
const MIN_FANOUT_BOUNDARY_MARGIN_MM = 2
const MIN_POST_FANOUT_CORRIDOR_MM = 2
const INWARD_ESCAPE_DEPTH_MM = 1.2

type AutoroutingPipeline10Input = {
  inputSrj: SimpleRouteJson
  options: AutoroutingPipelineSolverOptions
}

type BgaPair = {
  first: DetectedComponent
  second: DetectedComponent
  axis: BgaPairAxis
}

type BgaPairAxis = "x" | "y"

const OPPOSITE_FANOUT_DIRECTION: Record<FanoutDirection, FanoutDirection> = {
  up: "down",
  down: "up",
  left: "right",
  right: "left",
}

type FanoutStageInput = {
  inputSrj: SimpleRouteJson
  options: FanoutSolverOptions
}

type AutoroutingStageInput = {
  inputSrj: SimpleRouteJson
  options: AutoroutingPipelineSolverOptions
}

type FanoutPairInput = {
  inputSrj: SimpleRouteJson
  source: DetectedComponent
  target: DetectedComponent
  axis: BgaPairAxis
}

function getCenterX(component: DetectedComponent): number {
  const { minX, maxX } = component.bounds
  const centerX = (minX + maxX) / 2

  if (!Number.isFinite(centerX)) {
    throw new Error(
      `Detected component ${component.componentId} has bad bounds`,
    )
  }
  return centerX
}

function getCenterY(component: DetectedComponent): number {
  const { minY, maxY } = component.bounds
  const centerY = (minY + maxY) / 2

  if (!Number.isFinite(centerY)) {
    throw new Error(
      `Detected component ${component.componentId} has bad bounds`,
    )
  }
  return centerY
}

function getPairGap({ first, second, axis }: BgaPair): number {
  if (axis === "x") {
    return (
      Math.max(first.bounds.minX, second.bounds.minX) -
      Math.min(first.bounds.maxX, second.bounds.maxX)
    )
  }

  return (
    Math.max(first.bounds.minY, second.bounds.minY) -
    Math.min(first.bounds.maxY, second.bounds.maxY)
  )
}

function getBgaPairAxis(
  first: DetectedComponent,
  second: DetectedComponent,
): BgaPairAxis {
  const horizontalGap = getPairGap({ first, second, axis: "x" })
  const verticalGap = getPairGap({ first, second, axis: "y" })

  return horizontalGap >= verticalGap ? "x" : "y"
}

function getPhysicalComponent(
  inputSrj: SimpleRouteJson,
  detectedComponent: DetectedComponent,
): DetectedComponent {
  // Detection may classify an irregular BGA from its largest uniform sub-grid.
  // Fanout still has to contain every physical package ball with that component ID.
  const memberObstacles = inputSrj.obstacles.filter(
    (obstacle) => obstacle.componentId === detectedComponent.componentId,
  )
  if (memberObstacles.length === 0) {
    throw new Error(
      `Detected component ${detectedComponent.componentId} has no physical obstacles`,
    )
  }

  return {
    ...detectedComponent,
    bounds: {
      __type: "rect",
      minX: Math.min(
        ...memberObstacles.map(
          (obstacle) => obstacle.center.x - obstacle.width / 2,
        ),
      ),
      maxX: Math.max(
        ...memberObstacles.map(
          (obstacle) => obstacle.center.x + obstacle.width / 2,
        ),
      ),
      minY: Math.min(
        ...memberObstacles.map(
          (obstacle) => obstacle.center.y - obstacle.height / 2,
        ),
      ),
      maxY: Math.max(
        ...memberObstacles.map(
          (obstacle) => obstacle.center.y + obstacle.height / 2,
        ),
      ),
    },
  }
}

function getFanoutBoundaryMargin(pair: BgaPair): number {
  const maximumMarginForCorridor =
    (getPairGap(pair) - MIN_POST_FANOUT_CORRIDOR_MM) / 2

  return Math.min(MAX_FANOUT_BOUNDARY_MARGIN_MM, maximumMarginForCorridor)
}

function getBgaPair(
  inputSrj: SimpleRouteJson,
  detectedComponents: ComponentDetectionSolverOutput,
): BgaPair {
  const bgaComponents = detectedComponents
    .filter((component) => component.componentKind === "bga")
    .map((component) => getPhysicalComponent(inputSrj, component))

  if (bgaComponents.length !== 2) {
    throw new Error(
      `Pipeline 10 requires exactly two detected BGAs; found ${bgaComponents.map((component) => component.componentId).join(", ") || "none"}`,
    )
  }
  const [unsortedFirst, unsortedSecond] = bgaComponents as [
    DetectedComponent,
    DetectedComponent,
  ]
  if (unsortedFirst.componentId === unsortedSecond.componentId) {
    throw new Error("Pipeline 10 requires two distinct BGA component IDs")
  }
  const axis = getBgaPairAxis(unsortedFirst, unsortedSecond)
  const [first, second] = bgaComponents.toSorted((first, second) =>
    axis === "x"
      ? getCenterX(first) - getCenterX(second)
      : getCenterY(first) - getCenterY(second),
  ) as [DetectedComponent, DetectedComponent]
  const pair = { first, second, axis }

  const fanoutBoundaryMargin = getFanoutBoundaryMargin(pair)
  if (fanoutBoundaryMargin < MIN_FANOUT_BOUNDARY_MARGIN_MM) {
    throw new Error(
      `Pipeline 10 cannot provide ${MIN_FANOUT_BOUNDARY_MARGIN_MM}mm fanout margins while retaining a ${MIN_POST_FANOUT_CORRIDOR_MM}mm routing corridor`,
    )
  }

  return pair
}

function getExpandedBounds(
  component: DetectedComponent,
  margin: number,
): FanoutBounds {
  const { minX, maxX, minY, maxY } = component.bounds

  return {
    minX: minX - margin,
    maxX: maxX + margin,
    minY: minY - margin,
    maxY: maxY + margin,
  }
}

function getPlainBounds(component: DetectedComponent): FanoutBounds {
  const { minX, maxX, minY, maxY } = component.bounds

  return {
    minX,
    maxX,
    minY,
    maxY,
  }
}

function getDirectionToTarget({
  axis,
  source,
  target,
}: Pick<FanoutPairInput, "axis" | "source" | "target">): FanoutDirection {
  if (axis === "x") {
    return getCenterX(target) > getCenterX(source) ? "right" : "left"
  }

  return getCenterY(target) > getCenterY(source) ? "up" : "down"
}

function getPhysicalFanoutBuses({
  inputSrj,
  source,
  target,
  axis,
}: FanoutPairInput): FanoutBusSpec[] {
  // The fanout solver assigns one layer to an entire bus. Keep the dataset's
  // logical DDR buses in the SRJ, but use per-signal physical buses here so a
  // 25-signal address group is not incorrectly forced through one BGA layer.
  const fanoutBoundaryMargin = getFanoutBoundaryMargin({
    first: source,
    second: target,
    axis,
  })
  const boundary = getExpandedBounds(source, fanoutBoundaryMargin)
  const inwardDirection = getDirectionToTarget({ axis, source, target })
  const outwardDirection = OPPOSITE_FANOUT_DIRECTION[inwardDirection]
  const perpendicularDirections: [FanoutDirection, FanoutDirection] =
    axis === "x" ? ["up", "down"] : ["left", "right"]

  return inputSrj.connections.map((connection, connectionIndex) => {
    const sourcePoints = connection.pointsToConnect.filter(
      (point) =>
        point.x >= source.bounds.minX &&
        point.x <= source.bounds.maxX &&
        point.y >= source.bounds.minY &&
        point.y <= source.bounds.maxY,
    )
    if (sourcePoints.length !== 1) {
      throw new Error(
        `Connection ${connection.name} must touch ${source.componentId} exactly once before fanout`,
      )
    }

    const sourcePoint = sourcePoints[0]!
    const boundaryDistanceByDirection: Record<FanoutDirection, number> = {
      right: boundary.maxX - sourcePoint.x,
      left: sourcePoint.x - boundary.minX,
      up: boundary.maxY - sourcePoint.y,
      down: sourcePoint.y - boundary.minY,
    }
    const inwardDistance = boundaryDistanceByDirection[inwardDirection]
    const nonInwardCandidates: Array<{
      direction: FanoutDirection
      distance: number
    }> = [...perpendicularDirections, outwardDirection].map((direction) => ({
      direction,
      distance: boundaryDistanceByDirection[direction],
    }))
    const nearestNonInwardDirection = nonInwardCandidates.toSorted(
      (first, second) => first.distance - second.distance,
    )[0]!.direction
    const direction: FanoutDirection =
      inwardDistance <= fanoutBoundaryMargin + INWARD_ESCAPE_DEPTH_MM
        ? inwardDirection
        : nearestNonInwardDirection
    let preferredExit: FanoutBorderTarget =
      direction === "up" ? "top" : direction === "down" ? "bottom" : direction
    if (direction === "up") {
      preferredExit =
        sourcePoint.x < getCenterX(source) ? "top-left" : "top-right"
    } else if (direction === "down") {
      preferredExit =
        sourcePoint.x < getCenterX(source) ? "bottom-left" : "bottom-right"
    } else if (sourcePoint.y > getCenterY(source) + 1e-6) {
      preferredExit = direction === "right" ? "top-right" : "top-left"
    } else if (sourcePoint.y < getCenterY(source) - 1e-6) {
      preferredExit = direction === "right" ? "bottom-right" : "bottom-left"
    }

    return {
      busId: `pipeline10_fanout:${source.componentId}:${connectionIndex}`,
      connectionNames: [connection.name],
      sourceComponentId: source.componentId,
      direction,
      preferredExit,
      termination: { type: "boundary" },
    }
  })
}

function getFanoutOptions({
  inputSrj,
  source,
  target,
  axis,
}: FanoutPairInput): FanoutSolverOptions {
  const fanoutBoundaryMargin = getFanoutBoundaryMargin({
    first: source,
    second: target,
    axis,
  })
  const availableCornersAndSides: FanoutAvailableCornerAndSideInput[] = [
    "top_left",
    "top_middle",
    "top_right",
    "right_top",
    "right_middle",
    "right_bottom",
    "bottom_right",
    "bottom_middle",
    "bottom_left",
    "left_bottom",
    "left_middle",
    "left_top",
  ]

  return {
    buses: getPhysicalFanoutBuses({ inputSrj, source, target, axis }),
    sourceComponentId: source.componentId,
    availableCornersAndSides,
    componentBounds: { [source.componentId]: getPlainBounds(source) },
    sharedBoundary: getExpandedBounds(source, fanoutBoundaryMargin),
    maxLayerCombinations: 256,
    balanceLayerLoadByConnectionCount: true,
    compactBusTracks: true,
    borderDistribution: "even",
  }
}

class FanoutStage extends BaseSolver {
  readonly fanoutSolver: FanoutSolver

  constructor(public readonly inputProblem: FanoutStageInput) {
    super()
    this.fanoutSolver = new FanoutSolver(
      inputProblem.inputSrj,
      inputProblem.options,
    )
    this.activeSubSolver = this.fanoutSolver as unknown as BaseSolver
    this.MAX_ITERATIONS = this.fanoutSolver.MAX_ITERATIONS + 1
  }

  override _step(): void {
    this.fanoutSolver.step()
    this.progress = this.fanoutSolver.progress
    this.stats = { ...this.fanoutSolver.stats }

    if (this.fanoutSolver.failed) {
      this.error = this.fanoutSolver.error ?? "Fanout solver failed"
      this.failed = true
      this.activeSubSolver = null
      return
    }
    if (this.fanoutSolver.solved) {
      this.solved = true
      this.activeSubSolver = null
    }
  }

  override getConstructorParams(): readonly [FanoutStageInput] {
    return [this.inputProblem] as const
  }

  override getOutput(): FanoutSolverOutput {
    return this.fanoutSolver.getOutput()
  }

  getOutputSimpleRouteJson(): SimpleRouteJson {
    return this.fanoutSolver.getOutputSimpleRouteJson() as SimpleRouteJson
  }

  override visualize(): GraphicsObject {
    return this.fanoutSolver.visualize()
  }

  override preview(): GraphicsObject {
    return this.fanoutSolver.preview()
  }
}

class AutoroutingStage extends BaseSolver {
  readonly autoroutingPipelineSolver: AutoroutingPipelineSolver9_PreloadedTraceGraph

  constructor(public readonly inputProblem: AutoroutingStageInput) {
    super()
    this.autoroutingPipelineSolver =
      new AutoroutingPipelineSolver9_PreloadedTraceGraph(
        inputProblem.inputSrj,
        inputProblem.options,
      )
    this.activeSubSolver = this
      .autoroutingPipelineSolver as unknown as BaseSolver
    this.MAX_ITERATIONS = this.autoroutingPipelineSolver.MAX_ITERATIONS + 1
  }

  override _step(): void {
    this.autoroutingPipelineSolver.step()
    this.progress = this.autoroutingPipelineSolver.progress
    this.stats = { ...this.autoroutingPipelineSolver.stats }

    if (this.autoroutingPipelineSolver.failed) {
      this.error =
        this.autoroutingPipelineSolver.error ?? "Autorouting pipeline failed"
      this.failed = true
      this.activeSubSolver = null
      return
    }
    if (this.autoroutingPipelineSolver.solved) {
      this.solved = true
      this.activeSubSolver = null
    }
  }

  override getConstructorParams(): readonly [AutoroutingStageInput] {
    return [this.inputProblem] as const
  }

  override getOutput(): SimpleRouteJson {
    return this.autoroutingPipelineSolver.getOutputSimpleRouteJson()
  }

  override visualize(): GraphicsObject {
    return this.autoroutingPipelineSolver.visualize()
  }

  override preview(): GraphicsObject {
    return this.autoroutingPipelineSolver.preview()
  }
}

export class AutoroutingPipelineSolver10_BgaFanout extends BasePipelineSolver<AutoroutingPipeline10Input> {
  componentDetectionSolver?: ComponentDetectionSolver
  firstBgaFanoutSolver?: FanoutStage
  secondBgaFanoutSolver?: FanoutStage
  autoroutingPipelineSolver?: AutoroutingStage

  get currentPipelineStepIndex(): number {
    return this.currentPipelineStageIndex
  }

  get startTimeOfPhase(): Record<string, number> {
    return this.startTimeOfStage
  }

  get timeSpentOnPhase(): Record<string, number> {
    return this.timeSpentOnStage
  }

  pipelineDef: PipelineStep<BaseSolver>[] = [
    definePipelineStep(
      "componentDetectionSolver",
      ComponentDetectionSolver,
      (pipeline: AutoroutingPipelineSolver10_BgaFanout) => [
        { inputSrj: pipeline.inputProblem.inputSrj },
      ],
    ),
    definePipelineStep(
      "firstBgaFanoutSolver",
      FanoutStage,
      (pipeline: AutoroutingPipelineSolver10_BgaFanout) => {
        const pair = getBgaPair(
          pipeline.inputProblem.inputSrj,
          pipeline.componentDetectionSolver!.getOutput(),
        )
        return [
          {
            inputSrj: pipeline.inputProblem.inputSrj,
            options: getFanoutOptions({
              inputSrj: pipeline.inputProblem.inputSrj,
              source: pair.first,
              target: pair.second,
              axis: pair.axis,
            }),
          },
        ]
      },
    ),
    definePipelineStep(
      "secondBgaFanoutSolver",
      FanoutStage,
      (pipeline: AutoroutingPipelineSolver10_BgaFanout) => {
        const pair = getBgaPair(
          pipeline.inputProblem.inputSrj,
          pipeline.componentDetectionSolver!.getOutput(),
        )
        const firstBgaFanoutSrj =
          pipeline.firstBgaFanoutSolver!.getOutputSimpleRouteJson()
        return [
          {
            inputSrj: firstBgaFanoutSrj,
            options: getFanoutOptions({
              inputSrj: firstBgaFanoutSrj,
              source: pair.second,
              target: pair.first,
              axis: pair.axis,
            }),
          },
        ]
      },
    ),
    definePipelineStep(
      "autoroutingPipelineSolver",
      AutoroutingStage,
      (pipeline: AutoroutingPipelineSolver10_BgaFanout) => [
        {
          inputSrj: pipeline.secondBgaFanoutSolver!.getOutputSimpleRouteJson(),
          options: pipeline.inputProblem.options,
        },
      ],
    ),
  ]

  constructor(
    inputSrj: SimpleRouteJson,
    options: AutoroutingPipelineSolverOptions = {},
  ) {
    super({ inputSrj, options })
    this.MAX_ITERATIONS = 100e6 * (options.effort ?? 1) + 1_024
  }

  override getSolverName(): string {
    return "AutoroutingPipelineSolver10_BgaFanout"
  }

  override getConstructorParams(): readonly [
    SimpleRouteJson,
    AutoroutingPipelineSolverOptions,
  ] {
    return [this.inputProblem.inputSrj, this.inputProblem.options] as const
  }

  override getOutput(): SimpleRouteJson {
    if (!this.autoroutingPipelineSolver?.solved) {
      throw new Error("Pipeline 10 has not solved yet")
    }
    return this.autoroutingPipelineSolver.getOutput()
  }

  getOutputSimpleRouteJson(): SimpleRouteJson {
    return this.getOutput()
  }

  getOutputSimplifiedPcbTraces(): SimplifiedPcbTraces {
    return this.getOutput().traces ?? []
  }

  get srjWithPointPairs(): SimpleRouteJson | undefined {
    return this.autoroutingPipelineSolver?.autoroutingPipelineSolver
      .srjWithPointPairs
  }

  override initialVisualize(): GraphicsObject {
    return convertSrjToGraphicsObject(this.inputProblem.inputSrj)
  }

  override finalVisualize(): GraphicsObject {
    return convertSrjToGraphicsObject(this.getOutput())
  }
}
