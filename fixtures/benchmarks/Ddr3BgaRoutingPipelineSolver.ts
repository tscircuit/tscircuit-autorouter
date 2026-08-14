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
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import {
  ComponentDetectionSolver,
  type ComponentDetectionSolverOutput,
  type DetectedComponent,
} from "lib/solvers/ComponentDetectionSolver/ComponentDetectionSolver"
import type { SimpleRouteJson } from "lib/types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"

const MAX_FANOUT_BOUNDARY_MARGIN_MM = 3
const MIN_FANOUT_BOUNDARY_MARGIN_MM = 2
const MIN_POST_FANOUT_CORRIDOR_MM = 2
const MIN_LAYER_COUNT = 12
const INWARD_ESCAPE_DEPTH_MM = 1.2

type Ddr3BgaRoutingPipelineInput = {
  inputSrj: SimpleRouteJson
}

type FixtureComponentRoles = {
  ddr3: DetectedComponent
  controller: DetectedComponent
}

type FanoutStageParams = {
  inputSrj: SimpleRouteJson
  options: FanoutSolverOptions
}

type AutoroutingStageParams = {
  inputSrj: SimpleRouteJson
}

type FixtureMetadata = {
  ddr3?: { componentId?: unknown }
  controller?: { componentId?: unknown }
}

function getMetadataComponentId(
  inputSrj: SimpleRouteJson,
  role: keyof FixtureMetadata,
): string {
  const metadata = (
    inputSrj as SimpleRouteJson & { metadata?: FixtureMetadata }
  ).metadata
  const componentId = metadata?.[role]?.componentId

  if (typeof componentId !== "string" || componentId.length === 0) {
    throw new Error(
      `SRJ29 fixture requires metadata.${role}.componentId to select the detected BGA`,
    )
  }
  return componentId
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

function getHorizontalGap(
  first: DetectedComponent,
  second: DetectedComponent,
): number {
  const [left, right] =
    getCenterX(first) < getCenterX(second) ? [first, second] : [second, first]

  return right.bounds.minX - left.bounds.maxX
}

function getFanoutBoundaryMargin(
  first: DetectedComponent,
  second: DetectedComponent,
): number {
  const maximumMarginForCorridor =
    (getHorizontalGap(first, second) - MIN_POST_FANOUT_CORRIDOR_MM) / 2

  return Math.min(MAX_FANOUT_BOUNDARY_MARGIN_MM, maximumMarginForCorridor)
}

function getFixtureComponentRoles(
  inputSrj: SimpleRouteJson,
  detectedComponents: ComponentDetectionSolverOutput,
): FixtureComponentRoles {
  const bgaComponents = detectedComponents.filter(
    (component) => component.componentKind === "bga",
  )
  const ddr3ComponentId = getMetadataComponentId(inputSrj, "ddr3")
  const controllerComponentId = getMetadataComponentId(inputSrj, "controller")
  const ddr3 = bgaComponents.find(
    (component) => component.componentId === ddr3ComponentId,
  )
  const controller = bgaComponents.find(
    (component) => component.componentId === controllerComponentId,
  )

  if (bgaComponents.length !== 2 || !ddr3 || !controller) {
    throw new Error(
      `SRJ29 fixture expected exactly the detected BGAs ${ddr3ComponentId} and ${controllerComponentId}; found ${bgaComponents.map((component) => component.componentId).join(", ") || "none"}`,
    )
  }
  if (ddr3.componentId === controller.componentId) {
    throw new Error("SRJ29 fixture DDR3 and controller must be distinct BGAs")
  }
  if (inputSrj.layerCount < MIN_LAYER_COUNT) {
    throw new Error(
      `SRJ29 fixture requires at least ${MIN_LAYER_COUNT} copper layers, received ${inputSrj.layerCount}`,
    )
  }

  const fanoutBoundaryMargin = getFanoutBoundaryMargin(ddr3, controller)
  if (fanoutBoundaryMargin < MIN_FANOUT_BOUNDARY_MARGIN_MM) {
    throw new Error(
      `SRJ29 fixture cannot provide ${MIN_FANOUT_BOUNDARY_MARGIN_MM}mm fanout margins while retaining a ${MIN_POST_FANOUT_CORRIDOR_MM}mm routing corridor`,
    )
  }

  return { ddr3, controller }
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

function getPhysicalFanoutBuses(
  inputSrj: SimpleRouteJson,
  source: DetectedComponent,
  target: DetectedComponent,
): FanoutBusSpec[] {
  // The fanout solver assigns one layer to an entire bus. Keep the dataset's
  // logical DDR buses in the SRJ, but use per-signal physical buses here so a
  // 25-signal address group is not incorrectly forced through one BGA layer.
  const fanoutBoundaryMargin = getFanoutBoundaryMargin(source, target)
  const boundary = getExpandedBounds(source, fanoutBoundaryMargin)
  const inwardDirection: FanoutDirection =
    getCenterX(target) > getCenterX(source) ? "right" : "left"

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
    const inwardDistance =
      inwardDirection === "right"
        ? boundary.maxX - sourcePoint.x
        : sourcePoint.x - boundary.minX
    const verticalCandidates: Array<{
      direction: "up" | "down"
      distance: number
    }> = [
      { direction: "up", distance: boundary.maxY - sourcePoint.y },
      { direction: "down", distance: sourcePoint.y - boundary.minY },
    ]
    const nearestVerticalDirection = verticalCandidates.toSorted(
      (first, second) => first.distance - second.distance,
    )[0]!.direction
    const direction: FanoutDirection =
      inwardDistance <= fanoutBoundaryMargin + INWARD_ESCAPE_DEPTH_MM
        ? inwardDirection
        : nearestVerticalDirection
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
      busId: `fixture_fanout:${source.componentId}:${connectionIndex}`,
      connectionNames: [connection.name],
      sourceComponentId: source.componentId,
      direction,
      preferredExit,
      termination: { type: "boundary" },
    }
  })
}

