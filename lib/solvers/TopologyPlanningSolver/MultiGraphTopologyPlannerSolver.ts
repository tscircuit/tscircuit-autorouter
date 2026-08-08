import { RectDiffPipeline } from "@tscircuit/rectdiff"
import { BasePipelineSolver, definePipelineStep } from "@tscircuit/solver-utils"
import type { BaseSolver, PipelineStep } from "@tscircuit/solver-utils"
import type { GraphicsObject } from "graphics-debug"
import objectHash from "object-hash"
import type { CachableSolver, CacheProvider } from "lib/cache/types"
import type { DetectedComponent } from "lib/solvers/ComponentDetectionSolver/ComponentDetectionSolver"
import type { ComponentKind } from "lib/solvers/ComponentDetectionSolver/detectors/types"
import { safeTransparentize } from "lib/solvers/colors"
import type { CapacityMeshNode, Obstacle, SimpleRouteJson } from "lib/types"
import { createRectFromCapacityNode } from "lib/utils/createRectFromCapacityNode"
import { getGlobalMeshNodesForTopologyMerging } from "./get-global-mesh-nodes-for-topology-merging"
import {
  ComponentTopologyBatchSolver,
  type ComponentTopologyBatchSolverOutput,
  type NormalizedTopologyPlannerInput,
  createComponentSrj,
  filterRectDiffNodeRectsInsideComponentAreas,
  normalizeInput,
} from "./topologyPlanningShared"

export interface SerializedTopologyComponentInput {
  componentId: string
  componentKind: ComponentKind
  memberObstacleIds: string[]
  memberObstacles: Obstacle[]
  replacementObstacle: Obstacle & { obstacleId: string }
}

export interface MultiGraphTopologyPlannerSolverParams {
  inputSrj: SimpleRouteJson
  globalNoConnectionSrj?: SimpleRouteJson
  components?: SerializedTopologyComponentInput[]
  componentDetectionOutput?: DetectedComponent[]
  viaDiameter?: number
  obstacleMargin?: number
  cacheProvider?: CacheProvider | null
  brokenSrj?: {
    componentsAsObstaclesSrj: SimpleRouteJson
    components: SerializedTopologyComponentInput[]
  }
}

export interface MultiGraphTopologyPlannerSolverOutput {
  globalNoConnectionSrj: SimpleRouteJson
  componentNoConnectionSrjs: SimpleRouteJson[]
  globalMeshNodes: CapacityMeshNode[]
  componentMeshNodes: CapacityMeshNode[][]
}

type CachedMultiGraphTopology = Pick<
  MultiGraphTopologyPlannerSolverOutput,
  "globalMeshNodes" | "componentMeshNodes"
>

type MultiGraphTopologyCacheTransform = Record<string, never>

type TopologySrjCacheInput = Omit<
  SimpleRouteJson,
  "connections" | "traces" | "differentialPairs" | "buses"
>

const MULTI_GRAPH_TOPOLOGY_CACHE_SCHEMA_VERSION = 1

/**
 * Keeps only geometry that can change the generated mesh. Connections and
 * traces vary between routing phases; connection-expanded component bounds are
 * retained because component SRJs are derived before this projection.
 */
const getTopologySrjCacheInput = (
  srj: SimpleRouteJson,
): TopologySrjCacheInput => {
  const {
    connections: _connections,
    traces: _traces,
    differentialPairs: _differentialPairs,
    buses: _buses,
    ...topologySrj
  } = srj

  return topologySrj
}

/**
 * Produces the global and component-local topology groups consumed by the
 * Pipeline 7 topology merging stage.
 */
