import { distance } from "@tscircuit/math-utils"
import type { GraphicsObject } from "graphics-debug"
import type { SegmentPortPoint } from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import { BaseSolver } from "lib/solvers/BaseSolver"
import {
  HyperPortPointPathingSolver,
  type HyperPortPointPathingSolverParams,
} from "lib/solvers/PortPointPathingSolver/HyperPortPointPathingSolver"
import type {
  ConnectionPathResult,
  InputNodeWithPortPoints,
  PortPointCandidate,
} from "lib/solvers/PortPointPathingSolver/PortPointPathingSolver"
import {
  HgPortPointPathingSolver,
  buildHyperGraph,
} from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver"
import type {
  RegionPortHg,
  SolvedRoutesHg,
} from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver/types"
import type { CapacityMeshNode, CapacityMeshNodeId } from "lib/types"
import type {
  NodeWithPortPoints,
  PortPoint,
} from "lib/types/high-density-types"

export interface AssignablePortPointPathingSolverParams
  extends HyperPortPointPathingSolverParams {
  segmentPortPoints: SegmentPortPoint[]
  layerCount: number
  effort: number
}

/**
 * Uses the planar hypergraph solver when the mesh contains prefab/off-board
 * connections, while leaving ordinary Pipeline2 boards on the legacy solver.
 */
export class AssignablePortPointPathingSolver extends BaseSolver {
  readonly usesHypergraph: boolean
  readonly legacySolver?: HyperPortPointPathingSolver
  readonly hypergraphSolver?: HgPortPointPathingSolver

  constructor(private readonly params: AssignablePortPointPathingSolverParams) {
    super()
    this.usesHypergraph = params.capacityMeshNodes.some((node) =>
      Boolean(node._offBoardConnectionId),
    )

    if (!this.usesHypergraph) {
      this.legacySolver = new HyperPortPointPathingSolver(params)
      this.MAX_ITERATIONS = this.legacySolver.MAX_ITERATIONS + 1
      return
    }

    const { graph, connections } = buildHyperGraph({
      capacityMeshNodes: params.capacityMeshNodes,
      layerCount: params.layerCount,
      segmentPortPoints: params.segmentPortPoints,
      simpleRouteJsonConnections: params.simpleRouteJson.connections,
    })
    this.hypergraphSolver = new HgPortPointPathingSolver({
      graph,
      connections,
      layerCount: params.layerCount,
      effort: params.effort,
      colorMap: params.colorMap,
      flags: {
        FORCE_CENTER_FIRST: false,
        RIPPING_ENABLED: true,
        MAX_OFF_BOARD_CONNECTIONS_PER_PATH: 1,
        USE_TOPOLOGY_ONLY_HEURISTIC: true,
        ALWAYS_RIP_INTERSECTIONS: true,
        // Same-net branches are legal junctions, not shorts.
        ALWAYS_RIP_SAME_NET_INTERSECTIONS: false,
      },
      weights: {
        SHUFFLE_SEED: 0,
        MEMORY_PF_FACTOR: 4,
        CENTER_OFFSET_DIST_PENALTY_FACTOR: 0,
        CENTER_OFFSET_FOCUS_SHIFT: 0,
        NODE_PF_FACTOR: 100,
        LAYER_CHANGE_COST: 0,
        RIPPING_PF_COST: 35,
        NODE_PF_MAX_PENALTY: 100,
        BASE_CANDIDATE_COST: 0.6,
        TOPOLOGY_STEP_COST: 1,
        TOPOLOGY_HEURISTIC_COST: 1,
        CROSSING_PENALTY: 4,
        CONFLICT_HISTORY_COST: 10,
        RIP_HISTORY_COST: 0.034,
        MAX_ITERATIONS_PER_PATH: 20_000,
        RANDOM_WALK_DISTANCE: 0,
        START_RIPPING_PF_THRESHOLD: 0.3,
        END_RIPPING_PF_THRESHOLD: 1,
        MAX_RIPS: 1_000,
        RANDOM_RIP_FRACTION: 0.3,
        STRAIGHT_LINE_DEVIATION_PENALTY_FACTOR: 0,
        GREEDY_MULTIPLIER: 0.55,
        MIN_ALLOWED_BOARD_SCORE: 0,
      },
    })
    this.MAX_ITERATIONS = this.hypergraphSolver.MAX_ITERATIONS + 1
  }

  override _step(): void {
    const solver = this.hypergraphSolver ?? this.legacySolver
    if (!solver) {
      this.failed = true
      this.error = "No port-point pathing solver was initialized"
      return
    }

    solver.step()
    if (solver.failed) {
      this.failed = true
      this.error = solver.error
      return
    }
    if (solver.solved) this.solved = true
  }

  get inputNodes(): InputNodeWithPortPoints[] {
    return this.legacySolver?.inputNodes ?? this.params.inputNodes
  }

  get connectionsWithResults(): ConnectionPathResult[] {
    if (this.legacySolver) return this.legacySolver.connectionsWithResults
    return (this.hypergraphSolver?.solvedRoutes ?? []).map((route) =>
      this.convertSolvedRoute(route),
    )
  }

  get assignedPortPoints(): Map<
    string,
    { connectionName: string; rootConnectionName?: string }
  > {
    if (this.legacySolver) return this.legacySolver.assignedPortPoints
    const assignments = new Map<
      string,
      { connectionName: string; rootConnectionName?: string }
    >()
    for (const node of this.getNodesWithPortPoints()) {
      for (const point of node.portPoints) {
        if (!point.portPointId) continue
        assignments.set(point.portPointId, {
          connectionName: point.connectionName,
          rootConnectionName: point.rootConnectionName,
        })
      }
    }
    return assignments
  }

