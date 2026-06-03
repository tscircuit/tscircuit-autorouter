import {
  type Bounds,
  doBoundsOverlap,
  getBoundFromCenteredRect,
  getBoundingBox,
} from "@tscircuit/math-utils"
import { BaseSolver } from "@tscircuit/solver-utils"
import type { GraphicsObject } from "graphics-debug"
import { BgaTopologyGeneratorSolver } from "lib/solvers/BgaTopologyGeneratorSolver/BgaTopologyGeneratorSolver"
import { QfpThermalPadTopologyGeneratorSolver } from "lib/solvers/QfpThermalPadTopologyGeneratorSolver/QfpThermalPadTopologyGeneratorSolver"
import { QfpTopologyGeneratorSolver } from "lib/solvers/QfpTopologyGeneratorSolver/QfpTopologyGeneratorSolver"
import { SoicTopologyGeneratorSolver } from "lib/solvers/SoicTopologyGeneratorSolver/SoicTopologyGeneratorSolver"
import type { CapacityMeshNode, Obstacle, SimpleRouteJson } from "lib/types"
import { getBoundsForObstacles } from "lib/utils/getBoundsForObstacles"
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
  componentKinds: Array<"bga" | "qfp" | "qfp_thermalpad" | "soic" | undefined>
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
    .map((obstacle) => ({ ...obstacle }))

  return {
    ...structuredClone(inputSrj),
    bounds: componentBounds,
    obstacles: componentObstacles,
  }
}

