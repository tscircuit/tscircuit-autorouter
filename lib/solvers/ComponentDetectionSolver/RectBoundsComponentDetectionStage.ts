import { BaseSolver } from "@tscircuit/solver-utils"
import type { GraphicsObject } from "graphics-debug"
import { getStringColor, safeTransparentize } from "lib/solvers/colors"
import type { Obstacle, SimpleRouteJson } from "lib/types"
import { getBoundsForObstacles } from "lib/utils/getBoundsForObstacles"
import type {
  ComponentDetectionSolverOutput,
  ComponentDetectionSolverParams,
  DetectedComponent,
} from "./ComponentDetectionSolver"

const cloneObstacle = (obstacle: Obstacle): Obstacle => ({ ...obstacle })
const cloneObstacles = (obstacles: Obstacle[]) => obstacles.map(cloneObstacle)
const MIN_BGA_AXIS_COUNT = 3
const MIN_BGA_TWO_AXIS_COUNT = 2
const MIN_BGA_LONG_AXIS_COUNT_FOR_TWO_AXIS = 4
const MIN_BGA_GRID_OCCUPANCY = 0.5
const MAX_BGA_PAD_SIZE_VARIANCE = 0.01
const AXIS_CLUSTER_EPSILON = 1e-3
const MIN_QFP_PADS_PER_SIDE = 4
const MAX_QFP_CENTER_NEAREST_SIDE_RATIO = 0.25
const MIN_QFP_PAD_ASPECT_RATIO = 1.5

type ComponentKind = DetectedComponent["componentKind"]

function clusterAxisValues(values: number[]) {
  const sortedValues = [...values].sort((a, b) => a - b)
  const clustered: number[] = []

  for (const value of sortedValues) {
    const previousValue = clustered[clustered.length - 1]
    if (
      previousValue === undefined ||
      Math.abs(value - previousValue) > AXIS_CLUSTER_EPSILON
    ) {
      clustered.push(value)
    }
  }

  return clustered
}

function hasUniformDimensionWithinTolerance(values: number[]) {
  const minValue = Math.min(...values)
  const maxValue = Math.max(...values)

  if (minValue <= 0) return false

  return maxValue / minValue <= 1 + MAX_BGA_PAD_SIZE_VARIANCE
}

function hasUniformPadDimensions(memberObstacles: Obstacle[]) {
  return (
    hasUniformDimensionWithinTolerance(
      memberObstacles.map((obstacle) => obstacle.width),
    ) &&
    hasUniformDimensionWithinTolerance(
      memberObstacles.map((obstacle) => obstacle.height),
    )
  )
}

function isBgaLikeComponent(memberObstacles: Obstacle[]) {
  if (!hasUniformPadDimensions(memberObstacles)) return false

  const rowAxisValues = clusterAxisValues(
    memberObstacles.map((obstacle) => obstacle.center.y),
  )
  const columnAxisValues = clusterAxisValues(
    memberObstacles.map((obstacle) => obstacle.center.x),
  )
  const rowCount = rowAxisValues.length
  const columnCount = columnAxisValues.length
  const gridCellCount = rowCount * columnCount
  const gridOccupancy =
    gridCellCount > 0 ? memberObstacles.length / gridCellCount : 0
  const hasStandardBgaAxisCounts =
    rowCount >= MIN_BGA_AXIS_COUNT && columnCount >= MIN_BGA_AXIS_COUNT
  const hasTwoAxisBgaAxisCounts =
    (rowCount === MIN_BGA_TWO_AXIS_COUNT &&
      columnCount >= MIN_BGA_LONG_AXIS_COUNT_FOR_TWO_AXIS) ||
    (columnCount === MIN_BGA_TWO_AXIS_COUNT &&
      rowCount >= MIN_BGA_LONG_AXIS_COUNT_FOR_TWO_AXIS)
  const hasSupportedAxisCounts =
    hasStandardBgaAxisCounts || hasTwoAxisBgaAxisCounts

  return hasSupportedAxisCounts && gridOccupancy >= MIN_BGA_GRID_OCCUPANCY
}

