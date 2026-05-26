import { doBoundsOverlap, getBoundingBox } from "@tscircuit/math-utils"
import { BaseSolver } from "@tscircuit/solver-utils"
import { BgaTopologyGeneratorSolver } from "lib/solvers/BgaTopologyGeneratorSolver/BgaTopologyGeneratorSolver"
import { QfpTopologyGeneratorSolver } from "lib/solvers/QfpTopologyGeneratorSolver/QfpTopologyGeneratorSolver"
import { QfpThermalPadTopologyGeneratorSolver } from "lib/solvers/QfpThermalPadTopologyGeneratorSolver/QfpThermalPadTopologyGeneratorSolver"
import { SoicTopologyGeneratorSolver } from "lib/solvers/SoicTopologyGeneratorSolver/SoicTopologyGeneratorSolver"
import type { CapacityMeshNode, SimpleRouteJson } from "lib/types"
import type { Obstacle } from "lib/types"
import { doRectsOverlap } from "lib/utils/doRectsOverlap"
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
 * Reattaches physical obstacle ancestry to mesh nodes after rotated obstacles
 * have been flattened into approximation rectangles.
 */
export function annotateMeshNodesWithParentObstacleIds({
  meshNodes,
  obstacles,
}: {
  meshNodes: CapacityMeshNode[]
  obstacles: Obstacle[]
}): CapacityMeshNode[] {
  return meshNodes.map((node) => {
    const parentObstacleIds = [
      ...new Set(
        obstacles
          .filter((obstacle) => doRectsOverlap(node, obstacle))
          .map((obstacle) => obstacle.parentObstacleId ?? obstacle.obstacleId)
          .filter((obstacleId): obstacleId is string => Boolean(obstacleId)),
      ),
    ]

    if (parentObstacleIds.length === 0) {
      return node
    }

    return {
      ...node,
      _parentObstacleIds: parentObstacleIds,
    }
  })
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