export class MultiGraphTopologyPlannerSolver
  extends BasePipelineSolver<MultiGraphTopologyPlannerSolverParams>
  implements
    CachableSolver<
      MultiGraphTopologyCacheTransform,
      CachedMultiGraphTopology
    >
{
  globalTopologySolver?: RectDiffPipeline
  componentTopologyBatchSolver?: ComponentTopologyBatchSolver

  private normalizedInput: NormalizedTopologyPlannerInput
  private cachedTopology?: CachedMultiGraphTopology

  cacheProvider: CacheProvider | null
  cacheHit = false
  hasAttemptedToUseCache = false
  declare cacheKey?: string | undefined
  cacheToSolveSpaceTransform?: MultiGraphTopologyCacheTransform

  pipelineDef: PipelineStep<BaseSolver>[] = [
    definePipelineStep(
      "globalTopologySolver",
      RectDiffPipeline,
      (instance: MultiGraphTopologyPlannerSolver) => [
        instance.getGlobalTopologySolverInput(),
      ],
    ),
    definePipelineStep(
      "componentTopologyBatchSolver",
      ComponentTopologyBatchSolver,
      (instance: MultiGraphTopologyPlannerSolver) => [
        {
          componentSrjs: instance.getComponentNoConnectionSrjs(),
          componentIds: instance.normalizedInput.components.map(
            (component) => component.componentId,
          ),
          componentKinds: instance.normalizedInput.components.map(
            (component) => component.componentKind,
          ),
          viaDiameter: instance.inputProblem.viaDiameter,
          obstacleMargin: instance.inputProblem.obstacleMargin,
        },
      ],
    ),
  ]

  constructor(params: MultiGraphTopologyPlannerSolverParams) {
    super(params)
    this.normalizedInput = normalizeInput(params)
    this.cacheProvider = params.cacheProvider ?? null
  }

  override _step(): void {
    if (!this.hasAttemptedToUseCache && this.cacheProvider) {
      if (this.attemptToUseCacheSync()) return
    }

    const wasSolved = this.solved
    super._step()

    if (this.solved && !wasSolved && !this.cacheHit) {
      this.saveToCacheSync()
    }
  }

  override getConstructorParams() {
    return [this.inputProblem] as const
  }

  /**
   * Returns the global solve and the independently generated component-local
   * topology groups.
   */
  override getOutput(): MultiGraphTopologyPlannerSolverOutput {
    const globalMeshNodes =
      this.cachedTopology?.globalMeshNodes ??
      getGlobalMeshNodesForTopologyMerging({
        meshNodes:
          this.getStageOutput<{ meshNodes: CapacityMeshNode[] }>(
            "globalTopologySolver",
          )?.meshNodes ?? [],
        components: this.normalizedInput.components,
      })
    const componentMeshNodes =
      this.cachedTopology?.componentMeshNodes ??
      this.getStageOutput<ComponentTopologyBatchSolverOutput>(
        "componentTopologyBatchSolver",
      )?.componentMeshNodes ??
      []
    const componentNoConnectionSrjs = this.getComponentNoConnectionSrjs()

    return {
      globalNoConnectionSrj: this.normalizedInput.globalNoConnectionSrj,
      componentNoConnectionSrjs,
      globalMeshNodes,
      componentMeshNodes,
    }
  }

  computeCacheKeyAndTransform(): {
    cacheKey: string
    cacheToSolveSpaceTransform: MultiGraphTopologyCacheTransform
  } {
    const componentNoConnectionSrjs = this.getComponentNoConnectionSrjs()
    const cacheKeyContent = {
      cacheSchemaVersion: MULTI_GRAPH_TOPOLOGY_CACHE_SCHEMA_VERSION,
      globalSrj: getTopologySrjCacheInput(
        this.normalizedInput.globalNoConnectionSrj,
      ),
      components: this.normalizedInput.components.map((component, index) => ({
        componentId: component.componentId,
        componentKind: component.componentKind,
        srj: getTopologySrjCacheInput(componentNoConnectionSrjs[index]!),
      })),
      viaDiameter: this.inputProblem.viaDiameter,
      obstacleMargin: this.inputProblem.obstacleMargin,
    }
    const cacheKey = `multigraph-topology:${objectHash(cacheKeyContent)}`
    const cacheToSolveSpaceTransform: MultiGraphTopologyCacheTransform = {}

    this.cacheKey = cacheKey
    this.cacheToSolveSpaceTransform = cacheToSolveSpaceTransform

    return { cacheKey, cacheToSolveSpaceTransform }
  }

  applyCachedSolution(cachedTopology: CachedMultiGraphTopology): void {
    this.cachedTopology = structuredClone(cachedTopology)
    this.cacheHit = true
    this.solved = true
    this.failed = false
    this.progress = 1
    this.stats = {
      ...this.stats,
      cacheHit: true,
      globalMeshNodeCount: cachedTopology.globalMeshNodes.length,
      componentMeshNodeCount: cachedTopology.componentMeshNodes.reduce(
        (count, nodes) => count + nodes.length,
        0,
      ),
    }
  }

  attemptToUseCacheSync(): boolean {
    this.hasAttemptedToUseCache = true
    if (!this.cacheProvider?.isSyncCache) return false

    try {
      const { cacheKey } = this.computeCacheKeyAndTransform()
      const cachedTopology = this.cacheProvider.getCachedSolutionSync(cacheKey)
      if (
        !cachedTopology ||
        !Array.isArray(cachedTopology.globalMeshNodes) ||
        !Array.isArray(cachedTopology.componentMeshNodes) ||
        !cachedTopology.componentMeshNodes.every(Array.isArray)
      ) {
        return false
      }

      this.applyCachedSolution(cachedTopology)
      return true
    } catch (error) {
      console.error("Error loading cached multi-graph topology:", error)
      return false
    }
  }

  saveToCacheSync(): void {
    if (!this.cacheProvider?.isSyncCache || !this.solved || this.failed) return

    const cacheKey =
      this.cacheKey ?? this.computeCacheKeyAndTransform().cacheKey
    const output = this.getOutput()
    try {
      this.cacheProvider.setCachedSolutionSync(cacheKey, {
        globalMeshNodes: output.globalMeshNodes,
        componentMeshNodes: output.componentMeshNodes,
      } satisfies CachedMultiGraphTopology)
    } catch (error) {
      console.error("Error caching multi-graph topology:", error)
    }
  }

  override finalVisualize(): GraphicsObject | null {
    const output = this.getOutput()
    const componentObstacleRects = output.componentNoConnectionSrjs.flatMap(
      (componentSrj, componentIndex) => {
        const component =
          this.normalizedInput.components[componentIndex] ?? null

        return componentSrj.obstacles.map((obstacle) => ({
          center: obstacle.center,
          width: obstacle.width,
          height: obstacle.height,
          fill: "rgba(120, 120, 120, 0.06)",
          stroke: "rgba(120, 120, 120, 0.35)",
          label:
            obstacle.obstacleId ?? component?.componentId ?? "component-pad",
          layer: obstacle.layers.join(","),
        }))
      },
    )

    return {
      title: "Topology Planning: generated topology groups",
      rects: [
        ...componentObstacleRects,
        ...[...output.globalMeshNodes, ...output.componentMeshNodes.flat()].map(
          (node) => {
            const component = this.normalizedInput.components.find(
              (candidate) =>
                node.capacityMeshNodeId.includes(candidate.componentId),
            )
            const rect = createRectFromCapacityNode(node, { rectMargin: 0.01 })
            return {
              ...rect,
              fill: node._containsObstacle
                ? safeTransparentize("red", 0.82)
                : "rgba(0, 120, 255, 0.12)",
              stroke: node._containsObstacle
                ? safeTransparentize("red", 0.3)
                : "rgba(0, 120, 255, 0.55)",
              label: component
                ? `${component.componentKind.toUpperCase()} ${node.capacityMeshNodeId}`
                : node.capacityMeshNodeId,
            }
          },
        ),
      ],
      lines: [],
      points: [],
      circles: [],
      texts: [],
    }
  }

  override visualize(): GraphicsObject {
    return this.filterGlobalRectDiffNodesFromVisualization({
      visualization: super.visualize(),
    })
  }

  override preview(): GraphicsObject {
    return this.filterGlobalRectDiffNodesFromVisualization({
      visualization: super.preview(),
    })
  }

  /** Rebuilds each component-local SRJ from its original member obstacles. */
  private getComponentNoConnectionSrjs(): SimpleRouteJson[] {
    return this.normalizedInput.components.map((component) =>
      createComponentSrj({
        inputSrj: this.inputProblem.inputSrj,
        component,
      }),
    )
  }

  /** Adapts the global no-connection SRJ into the RectDiffPipeline input shape. */
  private getGlobalTopologySolverInput() {
    return {
      simpleRouteJson: this.normalizedInput.globalNoConnectionSrj as any,
      maxGapFillPasses: 4,
    }
  }

  /**
   * Removes raw RectDiff node rects that are superseded by component-local
   * topology regions.
   *
   * @param params.visualization - Graphics output produced by the base
   *   pipeline visualizer, including nested stage visualizations.
   * @returns A visualization with RectDiff node rectangles inside component
   *   areas removed. Non-RectDiff rectangles and all lines, points, circles,
   *   and text entries are returned unchanged.
   *
   * @note This keeps intermediate RectDiff visualization consistent with the
   * merged topology output, which already removes those nodes from solver data.
   */
  private filterGlobalRectDiffNodesFromVisualization({
    visualization,
  }: {
    visualization: GraphicsObject
  }): GraphicsObject {
    return {
      ...visualization,
      rects: filterRectDiffNodeRectsInsideComponentAreas({
        rects: visualization.rects,
        components: this.normalizedInput.components,
      }),
    }
  }
}