function getFanoutOptions(
  inputSrj: SimpleRouteJson,
  source: DetectedComponent,
  target: DetectedComponent,
): FanoutSolverOptions {
  const exitsRight = getCenterX(target) > getCenterX(source)
  const fanoutBoundaryMargin = getFanoutBoundaryMargin(source, target)
  const availableCornersAndSides: FanoutAvailableCornerAndSideInput[] =
    exitsRight
      ? [
          "top_left",
          "top_middle",
          "top_right",
          "right_top",
          "right_middle",
          "right_bottom",
          "bottom_right",
          "bottom_middle",
          "bottom_left",
        ]
      : [
          "top_left",
          "top_middle",
          "top_right",
          "left_top",
          "left_middle",
          "left_bottom",
          "bottom_right",
          "bottom_middle",
          "bottom_left",
        ]

  return {
    buses: getPhysicalFanoutBuses(inputSrj, source, target),
    sourceComponentId: source.componentId,
    availableCornersAndSides,
    componentBounds: { [source.componentId]: getPlainBounds(source) },
    sharedBoundary: getExpandedBounds(source, fanoutBoundaryMargin),
    maxLayerCombinations: 256,
    balanceLayerLoadByConnectionCount: true,
    compactBusTracks: true,
    // Pipeline 7, not the fanout prefix, owns inter-chip track alignment.
    preferOriginalEndpointTracks: false,
    borderDistribution: "even",
  }
}

class FanoutFixtureStage extends BaseSolver {
  readonly fanoutSolver: FanoutSolver

  constructor(public readonly inputProblem: FanoutStageParams) {
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

  override getConstructorParams(): readonly [FanoutStageParams] {
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

class AutoroutingFixtureStage extends BaseSolver {
  readonly autoroutingPipelineSolver: AutoroutingPipelineSolver7_MultiGraph

  constructor(public readonly inputProblem: AutoroutingStageParams) {
    super()
    this.autoroutingPipelineSolver = new AutoroutingPipelineSolver7_MultiGraph(
      inputProblem.inputSrj,
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

  override getConstructorParams(): readonly [AutoroutingStageParams] {
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

export class Ddr3BgaRoutingPipelineSolver extends BasePipelineSolver<Ddr3BgaRoutingPipelineInput> {
  componentDetectionSolver?: ComponentDetectionSolver
  ddr3FanoutSolver?: FanoutFixtureStage
  controllerFanoutSolver?: FanoutFixtureStage
  autoroutingPipelineSolver?: AutoroutingFixtureStage

  pipelineDef: PipelineStep<BaseSolver>[] = [
    definePipelineStep(
      "componentDetectionSolver",
      ComponentDetectionSolver,
      (pipeline: Ddr3BgaRoutingPipelineSolver) => [
        { inputSrj: pipeline.inputProblem.inputSrj },
      ],
    ),
    definePipelineStep(
      "ddr3FanoutSolver",
      FanoutFixtureStage,
      (pipeline: Ddr3BgaRoutingPipelineSolver) => {
        const roles = getFixtureComponentRoles(
          pipeline.inputProblem.inputSrj,
          pipeline.componentDetectionSolver!.getOutput(),
        )
        return [
          {
            inputSrj: pipeline.inputProblem.inputSrj,
            options: getFanoutOptions(
              pipeline.inputProblem.inputSrj,
              roles.ddr3,
              roles.controller,
            ),
          },
        ]
      },
    ),
    definePipelineStep(
      "controllerFanoutSolver",
      FanoutFixtureStage,
      (pipeline: Ddr3BgaRoutingPipelineSolver) => {
        const roles = getFixtureComponentRoles(
          pipeline.inputProblem.inputSrj,
          pipeline.componentDetectionSolver!.getOutput(),
        )
        const ddr3FanoutSrj =
          pipeline.ddr3FanoutSolver!.getOutputSimpleRouteJson()
        return [
          {
            inputSrj: ddr3FanoutSrj,
            options: getFanoutOptions(
              ddr3FanoutSrj,
              roles.controller,
              roles.ddr3,
            ),
          },
        ]
      },
    ),
    definePipelineStep(
      "autoroutingPipelineSolver",
      AutoroutingFixtureStage,
      (pipeline: Ddr3BgaRoutingPipelineSolver) => [
        {
          inputSrj: pipeline.controllerFanoutSolver!.getOutputSimpleRouteJson(),
        },
      ],
    ),
  ]

  constructor(inputProblem: Ddr3BgaRoutingPipelineInput) {
    super(inputProblem)
    this.MAX_ITERATIONS = 100e6 + 1_024
  }

  override getConstructorParams(): readonly [Ddr3BgaRoutingPipelineInput] {
    return [this.inputProblem] as const
  }

  override getOutput(): SimpleRouteJson {
    if (!this.autoroutingPipelineSolver?.solved) {
      throw new Error("DDR3 BGA routing pipeline has not solved yet")
    }
    return this.autoroutingPipelineSolver.getOutput()
  }

  override initialVisualize(): GraphicsObject {
    return convertSrjToGraphicsObject(this.inputProblem.inputSrj)
  }

  override finalVisualize(): GraphicsObject {
    return convertSrjToGraphicsObject(this.getOutput())
  }
}