function getNearestSideCounts(memberObstacles: Obstacle[]) {
  const bounds = getBoundsForObstacles(memberObstacles)
  const width = bounds.maxX - bounds.minX
  const height = bounds.maxY - bounds.minY
  const counts = {
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  }

  if (width <= 0 || height <= 0) return { counts, maxNearestSideRatio: 1 }

  let maxNearestSideRatio = 0

  for (const obstacle of memberObstacles) {
    const distances = [
      {
        side: "top" as const,
        distance: Math.abs(obstacle.center.y - bounds.minY),
        axisSpan: height,
      },
      {
        side: "right" as const,
        distance: Math.abs(bounds.maxX - obstacle.center.x),
        axisSpan: width,
      },
      {
        side: "bottom" as const,
        distance: Math.abs(bounds.maxY - obstacle.center.y),
        axisSpan: height,
      },
      {
        side: "left" as const,
        distance: Math.abs(obstacle.center.x - bounds.minX),
        axisSpan: width,
      },
    ].sort((a, b) => a.distance - b.distance)
    const nearest = distances[0]!

    counts[nearest.side] += 1
    maxNearestSideRatio = Math.max(
      maxNearestSideRatio,
      nearest.distance / nearest.axisSpan,
    )
  }

  return { counts, maxNearestSideRatio }
}

function isQfpLikeComponent(memberObstacles: Obstacle[]) {
  if (memberObstacles.length < MIN_QFP_PADS_PER_SIDE * 4) return false
  if (
    !memberObstacles.every((obstacle) => {
      const minSide = Math.min(obstacle.width, obstacle.height)
      const maxSide = Math.max(obstacle.width, obstacle.height)
      return minSide > 0 && maxSide / minSide >= MIN_QFP_PAD_ASPECT_RATIO
    })
  ) {
    return false
  }

  const { counts, maxNearestSideRatio } = getNearestSideCounts(memberObstacles)

  return (
    counts.top >= MIN_QFP_PADS_PER_SIDE &&
    counts.right >= MIN_QFP_PADS_PER_SIDE &&
    counts.bottom >= MIN_QFP_PADS_PER_SIDE &&
    counts.left >= MIN_QFP_PADS_PER_SIDE &&
    maxNearestSideRatio <= MAX_QFP_CENTER_NEAREST_SIDE_RATIO
  )
}

function detectComponentKind(
  memberObstacles: Obstacle[],
): ComponentKind | null {
  if (isQfpLikeComponent(memberObstacles)) return "qfp"
  if (isBgaLikeComponent(memberObstacles)) return "bga"

  return null
}

/**
 * Current detection stage: groups SRJ obstacles by component and replaces each
 * component's member pads with one rectangular bounds obstacle.
 */
export class RectBoundsComponentDetectionStage extends BaseSolver {
  public readonly inputSrj: SimpleRouteJson

  private initialized = false
  private groupedComponentObstacles: Record<string, Obstacle[]> = {}
  private groupedComponentKinds: Record<string, ComponentKind> = {}
  private unprocessedComponentIds: string[] = []
  private passThroughObstacles: Obstacle[] = []
  private detectedComponents: DetectedComponent[] = []
  private currentComponentId: string | null = null
  private currentMemberObstacles: Obstacle[] = []

  private output: ComponentDetectionSolverOutput | null = null

  constructor({ inputSrj }: ComponentDetectionSolverParams) {
    super()
    this.inputSrj = inputSrj
  }

  override getConstructorParams() {
    return [{ inputSrj: this.inputSrj }] as const
  }

  override _step() {
    if (!this.initialized) {
      this.initializeDetectionState()
      return
    }

    if (this.output) {
      this.solved = true
      return
    }

    if (
      this.currentComponentId !== null ||
      this.unprocessedComponentIds.length > 0
    ) {
      this.processNextComponent()
      return
    }

    this.finalizeOutput()
    this.solved = true
  }

  getOutput(): ComponentDetectionSolverOutput {
    if (!this.output) {
      throw new Error("ComponentDetectionSolver has not solved yet")
    }

    return this.output
  }

