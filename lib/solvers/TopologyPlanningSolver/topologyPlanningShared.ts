import {
  type Bounds,
  doBoundsOverlap,
  getBoundFromCenteredRect,
  getBoundingBox,
} from "@tscircuit/math-utils"
import { BaseSolver } from "@tscircuit/solver-utils"
import type { GraphicsObject } from "graphics-debug"
import type { ComponentKind } from "lib/solvers/ComponentDetectionSolver/detectors/types"
import {
  TopologyGenerator,
  type TopologyGeneratorSolver,
} from "lib/solvers/TopologyPlanningSolver/TopologyGenerator"
import type { CapacityMeshNode, Obstacle, SimpleRouteJson } from "lib/types"
import { getBoundsForObstacles } from "lib/utils/getBoundsForObstacles"
import "lib/solvers/BgaTopologyGeneratorSolver/BgaTopologyGeneratorSolver"
import "lib/solvers/QfpThermalPadTopologyGeneratorSolver/QfpThermalPadTopologyGeneratorSolver"
import "lib/solvers/QfpTopologyGeneratorSolver/QfpTopologyGeneratorSolver"
import "lib/solvers/SoicTopologyGeneratorSolver/SoicTopologyGeneratorSolver"
import type {
  MultiGraphTopologyPlannerSolverParams,
  SerializedTopologyComponentInput,
  TopologyMeshMergeStrategy,
} from "./MultiGraphTopologyPlannerSolver"

export interface NormalizedTopologyPlannerInput {
  globalNoConnectionSrj: SimpleRouteJson
  components: SerializedTopologyComponentInput[]
}

export interface ComponentTopologyBatchSolverParams {
  componentSrjs: SimpleRouteJson[]
  componentIds: string[]
  componentKinds: Array<ComponentKind | undefined>
  replacementObstacleIds: Array<string | undefined>
  viaDiameter?: number
  obstacleMargin?: number
}

export interface ComponentTopologyBatchSolverOutput {
  componentMeshNodes: CapacityMeshNode[][]
}

/**
 * Builds the component-local SRJ passed into BGA topology generation.
 *
 * Important:
 * - component bounds come from the detected member obstacles.
 * - only original SRJ obstacles whose geometry overlaps those bounds are
 *   included in the component-local topology solve.
 * - included obstacle geometry is copied from the original SRJ unchanged.
 * - electrically connected obstacles outside the component bounds remain part
 *   of the global topology, not the component-local BGA matrix.
 */
export function createComponentSrj({
  inputSrj,
  component,
}: {
  inputSrj: SimpleRouteJson
  component: SerializedTopologyComponentInput
}): SimpleRouteJson {
  const obstacleBounds = getBoundsForObstacles(component.memberObstacles)
  const localPointMargin = Math.max(
    inputSrj.minViaPadDiameter ??
      inputSrj.min_via_pad_diameter ??
      inputSrj.minViaDiameter ??
      0.3,
    inputSrj.defaultObstacleMargin ?? 0.15,
    inputSrj.minTraceWidth * 2,
  )
  const memberConnectionIds = new Set(
    component.memberObstacles.flatMap((obstacle) => obstacle.connectedTo),
  )
  const connectedPoints = inputSrj.connections.flatMap((connection) =>
    connection.pointsToConnect.filter((point) => {
      const pointIds = [point.pointId, point.pcb_port_id].filter(
        (pointId): pointId is string => typeof pointId === "string",
      )
      const isConnectedToComponent = pointIds.some((pointId) =>
        memberConnectionIds.has(pointId),
      )
      const isNearComponentBounds =
        point.x >= obstacleBounds.minX - localPointMargin &&
        point.x <= obstacleBounds.maxX + localPointMargin &&
        point.y >= obstacleBounds.minY - localPointMargin &&
        point.y <= obstacleBounds.maxY + localPointMargin

      return isConnectedToComponent && isNearComponentBounds
    }),
  )
  const componentBounds = connectedPoints.reduce(
    (bounds, point) => ({
      minX: Math.min(bounds.minX, point.x),
      maxX: Math.max(bounds.maxX, point.x),
      minY: Math.min(bounds.minY, point.y),
      maxY: Math.max(bounds.maxY, point.y),
    }),
    obstacleBounds,
  )
  const componentObstacles = inputSrj.obstacles
    .filter((obstacle) =>
      doBoundsOverlap(getBoundingBox(obstacle), componentBounds),
    )
    .filter(
      (obstacle) =>
        obstacle.obstacleId !== component.replacementObstacle.obstacleId,
    )
    .map((obstacle) => ({ ...obstacle }))
  const componentObstaclesByKey = new Map<string, Obstacle>()

  for (const obstacle of [
    ...component.memberObstacles,
    ...componentObstacles,
  ]) {
    componentObstaclesByKey.set(
      obstacle.obstacleId ??
        `${obstacle.componentId ?? "obstacle"}:${obstacle.center.x}:${obstacle.center.y}:${obstacle.width}:${obstacle.height}`,
      { ...obstacle },
    )
  }

  return {
    ...structuredClone(inputSrj),
    bounds: componentBounds,
    obstacles: Array.from(componentObstaclesByKey.values()),
  }
}

