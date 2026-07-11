import { getBoundingBox } from "@tscircuit/math-utils"
import { BaseSolver } from "@tscircuit/solver-utils"
import type { GraphicsObject } from "graphics-debug"
import { getStringColor, safeTransparentize } from "lib/solvers/colors"
import { areBoundsInsideBounds } from "lib/solvers/TopologyPlanningSolver/topologyPlanningShared"
import type { Obstacle, SimpleRouteJson } from "lib/types"
import { getBoundsForObstacles } from "lib/utils/getBoundsForObstacles"
import type {
  ComponentDetectionSolverOutput,
  ComponentDetectionSolverParams,
  DetectedComponent,
} from "./ComponentDetectionSolver"
import { detectComponentKind, type ComponentKind } from "./detectors"
import { isQfpPerimeterPadObstacle } from "./detectors/qfp/qfpShared"

// Component-local topologies cannot overlap. The old detector's 32-pad cap
// incidentally kept high-pin overlapping footprints in the global topology.
const MAX_QFP_PADS_WITHOUT_OVERLAP_GUARD = 32

function doDetectedComponentBoundsOverlap(
  first: DetectedComponent,
  second: DetectedComponent,
): boolean {
  return (
    first.bounds.minX < second.bounds.maxX &&
    first.bounds.maxX > second.bounds.minX &&
    first.bounds.minY < second.bounds.maxY &&
    first.bounds.maxY > second.bounds.minY
  )
}

function hasHighPinCountQfpPads(memberObstacles: Obstacle[]): boolean {
  const qfpPerimeterPadCount = memberObstacles.filter(
    isQfpPerimeterPadObstacle,
  ).length
  return qfpPerimeterPadCount > MAX_QFP_PADS_WITHOUT_OVERLAP_GUARD
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
      rects.push({
        center: {
          x: (component.bounds.minX + component.bounds.maxX) / 2,
          y: (component.bounds.minY + component.bounds.maxY) / 2,
        },
        width: component.bounds.maxX - component.bounds.minX,
        height: component.bounds.maxY - component.bounds.minY,
        fill: safeTransparentize(color, 0.88),
        stroke: safeTransparentize(color, 0.1),
        label: `${component.componentId} ${component.componentKind.toUpperCase()} region`,
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
    const overlappingComponentIds = new Set<string>()
    for (let index = 0; index < this.detectedComponents.length; index += 1) {
      const component = this.detectedComponents[index]!
      for (
        let otherIndex = index + 1;
        otherIndex < this.detectedComponents.length;
        otherIndex += 1
      ) {
        const otherComponent = this.detectedComponents[otherIndex]!
        if (!doDetectedComponentBoundsOverlap(component, otherComponent)) {
          continue
        }
        const componentMemberObstacles =
          this.groupedComponentObstacles[component.componentId] ?? []
        if (
          (component.componentKind === "qfp" ||
            component.componentKind === "qfp_thermalpad") &&
          hasHighPinCountQfpPads(componentMemberObstacles)
        ) {
          overlappingComponentIds.add(component.componentId)
        }
        const otherComponentMemberObstacles =
          this.groupedComponentObstacles[otherComponent.componentId] ?? []
        if (
          (otherComponent.componentKind === "qfp" ||
            otherComponent.componentKind === "qfp_thermalpad") &&
          hasHighPinCountQfpPads(otherComponentMemberObstacles)
        ) {
          overlappingComponentIds.add(otherComponent.componentId)
        }
      }
    }
    this.detectedComponents = this.detectedComponents.filter(
      (component) => !overlappingComponentIds.has(component.componentId),
    )
    this.output = this.detectedComponents.map((component) => ({
      ...component,
      bounds: { ...component.bounds },
    }))

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
      overlappingDetectedComponentCount: overlappingComponentIds.size,
      overlappingDetectedComponentIds: [...overlappingComponentIds].sort(),
      remainingComponentCount: this.unprocessedComponentIds.length,
      hasActiveComponent: this.currentComponentId !== null,
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
        const boardBounds = this.inputSrj.bounds
        const hasOutOfBoundsObstacle = memberObstacles.some((obstacle) => {
          const obstacleBounds = getBoundingBox(obstacle)

          return !areBoundsInsideBounds({
            bounds: obstacleBounds,
            outerBounds: boardBounds,
            epsilon: 0,
          })
        })

        if (hasOutOfBoundsObstacle) {
          return false
        }

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
    const bounds = getBoundsForObstacles(memberObstacles)

    return {
      componentId,
      componentKind,
      bounds: {
        __type: "rect",
        ...bounds,
      },
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
}
