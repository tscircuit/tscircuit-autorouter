import { CapacityPathingGreedySolver } from "lib/solvers/CapacityPathingSectionSolver/CapacityPathingGreedySolver"
import type { CapacityHyperParameters } from "lib/solvers/CapacityHyperParameters"
import type {
  CapacityMeshEdge,
  CapacityMeshNode,
  CapacityMeshNodeId,
  SimpleRouteConnection,
  SimpleRouteJson,
} from "lib/types"
import { BaseSolver } from "lib/solvers/BaseSolver"
import { getNodeEdgeMap } from "lib/solvers/CapacityMeshSolver/getNodeEdgeMap"
import {
  cloneAndShuffleArray,
  seededRandom,
} from "lib/utils/cloneAndShuffleArray"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import { GraphicsObject } from "graphics-debug"

const seededRandomDecision = (seeds: number[], chance: number) => {
  const seed = seeds.reduce(
    (acc, seed) => acc + ((seed * 16807) % 2147483647),
    0,
  )
  const random = seededRandom(seed)
  return random() < chance
}

export type Candidate = {
  prevCandidate: Candidate | null
  node: CapacityMeshNode
  f: number
  g: number
  h: number
}

type AssignableViaCapacityHyperParameters = Partial<CapacityHyperParameters> & {
  SHUFFLE_SEED?: number

  DIRECTIVE_SEED?: number

  FORCE_VIA_TRAVEL_CHANCE?: number
  FAR_VIA_MIN_DISTANCE?: number
}

type ConnectionNodePair = {
  start: CapacityMeshNode
  end: CapacityMeshNode
  connection: SimpleRouteConnection
}

type SubpathNodePair = {
  start: CapacityMeshNode
  end: CapacityMeshNode
  solved: boolean
}

export type ConnectionPathWithNodes = {
  connection: SimpleRouteConnection
  path: CapacityMeshNode[]
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

  unprocessedConnectionPairs: ConnectionNodePair[]
  solvedRoutes: ConnectionPathWithNodes[] = []

  activeConnectionPair: ConnectionNodePair | null = null

  unprocessedSubpaths: SubpathNodePair[] | null = null
  solvedSubpaths: SubpathNodePair[] | null = null

  activeSubpath: SubpathNodePair | null = null

  viaNodes: CapacityMeshNode[] = []

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
          connection: conn,
        }
      }),
      this.hyperParameters.SHUFFLE_SEED ?? 0,
    )

    this.viaNodes = this.nodes.filter((node) => node.availableZ.length > 1)
  }

  lastStepOperation:
    | "none"
    | "dequeueConnectionPair"
    | "breakConnectionPairIntoSubpaths"
    | "dequeueSubpath"
    | "stepSolveSubpath"
    | "finishedSolvingSubpath"
    | "finishedSolvingConnectionPair" = "none"

  _step() {
    if (!this.activeConnectionPair) {
      this.activeConnectionPair = this.unprocessedConnectionPairs.shift()!
      if (!this.activeConnectionPair) {
        this.solved = true
        return
      }
      this.lastStepOperation = "dequeueConnectionPair"
      return
    }

    if (this.activeConnectionPair && !this.unprocessedSubpaths) {
      this.unprocessedSubpaths = this.breakConnectionPairIntoSubpaths(
        this.activeConnectionPair,
      )
      this.solvedSubpaths = []
      this.lastStepOperation = "breakConnectionPairIntoSubpaths"
      return
    }

    if (!this.activeSubpath) {
      this.activeSubpath = this.unprocessedSubpaths!.shift()!
      if (!this.activeSubpath) {
        this.activeConnectionPair = null
        this.unprocessedSubpaths = null
        this.activeSubpath = null

        this.solvedRoutes.push(this.createSolvedRoute(this.solvedSubpaths!))

        this.lastStepOperation = "finishedSolvingConnectionPair"
        return
      }

      this.lastStepOperation = "dequeueSubpath"
      return
    }

    if (this.activeSubpath) {
      this.stepSolveSubpath(this.activeSubpath)

      if (this.activeSubpath!.solved) {
        this.solvedSubpaths!.push(this.activeSubpath)
        this.activeSubpath = null
        this.clearCandidateNodes()
        this.lastStepOperation = "finishedSolvingSubpath"
        return
      }
    }

    this.lastStepOperation = "stepSolveSubpath"
  }

  queuedCandidateNodes: Candidate[]
  visitedNodes: Set<CapacityMeshNodeId>

  stepSolveSubpath(subpath: SubpathNodePair) {
    // TOOD sort queuedCandidateNodes by f

    // TODO pop candidate node from queuedCandidateNodes

    // TODO check if candidate node is the end goal

    // TODO get neighbors of candidate node and add to queuedCandidateNodes

    throw new Error("Not implemented")
  }

  getNeighbors(node: CapacityMeshNode): CapacityMeshNode[] {
    throw new Error("Not implemented")
  }

  clearCandidateNodes() {
    this.queuedCandidateNodes = []
    this.visitedNodes = new Set()
  }

  computeG(
    prevCandidate: Candidate,
    node: CapacityMeshNode,
    endGoal: CapacityMeshNode,
  ) {
    throw new Error("Not implemented")
  }

  computeH(
    prevCandidate: Candidate,
    node: CapacityMeshNode,
    endGoal: CapacityMeshNode,
  ) {
    throw new Error("Not implemented")
  }

  createSolvedRoute(subpaths: SubpathNodePair[]): ConnectionPathWithNodes {
    return {
      connection: this.activeConnectionPair!.connection,
      path: subpaths
        .map((subpath) => subpath.start)
        .concat(subpaths[subpaths.length - 1].end),
    }
  }

  breakConnectionPairIntoSubpaths(
    connectionPair: ConnectionNodePair,
  ): SubpathNodePair[] {
    const shouldForceTravel = seededRandomDecision(
      [this.hyperParameters.DIRECTIVE_SEED ?? 0, this.solvedRoutes.length],
      this.hyperParameters.FORCE_VIA_TRAVEL_CHANCE ?? 0,
    )
    if (!shouldForceTravel) {
      return [
        {
          start: connectionPair.start,
          end: connectionPair.end,
          solved: false,
        },
      ]
    }
    const subpaths: SubpathNodePair[] = []
    const closestVia = this.getClosestVia(connectionPair.start)
    const farVia = this.getFarVia(closestVia, connectionPair.end)

    this.unprocessedSubpaths = []
    this.unprocessedSubpaths.push({
      start: connectionPair.start,
      end: closestVia,
      solved: false,
    })
    this.unprocessedSubpaths.push({
      start: closestVia,
      end: farVia,
      solved: false,
    })
    this.unprocessedSubpaths.push({
      start: farVia,
      end: connectionPair.end,
      solved: false,
    })
    return subpaths
  }

  getClosestVia(node: CapacityMeshNode): CapacityMeshNode {
    throw new Error("Not implemented")
  }

  getFarVia(
    closestVia: CapacityMeshNode,
    end: CapacityMeshNode,
  ): CapacityMeshNode {
    throw new Error("Not implemented")
  }

  visualize(): GraphicsObject {
    const graphics: GraphicsObject = {
      lines: [],
      points: [],
      rects: [],
      circles: [],
    }

    if (this.activeConnectionPair) {
      graphics.lines!.push({
        points: [
          this.activeConnectionPair.start.center,
          this.activeConnectionPair.end.center,
        ],
        strokeColor: "red",
        strokeDash: "10 5",
      })
    }

    return graphics
  }
}