/** Normalizes the supported input forms into the planner's internal representation. */
export function normalizeInput(
  input: MultiGraphTopologyPlannerSolverParams,
): NormalizedTopologyPlannerInput {
  const globalNoConnectionSrj =
    input.globalNoConnectionSrj ??
    input.componentDetectionOutput?.global ??
    input.brokenSrj?.global
  const components =
    input.components ??
    input.componentDetectionOutput?.components ??
    input.brokenSrj?.components ??
    []

  if (!globalNoConnectionSrj) {
    throw new Error(
      "MultiGraphTopologyPlannerSolver requires globalNoConnectionSrj or componentDetectionOutput.global",
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

export function mergeNestedComponentMeshNodes({
  components,
  componentMeshNodes,
  componentSrjs,
}: {
  components: SerializedTopologyComponentInput[]
  componentMeshNodes: CapacityMeshNode[][]
  componentSrjs?: SimpleRouteJson[]
}): CapacityMeshNode[][] {
  return componentMeshNodes.map((nodes, componentIndex) => {
    const parentComponent = components[componentIndex]
    if (!parentComponent) return nodes

    const childComponents = components.filter(
      (component, candidateIndex) =>
        candidateIndex !== componentIndex &&
        isObstacleInsideObstacle({
          inner: component.replacementObstacle,
          outer: parentComponent.replacementObstacle,
        }),
    )

    const nestedComponentNodes =
      childComponents.length === 0
        ? nodes
        : nodes.flatMap((node) =>
            childComponents.reduce(
              (splitNodes, childComponent) =>
                splitNodes.flatMap((splitNode) =>
                  splitNodeAroundNestedComponent({
                    node: splitNode,
                    childComponent,
                  }),
                ),
              [node],
            ),
          )

    const extraObstacles = getExtraComponentLocalObstacles({
      component: parentComponent,
      components,
      componentSrj: componentSrjs?.[componentIndex],
    })

    if (extraObstacles.length === 0) return nestedComponentNodes

    return nestedComponentNodes.flatMap((node) =>
      extraObstacles.reduce(
        (splitNodes, obstacle, obstacleIndex) =>
          splitNodes.flatMap((splitNode) =>
            splitNodeAroundExtraObstacle({
              node: splitNode,
              componentId: parentComponent.componentId,
              obstacle,
              obstacleIndex,
            }),
          ),
        [node],
      ),
    )
  })
}

function getExtraComponentLocalObstacles({
  component,
  components,
  componentSrj,
}: {
  component: SerializedTopologyComponentInput
  components: SerializedTopologyComponentInput[]
  componentSrj: SimpleRouteJson | undefined
}) {
  if (!componentSrj) return []

  const memberObstacleIds = new Set(component.memberObstacleIds)
  const childComponents = components.filter(
    (candidate) =>
      candidate.componentId !== component.componentId &&
      isObstacleInsideObstacle({
        inner: candidate.replacementObstacle,
        outer: component.replacementObstacle,
      }),
  )

  return componentSrj.obstacles.filter((obstacle) => {
    if (obstacle.componentId === component.componentId) return false
    if (obstacle.obstacleId && memberObstacleIds.has(obstacle.obstacleId)) {
      return false
    }
    if (
      childComponents.some((childComponent) =>
        isObstacleInsideObstacle({
          inner: obstacle,
          outer: childComponent.replacementObstacle,
        }),
      )
    ) {
      return false
    }

    return isObstacleInsideObstacle({
      inner: obstacle,
      outer: component.replacementObstacle,
    })
  })
}

function splitNodeAroundNestedComponent({
  node,
  childComponent,
}: {
  node: CapacityMeshNode
  childComponent: SerializedTopologyComponentInput
}) {
  if (node._containsObstacle) return [node]

  const nodeBounds = getNodeBounds(node)
  const childBounds = getObstacleBounds(childComponent.replacementObstacle)

  if (!isBoundsInsideBounds({ inner: childBounds, outer: nodeBounds })) {
    return [node]
  }

  const splitBounds = [
    {
      key: "top",
      bounds: {
        minX: nodeBounds.minX,
        maxX: nodeBounds.maxX,
        minY: nodeBounds.minY,
        maxY: childBounds.minY,
      },
    },
    {
      key: "right",
      bounds: {
        minX: childBounds.maxX,
        maxX: nodeBounds.maxX,
        minY: childBounds.minY,
        maxY: childBounds.maxY,
      },
    },
    {
      key: "bottom",
      bounds: {
        minX: nodeBounds.minX,
        maxX: nodeBounds.maxX,
        minY: childBounds.maxY,
        maxY: nodeBounds.maxY,
      },
    },
    {
      key: "left",
      bounds: {
        minX: nodeBounds.minX,
        maxX: childBounds.minX,
        minY: childBounds.minY,
        maxY: childBounds.maxY,
      },
    },
  ]

  const splitNodes = splitBounds
    .filter(({ bounds }) => isValidNodeBounds(bounds))
    .map(({ key, bounds }) =>
      createNodeFromBounds({
        node,
        bounds,
        capacityMeshNodeId: `${node.capacityMeshNodeId}:around:${childComponent.componentId}:${key}`,
      }),
    )

  return splitNodes.length > 0 ? splitNodes : [node]
}

function splitNodeAroundExtraObstacle({
  node,
  componentId,
  obstacle,
  obstacleIndex,
}: {
  node: CapacityMeshNode
  componentId: string
  obstacle: SerializedTopologyComponentInput["replacementObstacle"]
  obstacleIndex: number
}) {
  if (node._containsObstacle) return [node]

  const nodeBounds = getNodeBounds(node)
  const obstacleBounds = getObstacleBounds(obstacle)
  const intersectionBounds = getBoundsIntersection({
    a: nodeBounds,
    b: obstacleBounds,
  })

  if (!intersectionBounds) return [node]

  const obstacleKey = obstacle.obstacleId ?? `extra-${obstacleIndex}`
  const splitBounds = [
    {
      key: "top",
      bounds: {
        minX: nodeBounds.minX,
        maxX: nodeBounds.maxX,
        minY: nodeBounds.minY,
        maxY: intersectionBounds.minY,
      },
    },
    {
      key: "right",
      bounds: {
        minX: intersectionBounds.maxX,
        maxX: nodeBounds.maxX,
        minY: intersectionBounds.minY,
        maxY: intersectionBounds.maxY,
      },
    },
    {
      key: "bottom",
      bounds: {
        minX: nodeBounds.minX,
        maxX: nodeBounds.maxX,
        minY: intersectionBounds.maxY,
        maxY: nodeBounds.maxY,
      },
    },
    {
      key: "left",
      bounds: {
        minX: nodeBounds.minX,
        maxX: intersectionBounds.minX,
        minY: intersectionBounds.minY,
        maxY: intersectionBounds.maxY,
      },
    },
  ]

  return [
    createNodeFromBounds({
      node,
      bounds: intersectionBounds,
      capacityMeshNodeId: `${node.capacityMeshNodeId}:obstacle:${componentId}:${obstacleKey}`,
      containsObstacle: true,
    }),
    ...splitBounds
      .filter(({ bounds }) => isValidNodeBounds(bounds))
      .map(({ key, bounds }) =>
        createNodeFromBounds({
          node,
          bounds,
          capacityMeshNodeId: `${node.capacityMeshNodeId}:around-obstacle:${componentId}:${obstacleKey}:${key}`,
        }),
      ),
  ]
}

function getBoundsIntersection({
  a,
  b,
}: {
  a: ReturnType<typeof getNodeBounds>
  b: ReturnType<typeof getNodeBounds>
}) {
  const intersection = {
    minX: Math.max(a.minX, b.minX),
    maxX: Math.min(a.maxX, b.maxX),
    minY: Math.max(a.minY, b.minY),
    maxY: Math.min(a.maxY, b.maxY),
  }

  return isValidNodeBounds(intersection) ? intersection : null
}

function getNodeBounds(node: CapacityMeshNode) {
  return {
    minX: node.center.x - node.width / 2,
    maxX: node.center.x + node.width / 2,
    minY: node.center.y - node.height / 2,
    maxY: node.center.y + node.height / 2,
  }
}

function getObstacleBounds(
  obstacle: SerializedTopologyComponentInput["replacementObstacle"],
) {
  return {
    minX: obstacle.center.x - obstacle.width / 2,
    maxX: obstacle.center.x + obstacle.width / 2,
    minY: obstacle.center.y - obstacle.height / 2,
    maxY: obstacle.center.y + obstacle.height / 2,
  }
}

function isObstacleInsideObstacle({
  inner,
  outer,
}: {
  inner: SerializedTopologyComponentInput["replacementObstacle"]
  outer: SerializedTopologyComponentInput["replacementObstacle"]
}) {
  return isBoundsInsideBounds({
    inner: getObstacleBounds(inner),
    outer: getObstacleBounds(outer),
  })
}

function isBoundsInsideBounds({
  inner,
  outer,
}: {
  inner: ReturnType<typeof getNodeBounds>
  outer: ReturnType<typeof getNodeBounds>
}) {
  const epsilon = 1e-9

  return (
    inner.minX >= outer.minX - epsilon &&
    inner.maxX <= outer.maxX + epsilon &&
    inner.minY >= outer.minY - epsilon &&
    inner.maxY <= outer.maxY + epsilon &&
    (inner.minX > outer.minX + epsilon ||
      inner.maxX < outer.maxX - epsilon ||
      inner.minY > outer.minY + epsilon ||
      inner.maxY < outer.maxY - epsilon)
  )
}

function isValidNodeBounds(bounds: ReturnType<typeof getNodeBounds>) {
  const epsilon = 1e-9

  return (
    bounds.maxX - bounds.minX > epsilon && bounds.maxY - bounds.minY > epsilon
  )
}

function createNodeFromBounds({
  node,
  bounds,
  capacityMeshNodeId,
  containsObstacle = node._containsObstacle,
}: {
  node: CapacityMeshNode
  bounds: ReturnType<typeof getNodeBounds>
  capacityMeshNodeId: string
  containsObstacle?: boolean
}): CapacityMeshNode {
  return {
    ...node,
    capacityMeshNodeId,
    center: {
      x: (bounds.minX + bounds.maxX) / 2,
      y: (bounds.minY + bounds.maxY) / 2,
    },
    width: bounds.maxX - bounds.minX,
    height: bounds.maxY - bounds.minY,
    _containsObstacle: containsObstacle,
  }
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
  activeSubSolver?:
    | BgaTopologyGeneratorSolver
    | QfpTopologyGeneratorSolver
    | QfpThermalPadTopologyGeneratorSolver
    | SoicTopologyGeneratorSolver
    | null = null
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
    }

    if (componentKind === "qfp") {
      this.activeSubSolver = new QfpTopologyGeneratorSolver({
        ...solverInput,
        viaDiameter: this.inputProblem.viaDiameter,
        obstacleMargin: this.inputProblem.obstacleMargin,
      })
      return
    }

    if (componentKind === "qfp_thermalpad") {
      this.activeSubSolver = new QfpThermalPadTopologyGeneratorSolver({
        ...solverInput,
        viaDiameter: this.inputProblem.viaDiameter,
        obstacleMargin: this.inputProblem.obstacleMargin,
      })
      return
    }

    if (componentKind === "soic") {
      this.activeSubSolver = new SoicTopologyGeneratorSolver({
        ...solverInput,
        viaDiameter: this.inputProblem.viaDiameter,
        obstacleMargin: this.inputProblem.obstacleMargin,
      })
      return
    }

    this.activeSubSolver = new BgaTopologyGeneratorSolver(solverInput)
  }

  getOutput(): ComponentTopologyBatchSolverOutput {
    return {
      componentMeshNodes: this.componentMeshNodes,
    }
  }
}
