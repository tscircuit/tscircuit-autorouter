import { CapacityPathingGreedySolver } from "lib/solvers/CapacityPathingSectionSolver/CapacityPathingGreedySolver"
import type { CapacityHyperParameters } from "lib/solvers/CapacityHyperParameters"
import type {
  CapacityMeshEdge,
  CapacityMeshNode,
  CapacityMeshNodeId,
  SimpleRouteJson,
} from "lib/types"
import { BaseSolver } from "lib/solvers/BaseSolver"
import { getNodeEdgeMap } from "lib/solvers/CapacityMeshSolver/getNodeEdgeMap"
import { cloneAndShuffleArray } from "lib/utils/cloneAndShuffleArray"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"

type AssignableViaCapacityHyperParameters = Partial<CapacityHyperParameters> & {
  SHUFFLE_SEED?: number

  DIRECTIVE_SEED?: number

  FORCE_VIA_TRAVEL_CHANCE?: number
  FAR_VIA_MIN_DISTANCE?: number
}

/**
 * This capacity path solver employs conditional directives. Whether or not the
 * directive applies depends on the pseudo-random hash of the DIRECTIVE_SEED
 *
 * The main conditional directive is whether or not to force the path to go
 * to go through a via then through a far via (if necessary to get to the goal
 * layer). This is useful because it prevents an early path from cutting off
 * all other paths.
 *
 * When forced to traverse via a via, you first select the closest "via" (a
 * via is a node that has availableZ: [0,1]) then a via close
 * to your first via that is a minimum of FAR_VIA_MIN_DISTANCE away. You sort
 * these candidate vias by the weighted sum of the distance to the first via and
 * the goal- seeking to minimize that total distance while staying FAR_VIA_MIN_DISTANCE
 * away from the first via.
 *
 * The visualize() function helps understand the algorithm as it runs by
 * highlighting the selected vias and the path currently being solved. Instead
 * of solving for a single path for a pair of nodes, we now have to solve for
 * multiple paths for multiple pairs of nodes (the middle nodes being the
 * forced vias)
 *
 */
type RouteSegment = {
  start: CapacityMeshNode
  end: CapacityMeshNode
}

export class AssignableViaCapacityPathingSolver_DirectiveSubOptimal extends BaseSolver {
  /**
   * Used for
   */
  GREEDY_MULTIPLIER = 1.5

  simpleRouteJson: SimpleRouteJson
  nodes: CapacityMeshNode[]
  edges: CapacityMeshEdge[]
  colorMap: Record<string, string>
  MAX_ITERATIONS: number
  hyperParameters: Partial<AssignableViaCapacityHyperParameters>
  usedNodeMap: Map<CapacityMeshNodeId, true> = new Map()
  nodeMap: Map<CapacityMeshNodeId, CapacityMeshNode>
  nodeEdgeMap: Map<CapacityMeshNodeId, CapacityMeshEdge[]>

  unprocessedConnectionPairs: {
    start: CapacityMeshNode
    end: CapacityMeshNode
  }[]

  constructor({
    simpleRouteJson,
    nodes,
    edges,
    colorMap,
    MAX_ITERATIONS = 1e6,
    hyperParameters = {},
  }: {
    simpleRouteJson: SimpleRouteJson
    nodes: CapacityMeshNode[]
    edges: CapacityMeshEdge[]
    colorMap?: Record<string, string>
    MAX_ITERATIONS?: number
    hyperParameters?: Partial<CapacityHyperParameters>
  }) {
    super()
    this.hyperParameters = hyperParameters
    this.MAX_ITERATIONS = MAX_ITERATIONS
    this.simpleRouteJson = simpleRouteJson
    this.nodes = nodes
    this.edges = edges
    this.colorMap = colorMap ?? {}
    this.nodeMap = new Map(
      this.nodes.map((node) => [node.capacityMeshNodeId, node]),
    )
    this.nodeEdgeMap = getNodeEdgeMap(this.edges)

    this.unprocessedConnectionPairs = cloneAndShuffleArray(
      this.simpleRouteJson.connections.map((conn) => {
        const startNode = this.nodes.find(
          (n) => n._targetConnectionName === conn.name,
        )!
        const endNode = this.nodes.find(
          (n) => n._targetConnectionName === conn.name,
        )!
        if (!startNode || !endNode) {
          throw new Error(
            `Could not find start or end node for connection "${conn.name}"`,
          )
        }
        return {
          start: startNode,
          end: endNode,
        }
      }),
      this.hyperParameters.SHUFFLE_SEED ?? 0,
    )
  }

  _step() {}
}