/** Normalizes the supported input forms into the planner's internal representation. */
export function normalizeInput(
  input: MultiGraphTopologyPlannerSolverParams,
): NormalizedTopologyPlannerInput {
  const globalNoConnectionSrj =
    input.globalNoConnectionSrj ??
    input.componentDetectionOutput?.componentsAsObstaclesSrj ??
    input.brokenSrj?.componentsAsObstaclesSrj
  const components =
    input.components ??
    input.componentDetectionOutput?.components ??
    input.brokenSrj?.components ??
    []

  if (!globalNoConnectionSrj) {
    throw new Error(
      "MultiGraphTopologyPlannerSolver requires globalNoConnectionSrj or componentDetectionOutput.componentsAsObstaclesSrj",
    )
  }

  return {
    globalNoConnectionSrj,
    components,
  }
}

/**
 * Replaces the global component-region node with the finer component-local
 * routing regions.
 */
export function mergeMeshNodes({
  globalMeshNodes,
  components,
  componentMeshNodes,
  mergeStrategy,
}: {
  globalMeshNodes: CapacityMeshNode[]
  components: SerializedTopologyComponentInput[]
  componentMeshNodes: CapacityMeshNode[][]
  mergeStrategy: TopologyMeshMergeStrategy
}): CapacityMeshNode[] {
  switch (mergeStrategy) {
    case "concat":
      return [
        ...globalMeshNodes.filter(
          (node) =>
            !components.some((component) =>
              isReplacementRegionNode({ node, component }),
            ),
        ),
        ...componentMeshNodes.flat(),
      ]
  }
}

/**
 * Removes global RectDiff mesh nodes that are fully covered by component-local
 * replacement areas.
 *
 * @param params.meshNodes - Global RectDiff capacity nodes before component
 *   mesh substitution.
 * @param params.components - Detected topology components whose replacement
 *   obstacles define the component-local routing areas.
 * @returns A filtered mesh node array. Nodes that merely overlap a component
 *   area are preserved; only nodes whose entire rectangle is contained in a
 *   replacement obstacle are removed.
 *
 * @note This is intentionally applied before `mergeMeshNodes` so downstream
 * solvers do not see duplicate global and component-local routing regions.
 * @caution Replacement obstacles are expected to be axis-aligned rectangles.
 */
export function filterMeshNodesInsideComponentAreas({
  meshNodes,
  components,
}: {
  meshNodes: CapacityMeshNode[]
  components: SerializedTopologyComponentInput[]
}): CapacityMeshNode[] {
  if (components.length === 0) return meshNodes

  return meshNodes.filter(
    (meshNode) =>
      !components.some((component) =>
        isMeshNodeFullyInsideObstacle({
          meshNode,
          obstacle: component.replacementObstacle,
        }),
      ),
  )
}

type GraphicsRect = NonNullable<GraphicsObject["rects"]>[number]

