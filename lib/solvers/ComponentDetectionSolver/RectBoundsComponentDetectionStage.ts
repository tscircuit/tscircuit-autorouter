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
const MIN_BGA_MEMBER_OBSTACLE_COUNT = 9
const MIN_BGA_AXIS_COUNT = 3
const MIN_BGA_GRID_OCCUPANCY = 0.5
const AXIS_CLUSTER_EPSILON = 1e-3

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

function isBgaLikeComponent(memberObstacles: Obstacle[]) {
  if (memberObstacles.length < MIN_BGA_MEMBER_OBSTACLE_COUNT) return false

  const rowCount = clusterAxisValues(
    memberObstacles.map((obstacle) => obstacle.center.y),
  ).length
  const columnCount = clusterAxisValues(
    memberObstacles.map((obstacle) => obstacle.center.x),
  ).length
  const gridCellCount = rowCount * columnCount
  const gridOccupancy =
    gridCellCount > 0 ? memberObstacles.length / gridCellCount : 0

  return (
    rowCount >= MIN_BGA_AXIS_COUNT &&
    columnCount >= MIN_BGA_AXIS_COUNT &&
    gridOccupancy >= MIN_BGA_GRID_OCCUPANCY
  )
}

/**
 * Current detection stage: groups SRJ obstacles by component and replaces each
 * component's member pads with one rectangular bounds obstacle.
 */
export class RectBoundsComponentDetectionStage extends BaseSolver {
  public readonly inputSrj: SimpleRouteJson

  private initialized = false
  private groupedComponentObstacles: Record<string, Obstacle[]> = {}
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
        label: obstacle.componentId,
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
          label: component.componentId,
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
        label: `${component.componentId} region`,
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

    for (const obstacle of obstacles) {
      if (!obstacle.componentId) continue
      grouped[obstacle.componentId] ??= []
      grouped[obstacle.componentId].push(obstacle)
    }

    return Object.fromEntries(
      Object.entries(grouped).filter(([, memberObstacles]) =>
        isBgaLikeComponent(memberObstacles),
      ),
    )
  }

  private createDetectedComponent({
    componentId,
    memberObstacles,
  }: {
    componentId: string
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