  override visualize(): GraphicsObject {
    const rects: NonNullable<GraphicsObject["rects"]> = []

    rects.push(
      ...this.inputSrj.obstacles
        .filter((obstacle) => !obstacle.componentId)
        .map((obstacle) => ({
          center: obstacle.center,
          width: obstacle.width,
          height: obstacle.height,
          fill: "rgba(120, 120, 120, 0.10)",
          stroke: "rgba(120, 120, 120, 0.40)",
          label: obstacle.obstacleId,
          layer: obstacle.layers.join(","),
          step: 0,
        })),
    )

    const finalizedComponentIds = new Set(
      this.detectedComponents.map((component) => component.componentId),
    )

    for (const obstacle of this.inputSrj.obstacles) {
      if (!obstacle.componentId) continue
      if (finalizedComponentIds.has(obstacle.componentId)) continue

      const isActive = obstacle.componentId === this.currentComponentId
      const color = getStringColor(obstacle.componentId)
      const componentKind = this.groupedComponentKinds[obstacle.componentId]
      rects.push({
        center: obstacle.center,
        width: obstacle.width,
        height: obstacle.height,
        fill: isActive
          ? safeTransparentize(color, 0.55)
          : safeTransparentize(color, 0.82),
        stroke: isActive
          ? safeTransparentize(color, 0.1)
          : safeTransparentize(color, 0.45),
        label: componentKind
          ? `${obstacle.componentId} ${componentKind.toUpperCase()}`
          : obstacle.componentId,
        layer: obstacle.layers.join(","),
        step: isActive ? 1 : 0,
      })
    }

    for (const component of this.detectedComponents) {
      const color = getStringColor(component.componentId)

      rects.push(
        ...component.memberObstacles.map((obstacle) => ({
          center: obstacle.center,
          width: obstacle.width,
          height: obstacle.height,
          fill: safeTransparentize(color, 0.7),
          stroke: safeTransparentize(color, 0.25),
          label: `${component.componentId} ${component.componentKind.toUpperCase()}`,
          layer: obstacle.layers.join(","),
          step: 1,
        })),
      )

      rects.push({
        center: component.replacementObstacle.center,
        width: component.replacementObstacle.width,
        height: component.replacementObstacle.height,
        fill: safeTransparentize(color, 0.88),
        stroke: safeTransparentize(color, 0.1),
        label: `${component.componentId} ${component.componentKind.toUpperCase()} region`,
        layer: component.replacementObstacle.layers.join(","),
        step: 2,
      })
    }

    return {
      title: this.getVisualizationTitle(),
      rects,
      lines: [],
      points: [],
      circles: [],
    }
  }

  override preview(): GraphicsObject {
    return this.visualize()
  }

  private initializeDetectionState() {
    this.initialized = true
    this.groupedComponentKinds = {}
    this.groupedComponentObstacles = this.groupObstaclesByComponentId({
      obstacles: this.inputSrj.obstacles,
    })
    this.unprocessedComponentIds = Object.keys(
      this.groupedComponentObstacles,
    ).sort()
    const componentIds = new Set(this.unprocessedComponentIds)
    this.passThroughObstacles = this.inputSrj.obstacles
      .filter(
        (obstacle) =>
          !obstacle.componentId || !componentIds.has(obstacle.componentId),
      )
      .map(cloneObstacle)
    this.detectedComponents = []
    this.currentComponentId = null
    this.currentMemberObstacles = []
    this.output = null
  }

  private processNextComponent() {
    if (!this.currentComponentId) {
      const nextComponentId = this.unprocessedComponentIds.shift()
      if (!nextComponentId) {
        this.currentComponentId = null
        this.currentMemberObstacles = []
        return
      }

      this.currentComponentId = nextComponentId
      this.currentMemberObstacles =
        this.groupedComponentObstacles[nextComponentId] ?? []
      return
    }

    if (this.currentMemberObstacles.length === 0) {
      this.currentComponentId = null
      this.currentMemberObstacles = []
      return
    }

    this.detectedComponents.push(
      this.createDetectedComponent({
        componentId: this.currentComponentId,
        componentKind: this.groupedComponentKinds[this.currentComponentId]!,
        memberObstacles: this.currentMemberObstacles,
      }),
    )

    this.currentComponentId = null
    this.currentMemberObstacles = []
  }