  get nodeAssignedPortPoints(): Map<CapacityMeshNodeId, PortPoint[]> {
    if (this.legacySolver) return this.legacySolver.nodeAssignedPortPoints
    return new Map(
      this.getNodesWithPortPoints().map((node) => [
        node.capacityMeshNodeId,
        node.portPoints,
      ]),
    )
  }

  getNodesWithPortPoints(): NodeWithPortPoints[] {
    if (this.legacySolver) return this.legacySolver.getNodesWithPortPoints()
    const solver = this.hypergraphSolver
    if (!solver) return []

    const nodes = solver
      .getOutput()
      .nodesWithPortPoints.filter(
        (node) => !node.capacityMeshNodeId.startsWith("offboard:"),
      )
    const portalStubNodes = new Map<CapacityMeshNodeId, NodeWithPortPoints>()

    for (const route of solver.solvedRoutes) {
      for (const candidate of route.path) {
        const portalId = candidate.lastRegion?.d._offBoardConnectionId
        if (!portalId || !candidate.lastPort) continue
        this.addPortalStub(portalStubNodes, portalId, candidate.lastPort, route)
        this.addPortalStub(portalStubNodes, portalId, candidate.port, route)
      }
    }

    return [...nodes, ...portalStubNodes.values()]
  }

  private addPortalStub(
    portalStubNodes: Map<CapacityMeshNodeId, NodeWithPortPoints>,
    portalId: string,
    port: RegionPortHg,
    route: SolvedRoutesHg,
  ): void {
    const physicalNode = this.findClosestPhysicalPortalNode(portalId, port.d)
    if (!physicalNode) return

    const node =
      portalStubNodes.get(physicalNode.capacityMeshNodeId) ??
      ({
        capacityMeshNodeId: physicalNode.capacityMeshNodeId,
        center: physicalNode.center,
        width: physicalNode.width,
        height: physicalNode.height,
        availableZ: physicalNode.availableZ,
        portPoints: [],
      } satisfies NodeWithPortPoints)
    const connectionName = route.connection.connectionId
    if (
      node.portPoints.some(
        (point) =>
          point.connectionName === connectionName &&
          point.x === port.d.x &&
          point.y === port.d.y &&
          point.z === port.d.z,
      )
    ) {
      return
    }

    const rootConnectionName =
      route.connection.mutuallyConnectedNetworkId ?? connectionName
    const centerPortPointId = `portal-center:${physicalNode.capacityMeshNodeId}:${connectionName}:z${port.d.z}`
    node.portPoints.push(
      {
        portPointId: port.d.portId,
        x: port.d.x,
        y: port.d.y,
        z: port.d.z,
        connectionName,
        rootConnectionName,
        nextPortPointId: centerPortPointId,
      },
      {
        portPointId: centerPortPointId,
        x: physicalNode.center.x,
        y: physicalNode.center.y,
        z: port.d.z,
        connectionName,
        rootConnectionName,
        prevPortPointId: port.d.portId,
      },
    )
    portalStubNodes.set(physicalNode.capacityMeshNodeId, node)
  }

  private findClosestPhysicalPortalNode(
    portalId: string,
    point: { x: number; y: number },
  ): CapacityMeshNode | undefined {
    return this.params.capacityMeshNodes
      .filter((node) => node._offBoardConnectionId === portalId)
      .sort((a, b) => distance(a.center, point) - distance(b.center, point))[0]
  }

  private convertSolvedRoute(route: SolvedRoutesHg): ConnectionPathResult {
    const connection = route.connection.simpleRouteConnection!
    let previousCandidate: PortPointCandidate | null = null
    const path = route.path.map((candidate) => {
      const portalId = candidate.lastRegion?.d._offBoardConnectionId
      const physicalPortalNode = portalId
        ? this.findClosestPhysicalPortalNode(portalId, candidate.port.d)
        : undefined
      const converted: PortPointCandidate = {
        prevCandidate: previousCandidate,
        portPoint: {
          portPointId: candidate.port.d.portId,
          x: candidate.port.d.x,
          y: candidate.port.d.y,
          z: candidate.port.d.z,
          connectionNodeIds: candidate.port.d.regions.map(
            (region) => region.regionId,
          ) as [CapacityMeshNodeId, CapacityMeshNodeId],
          distToCentermostPortOnZ: candidate.port.d.distToCentermostPortOnZ,
        },
        currentNodeId:
          candidate.nextRegion?.regionId ?? route.connection.endRegion.regionId,
        throughNodeId: physicalPortalNode?.capacityMeshNodeId,
        point: { x: candidate.port.d.x, y: candidate.port.d.y },
        z: candidate.port.d.z,
        f: candidate.f,
        g: candidate.g,
        h: candidate.h,
        distanceTraveled: candidate.hops,
      }
      previousCandidate = converted
      return converted
    })

    return {
      connection,
      nodeIds: [
        route.connection.startRegion.regionId,
        route.connection.endRegion.regionId,
      ],
      path,
      straightLineDistance: distance(
        route.connection.startRegion.d.center,
        route.connection.endRegion.d.center,
      ),
    }
  }

  override visualize(): GraphicsObject {
    return (
      this.hypergraphSolver?.visualize() ??
      this.legacySolver?.visualize() ?? { lines: [], points: [] }
    )
  }

  override preview(): GraphicsObject {
    return this.visualize()
  }
}
