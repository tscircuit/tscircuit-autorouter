import { BaseSolver } from "@tscircuit/solver-utils"
import { doBoundsOverlap, getBoundingBox } from "@tscircuit/math-utils"
import { BgpTopologyGeneratorSolver } from "lib/solvers/BgpTopologyGeneratorSolver/BgpTopologyGeneratorSolver"
import type { CapacityMeshNode, SimpleRouteJson } from "lib/types"
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
  replacementObstacleIds: Array<string | undefined>
}

export interface ComponentTopologyBatchSolverOutput {
  componentMeshNodes: CapacityMeshNode[][]
}

/**
 * Builds the component-local SRJ passed into BGP topology generation.
 *
 * Important:
 * - component bounds come from the detected member obstacles.
 * - only original SRJ obstacles whose geometry overlaps those bounds are
 *   included in the component-local topology solve.
 * - included obstacle geometry is copied from the original SRJ unchanged.
 * - electrically connected obstacles outside the component bounds remain part
 *   of the global topology, not the component-local BGP matrix.
 */
export function createComponentSrj({
  inputSrj,
  component,
}: {
  inputSrj: SimpleRouteJson
  component: SerializedTopologyComponentInput
}): SimpleRouteJson {
  const componentBounds = getBoundsForObstacles(component.memberObstacles)
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

  return (
    Math.abs(node.center.x - replacementObstacle.center.x) <= epsilon &&
    Math.abs(node.center.y - replacementObstacle.center.y) <= epsilon &&
    Math.abs(node.width - replacementObstacle.width) <= epsilon &&
    Math.abs(node.height - replacementObstacle.height) <= epsilon
  )
}

/** Runs one BGP topology solve per component SRJ and collects the routing regions. */
export class ComponentTopologyBatchSolver extends BaseSolver {
  activeSubSolver?: BgpTopologyGeneratorSolver | null = null
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

    this.activeSubSolver = new BgpTopologyGeneratorSolver({
      inputSrj: this.inputProblem.componentSrjs[this.currentIndex]!,
      componentId: this.inputProblem.componentIds[this.currentIndex],
      replacementObstacleId:
        this.inputProblem.replacementObstacleIds[this.currentIndex],
    })
  }

  getOutput(): ComponentTopologyBatchSolverOutput {
    return {
      componentMeshNodes: this.componentMeshNodes,
    }
  }
}