/**
 * Removes RectDiff node rectangles from a graphics-debug visualization when
 * those rectangles are fully contained inside component replacement areas.
 *
 * @param params.rects - Visualization rectangles, typically from the nested
 *   RectDiff stage inside topology planning.
 * @param params.components - Detected topology components whose replacement
 *   obstacles define regions that are redrawn by component-local topology.
 * @returns The original `rects` reference when there is nothing to filter;
 *   otherwise a filtered array without covered RectDiff node rectangles.
 *
 * @note Only labels beginning with `"node "` are treated as RectDiff node
 *   rectangles. Component obstacle overlays and merged topology rectangles are
 *   left untouched.
 * @caution This is a visualization-only filter. Keep the mesh-node filter above
 *   in sync when changing containment semantics.
 */
export function filterRectDiffNodeRectsInsideComponentAreas({
  rects,
  components,
}: {
  rects: GraphicsRect[] | undefined
  components: SerializedTopologyComponentInput[]
}): GraphicsRect[] | undefined {
  if (!rects || components.length === 0) return rects

  return rects.filter(
    (rect) =>
      !isRectDiffNodeRect(rect) ||
      !components.some((component) =>
        isRectFullyInsideObstacle({
          rect,
          obstacle: component.replacementObstacle,
        }),
      ),
  )
}

/** Matches a global routing region against a detected component replacement obstacle. */
function isReplacementRegionNode({
  node,
  component,
}: {
  node: CapacityMeshNode
  component: SerializedTopologyComponentInput
}) {
  const { replacementObstacle } = component
  const epsilon = 1e-9
  const isExactReplacementNode =
    Math.abs(node.center.x - replacementObstacle.center.x) <= epsilon &&
    Math.abs(node.center.y - replacementObstacle.center.y) <= epsilon &&
    Math.abs(node.width - replacementObstacle.width) <= epsilon &&
    Math.abs(node.height - replacementObstacle.height) <= epsilon

  if (
    component.componentKind !== "qfp" &&
    component.componentKind !== "qfp_thermalpad" &&
    component.componentKind !== "soic"
  ) {
    return isExactReplacementNode
  }

  const replacementMinX =
    replacementObstacle.center.x - replacementObstacle.width / 2
  const replacementMaxX =
    replacementObstacle.center.x + replacementObstacle.width / 2
  const replacementMinY =
    replacementObstacle.center.y - replacementObstacle.height / 2
  const replacementMaxY =
    replacementObstacle.center.y + replacementObstacle.height / 2
  const nodeCenterInsideReplacement =
    node.center.x >= replacementMinX - epsilon &&
    node.center.x <= replacementMaxX + epsilon &&
    node.center.y >= replacementMinY - epsilon &&
    node.center.y <= replacementMaxY + epsilon

  return nodeCenterInsideReplacement || isExactReplacementNode
}

/**
 * Detects whether a graphics rectangle came from RectDiff's node renderer.
 *
 * @param rect - A graphics-debug rectangle from a combined visualization.
 * @returns `true` when the rectangle label follows RectDiff's `"node ..."`
 *   label convention; otherwise `false`.
 *
 * @note This label check prevents the visualization filter from removing
 * component pads, obstacle overlays, or merged topology rectangles.
 */
function isRectDiffNodeRect(rect: GraphicsRect) {
  return typeof rect.label === "string" && rect.label.startsWith("node ")
}

/**
 * Checks whether a capacity mesh node is fully contained by a component
 * replacement obstacle.
 *
 * @param params.meshNode - Capacity mesh node represented as a centered
 *   rectangle.
 * @param params.obstacle - Component replacement obstacle used as the containing
 *   rectangle.
 * @returns `true` when the node rectangle is fully inside the obstacle bounds;
 *   otherwise `false`.
 */
function isMeshNodeFullyInsideObstacle({
  meshNode,
  obstacle,
}: {
  meshNode: CapacityMeshNode
  obstacle: Obstacle
}) {
  return isRectFullyInsideObstacle({
    rect: {
      center: meshNode.center,
      width: meshNode.width,
      height: meshNode.height,
    },
    obstacle,
  })
}