  private finalizeOutput() {
    this.output = {
      global: {
        ...this.inputSrj,
        obstacles: [
          ...cloneObstacles(this.passThroughObstacles),
          ...this.detectedComponents.map(({ replacementObstacle }) => ({
            ...replacementObstacle,
          })),
        ],
      },
      components: this.detectedComponents.map((component) => ({
        ...component,
        memberObstacleIds: [...component.memberObstacleIds],
        memberObstacles: component.memberObstacles.map((obstacle) => ({
          ...obstacle,
        })),
        replacementObstacle: { ...component.replacementObstacle },
      })),
    }

    this.stats = {
      initialized: this.initialized,
      totalComponentCount: Object.keys(this.groupedComponentObstacles).length,
      detectedComponentCount: this.detectedComponents.length,
      detectedBgaComponentCount: this.detectedComponents.filter(
        (component) => component.componentKind === "bga",
      ).length,
      detectedQfpComponentCount: this.detectedComponents.filter(
        (component) => component.componentKind === "qfp",
      ).length,
      detectedQfpComponentIds: this.detectedComponents
        .filter((component) => component.componentKind === "qfp")
        .map((component) => component.componentId),
      remainingComponentCount: this.unprocessedComponentIds.length,
      hasActiveComponent: this.currentComponentId !== null,
      replacedObstacleCount: this.detectedComponents.reduce(
        (count, component) => count + component.memberObstacles.length,
        0,
      ),
      passThroughObstacleCount: this.passThroughObstacles.length,
    }
  }

  private groupObstaclesByComponentId({
    obstacles,
  }: {
    obstacles: Obstacle[]
  }): Record<string, Obstacle[]> {
    const grouped: Record<string, Obstacle[]> = {}
    const componentKinds: Record<string, ComponentKind> = {}

    for (const obstacle of obstacles) {
      if (!obstacle.componentId) continue
      grouped[obstacle.componentId] ??= []
      grouped[obstacle.componentId].push(obstacle)
    }

    const detectedEntries = Object.entries(grouped).filter(
      ([componentId, memberObstacles]) => {
        const componentKind = detectComponentKind(memberObstacles)
        if (!componentKind) return false

        componentKinds[componentId] = componentKind
        return true
      },
    )

    this.groupedComponentKinds = componentKinds

    return Object.fromEntries(detectedEntries)
  }

  private createDetectedComponent({
    componentId,
    componentKind,
    memberObstacles,
  }: {
    componentId: string
    componentKind: ComponentKind
    memberObstacles: Obstacle[]
  }): DetectedComponent {
    const copiedMemberObstacles = cloneObstacles(memberObstacles)
    const bounds = getBoundsForObstacles(copiedMemberObstacles)
    const replacementObstacle = this.createReplacementObstacle({
      componentId,
      memberObstacles: copiedMemberObstacles,
      bounds,
    })

    return {
      componentId,
      componentKind,
      memberObstacleIds: copiedMemberObstacles.map(
        (obstacle, index) =>
          obstacle.obstacleId ?? `${componentId}:member:${index}`,
      ),
      memberObstacles: copiedMemberObstacles,
      replacementObstacle,
    }
  }

  private getVisualizationTitle() {
    const totalCount =
      Object.keys(this.groupedComponentObstacles).length ||
      new Set(
        this.inputSrj.obstacles
          .map((obstacle) => obstacle.componentId)
          .filter((componentId): componentId is string => Boolean(componentId)),
      ).size
    const completedCount = this.detectedComponents.length

    if (!this.initialized) {
      return "Component Detection: setup"
    }

    if (this.output || this.solved) {
      return `Component Detection: done ${completedCount}/${totalCount}`
    }

    if (
      this.currentComponentId !== null ||
      this.unprocessedComponentIds.length > 0
    ) {
      return `Component Detection: ${completedCount}/${totalCount} processed`
    }

    return `Component Detection: finalizing ${completedCount}/${totalCount}`
  }

  private createReplacementObstacle({
    componentId,
    memberObstacles,
    bounds,
  }: {
    componentId: string
    memberObstacles: Obstacle[]
    bounds: SimpleRouteJson["bounds"]
  }): Obstacle {
    const layers = Array.from(
      new Set(memberObstacles.flatMap((obstacle) => obstacle.layers)),
    )
    const connectedTo = Array.from(
      new Set(memberObstacles.flatMap((obstacle) => obstacle.connectedTo)),
    )

    return {
      obstacleId: `component-region:${componentId}`,
      componentId,
      type: "rect",
      layers,
      center: {
        x: (bounds.minX + bounds.maxX) / 2,
        y: (bounds.minY + bounds.maxY) / 2,
      },
      width: bounds.maxX - bounds.minX,
      height: bounds.maxY - bounds.minY,
      connectedTo,
    }
  }
}
