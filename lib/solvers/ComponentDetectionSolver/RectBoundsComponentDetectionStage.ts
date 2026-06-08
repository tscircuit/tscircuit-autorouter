import { doBoundsOverlap, getBoundingBox } from "@tscircuit/math-utils"
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
import { detectComponentKind, type ComponentKind } from "./detectors"

const cloneObstacle = (obstacle: Obstacle): Obstacle => ({ ...obstacle })
const cloneObstacles = (obstacles: Obstacle[]) => obstacles.map(cloneObstacle)
/**
 * Checks whether an original obstacle intersects a detected component
 * replacement obstacle.
 *
 * @param params.obstacle - Candidate global obstacle that may need to be
 *   removed from the global no-connection SRJ.
 * @param params.replacementObstacle - Component-region obstacle that replaces
 *   the component's member pads in the global topology solve.
 * @returns `true` when the obstacle bounds overlap the replacement obstacle
 *   bounds; otherwise `false`.
 *
 * @note This uses bounding boxes so the global SRJ does not retain pass-through
 * obstacles underneath component-local routing regions.
 */
const doObstaclesOverlap = ({
  obstacle,
  replacementObstacle,
}: {
  obstacle: Obstacle
  replacementObstacle: Obstacle
}) =>
  doBoundsOverlap(getBoundingBox(obstacle), getBoundingBox(replacementObstacle))

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
    const replacementObstacles = this.detectedComponents.map(
      ({ replacementObstacle }) => replacementObstacle,
    )
    const globalObstacles = this.passThroughObstacles.filter(
      (obstacle) =>
        !replacementObstacles.some((replacementObstacle) =>
          doObstaclesOverlap({ obstacle, replacementObstacle }),
        ),
    )

    this.output = {
      componentsAsObstaclesSrj: {
        ...this.inputSrj,
        obstacles: [
          ...cloneObstacles(globalObstacles),
          ...cloneObstacles(replacementObstacles),
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
      detectedQfpThermalPadComponentCount: this.detectedComponents.filter(
        (component) => component.componentKind === "qfp_thermalpad",
      ).length,
      detectedQfpThermalPadComponentIds: this.detectedComponents
        .filter((component) => component.componentKind === "qfp_thermalpad")
        .map((component) => component.componentId),
      detectedSoicComponentCount: this.detectedComponents.filter(
        (component) => component.componentKind === "soic",
      ).length,
      detectedSoicComponentIds: this.detectedComponents
        .filter((component) => component.componentKind === "soic")
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
        const componentKind = detectComponentKind({
          memberObstacles,
          inputSrj: this.inputSrj,
        })
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