/**
 * Checks whether a centered rectangle is fully contained by a replacement
 * obstacle.
 *
 * @param params.rect - Candidate rectangle with `center`, `width`, and
 *   `height`; incomplete rectangles return `false`.
 * @param params.obstacle - Axis-aligned obstacle that may contain `rect`.
 * @returns `true` when the rectangle's computed bounds are fully inside the
 *   obstacle's computed bounds; otherwise `false`.
 *
 * @note Uses `getBoundFromCenteredRect` from `@tscircuit/math-utils` to avoid
 * hand-rolled centered-rectangle bound construction.
 */
function isRectFullyInsideObstacle({
  rect,
  obstacle,
}: {
  rect: {
    center?: { x: number; y: number }
    width?: number
    height?: number
  }
  obstacle: Obstacle
}) {
  if (!rect.center || rect.width === undefined || rect.height === undefined) {
    return false
  }

  const epsilon = 1e-9
  const rectBounds = getBoundFromCenteredRect({
    center: rect.center,
    width: rect.width,
    height: rect.height,
  })
  const obstacleBounds = getBoundFromCenteredRect({
    center: obstacle.center,
    width: obstacle.width,
    height: obstacle.height,
  })

  return areBoundsInsideBounds({
    bounds: rectBounds,
    outerBounds: obstacleBounds,
    epsilon,
  })
}

/**
 * Checks whether one axis-aligned bounds rectangle is fully contained by
 * another bounds rectangle.
 *
 * @param params.bounds - Inner bounds expected to be contained.
 * @param params.outerBounds - Outer bounds that may contain `bounds`.
 * @param params.epsilon - Numeric tolerance applied to each edge comparison.
 * @returns `true` when every edge of `bounds` is inside `outerBounds`, allowing
 *   the supplied epsilon; otherwise `false`.
 *
 * @note `@tscircuit/math-utils` currently provides overlap/intersection
 * helpers, while full bounds containment still needs explicit edge comparison.
 */
function areBoundsInsideBounds({
  bounds,
  outerBounds,
  epsilon,
}: {
  bounds: Bounds
  outerBounds: Bounds
  epsilon: number
}) {
  return (
    bounds.minX >= outerBounds.minX - epsilon &&
    bounds.maxX <= outerBounds.maxX + epsilon &&
    bounds.minY >= outerBounds.minY - epsilon &&
    bounds.maxY <= outerBounds.maxY + epsilon
  )
}

/** Runs one component-local topology solve per component SRJ and collects the routing regions. */
export class ComponentTopologyBatchSolver extends BaseSolver {
  activeSubSolver?: TopologyGeneratorSolver | null = null
  currentIndex = 0
  componentMeshNodes: CapacityMeshNode[][] = []

  constructor(
    public readonly inputProblem: ComponentTopologyBatchSolverParams,
  ) {
    super()
  }

  override getConstructorParams() {
    return [this.inputProblem] as const
  }

  /** Steps through component solves sequentially to keep solver state simple and explicit. */
  override _step() {
    if (this.activeSubSolver) {
      this.activeSubSolver.step()

      if (this.activeSubSolver.failed) {
        this.error = this.activeSubSolver.error
        this.failed = true
        this.activeSubSolver = null
        return
      }

      if (!this.activeSubSolver.solved) return

      this.componentMeshNodes.push(
        this.activeSubSolver.getOutput().routingRegions,
      )
      this.currentIndex += 1
      this.activeSubSolver = null
      return
    }

    if (this.currentIndex >= this.inputProblem.componentSrjs.length) {
      this.solved = true
      return
    }

    const componentKind =
      this.inputProblem.componentKinds[this.currentIndex] ?? "bga"
    const solverInput = {
      inputSrj: this.inputProblem.componentSrjs[this.currentIndex]!,
      componentId: this.inputProblem.componentIds[this.currentIndex],
      replacementObstacleId:
        this.inputProblem.replacementObstacleIds[this.currentIndex],
      viaDiameter: this.inputProblem.viaDiameter,
      obstacleMargin: this.inputProblem.obstacleMargin,
    }
    this.activeSubSolver = TopologyGenerator.create(componentKind, solverInput)
  }

  getOutput(): ComponentTopologyBatchSolverOutput {
    return {
      componentMeshNodes: this.componentMeshNodes,
    }
  }
}
