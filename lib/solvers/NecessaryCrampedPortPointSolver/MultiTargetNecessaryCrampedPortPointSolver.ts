import { BaseSolver } from "@tscircuit/solver-utils"
import {
  CapacityMeshNode,
  CapacityMeshNodeId,
  SimpleRouteJson,
} from "lib/types"
import {
  SegmentPortPoint,
  SharedEdgeSegment,
} from "../AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import { GraphicsObject, mergeGraphics } from "graphics-debug"
import { isAllCandidatesBlockedByObstacles } from "./isAllCandidatesBlockedByObstacles"
import { costFunction } from "./costFunction"
import { ExploredPortPoint } from "./types"
import { pointToBoxDistance } from "@tscircuit/math-utils"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { SingleTargetNecessaryCrampedPortPointSolver } from "./SingleTargetNecessaryCrampedPortPointSolver"

const CRAMPED_NON_NECESSARY_PORT_PENALTY = 1_000
const MAX_CRAMPED_ESCAPE_BRANCHES_TO_KEEP = 5

export type MultiTargetNecessaryCrampedPortPointSolverInput = {
  sharedEdgeSegments: SharedEdgeSegment[]
  capacityMeshNodes: CapacityMeshNode[]
  simpleRouteJson: SimpleRouteJson
}

/**
 * This solver filters out cramped port points that are not necessary.
 */
export class MultiTargetNecessaryCrampedPortPointSolver extends BaseSolver {
  private unprocessedTargets: CapacityMeshNode[] = []
  private targetNode: CapacityMeshNode[] = []

  private currentTarget: CapacityMeshNode | undefined

  private crampedPortPointsToKeep: Set<SegmentPortPoint> = new Set()
  private candidatesAtDepth: ExploredPortPoint[] = []
  private isRunningCrampedPass = false
  private filteredOutput?: SharedEdgeSegment[]

  override activeSubSolver: SingleTargetNecessaryCrampedPortPointSolver | null =
    null

  /**
   * NOTE: I do not like maps, add a capacityMeshNode ref inside SegmentPortPoints
   * in future so we do not need the capacityMeshNodeId
   */
  private nodeMap = new Map<CapacityMeshNodeId, CapacityMeshNode>()
  private mapOfCapacityMeshNodeIdToSegmentPortPoints = new Map<
    CapacityMeshNodeId,
    SegmentPortPoint[]
  >()
  constructor(private input: MultiTargetNecessaryCrampedPortPointSolverInput) {
    super()
    /**
     * TODO: AutoroutingPipeline2_HgPortPointSolver does not call setup
     * Add support for calling setup in the pipeline runner and remove this call to setup in the constructor.
     */
    this._setup()
  }

  getSolverName(): string {
    return "multiTargetNecessaryCrampedPortPointSolver"
  }

  override _setup(): void {
    this.targetNode = this.input.capacityMeshNodes.filter(
      (cm) => cm._containsObstacle,
    )
    this.targetNode = this.targetNode.filter((cmNode) => {
      for (const connection of this.input.simpleRouteJson.connections) {
        for (const point of connection.pointsToConnect) {
          if (pointToBoxDistance(point, cmNode) <= 0) {
            return true
          }
        }
      }
      return false
    })
    this.unprocessedTargets = [...this.targetNode]
    this.unprocessedTargets.sort((a, b) => a.center.x - b.center.x)

    for (const cmNode of this.input.capacityMeshNodes) {
      this.nodeMap.set(cmNode.capacityMeshNodeId, cmNode)
    }

    for (const sharedEdgeSegment of this.input.sharedEdgeSegments) {
      for (const segmentPortPoint of sharedEdgeSegment.portPoints) {
        const cmNodeIds = segmentPortPoint.nodeIds
        for (const id of cmNodeIds) {
          const cmNode = this.nodeMap.get(id)
          if (!cmNode) {
            throw new Error(`Could not find capacity mesh node for id ${id}`)
          }
          const existingSegmentPortPoints =
            this.mapOfCapacityMeshNodeIdToSegmentPortPoints.get(id) || []
          this.mapOfCapacityMeshNodeIdToSegmentPortPoints.set(id, [
            ...existingSegmentPortPoints,
            segmentPortPoint,
          ])
        }
      }
    }
  }

  override _step(): void {
    if (this.activeSubSolver) {
      this.activeSubSolver._step()
      if (!this.activeSubSolver.solved) {
        return
      }
      if (this.activeSubSolver.failed) {
        this.failed = true
        this.error = this.activeSubSolver.error
        return
      }

      this.candidatesAtDepth = this.activeSubSolver.getOutput()
      this.activeSubSolver = null

      if (!this.currentTarget) {
        this.failed = true
        this.error = "Missing current capacity mesh node while finishing BFS"
        return
      }

      if (!this.isRunningCrampedPass) {
        const areAllCandidatesBlocked = isAllCandidatesBlockedByObstacles({
          candidates: this.candidatesAtDepth,
          mapOfCapacityMeshNodeIdToRef: this.nodeMap,
        })

        if (areAllCandidatesBlocked || this.candidatesAtDepth.length === 0) {
          this.isRunningCrampedPass = true
          this.activeSubSolver =
            new SingleTargetNecessaryCrampedPortPointSolver({
              target: this.currentTarget,
              depthLimit: 3,
              shouldIgnoreCrampedPortPoints: false,
              mapOfCapacityMeshNodeIdToSegmentPortPoints:
                this.mapOfCapacityMeshNodeIdToSegmentPortPoints,
              mapOfCapacityMeshNodeIdToRef: this.nodeMap,
            })
          return
        }

        this.currentTarget = undefined
        return
      }

      let crampedCandidates = this.candidatesAtDepth.filter((candidate) => {
        const port = candidate.port
        const capacityMeshNodes = port.nodeIds.map((nodeId) => {
          const cmNode = this.nodeMap.get(nodeId)
          if (!cmNode) {
            this.failed = true
            this.error = `Could not find capacity mesh node for id ${nodeId}`
            throw new Error(
              `Could not find capacity mesh node for id ${nodeId}`,
            )
          }
          return cmNode
        })
        return (
          capacityMeshNodes.every((cmNode) => !cmNode._containsObstacle) &&
          port.cramped
        )
      })

      const areAllCrampedCandidatesBlocked = isAllCandidatesBlockedByObstacles({
        candidates: crampedCandidates,
        mapOfCapacityMeshNodeIdToRef: this.nodeMap,
      })

      if (areAllCrampedCandidatesBlocked) {
        this.error = `All candidates are blocked by obstacles even after including cramped port points for capacity mesh node ${this.currentTarget.capacityMeshNodeId}`
      }

      this.candidatesAtDepth = [...crampedCandidates].sort((a, b) => {
        const costDifference = costFunction(a) - costFunction(b)
        if (costDifference !== 0) {
          return costDifference
        }
        return (
          this.getCandidateExitCapacity(b) - this.getCandidateExitCapacity(a)
        )
      })
      if (this.candidatesAtDepth.length === 0) {
        this.error = `No candidates found for capacity mesh node ${this.currentTarget.capacityMeshNodeId} even after including cramped port points`
      } else {
        const firstCandidateByBranchPath = new Map<string, ExploredPortPoint>()
        for (const candidate of this.candidatesAtDepth) {
          if (!candidate.parent) {
            throw new Error(
              `Missing parent for cramped escape candidate ${candidate.port.segmentPortPointId}`,
            )
          }
          const branchPathId = `${candidate.parent.port.segmentPortPointId}->${candidate.port.segmentPortPointId}`
          if (!firstCandidateByBranchPath.has(branchPathId)) {
            firstCandidateByBranchPath.set(branchPathId, candidate)
            if (
              firstCandidateByBranchPath.size ===
              MAX_CRAMPED_ESCAPE_BRANCHES_TO_KEEP
            ) {
              break
            }
          }
        }
        const diverseCandidates = [...firstCandidateByBranchPath.values()]
        for (const candidate of diverseCandidates) {
          this.keepCandidatePath(candidate)
        }
      }

      this.isRunningCrampedPass = false
      this.currentTarget = undefined
      return
    }

    if (!this.currentTarget) {
      this.currentTarget = this.unprocessedTargets.shift()
      if (!this.currentTarget) {
        this.solved = true
        return
      }
      this.isRunningCrampedPass = false
      this.candidatesAtDepth = []
      this.activeSubSolver = new SingleTargetNecessaryCrampedPortPointSolver({
        target: this.currentTarget,
        depthLimit: 2,
        shouldIgnoreCrampedPortPoints: true,
        mapOfCapacityMeshNodeIdToSegmentPortPoints:
          this.mapOfCapacityMeshNodeIdToSegmentPortPoints,
        mapOfCapacityMeshNodeIdToRef: this.nodeMap,
      })
      return
    }
  }

  getNormallyKeptPortPoints(): Set<SegmentPortPoint> {
    return new Set(
      this.input.sharedEdgeSegments.flatMap((segment) =>
        segment.portPoints.filter(
          (port) =>
            !port.cramped ||
            this.crampedPortPointsToKeep.has(port) ||
            this.isMultilayerEscapePort(port),
        ),
      ),
    )
  }

  private getRequiredPreloadedCrampedPorts(): Set<SegmentPortPoint> {
    const ports = this.input.sharedEdgeSegments.flatMap(
      (segment) => segment.portPoints,
    )
    const normallyKept = this.getNormallyKeptPortPoints()
    const candidates = ports.filter(
      (port) =>
        !normallyKept.has(port) &&
        (port._preloadedTracePortAssignments?.length ?? 0) > 0,
    )
    const required = new Set<SegmentPortPoint>()
    if (candidates.length === 0) return required
    const connMap = getConnectivityMapFromSimpleRouteJson(
      this.input.simpleRouteJson,
    )
    const fixedNetIds = new Set(
      candidates.flatMap((port) =>
        port._preloadedTracePortAssignments!.map(
          ({ fixedNetId }) => fixedNetId,
        ),
      ),
    )
    for (const fixedNetId of fixedNetIds) {
      const parents = new Map<string, string>()
      const find = (key: string): string => {
        let root = key
        while (parents.has(root)) root = parents.get(root)!
        while (key !== root) {
          const next = parents.get(key)!
          parents.set(key, root)
          key = next
        }
        return root
      }
      const allowedNodes = new Set(
        this.input.capacityMeshNodes
          .filter(
            (node) =>
              !node._containsObstacle ||
              node._connectedTo?.some(
                (id) => connMap.getNetConnectedToId(id) === fixedNetId,
              ),
          )
          .map((node) => node.capacityMeshNodeId),
      )
      // Same-net pads and multilayer regions are legal routes; foreign pads
      // must not hide an isolated preloaded endpoint.
      for (const node of this.input.capacityMeshNodes) {
        if (!allowedNodes.has(node.capacityMeshNodeId)) continue
        const [firstZ, ...otherLayers] = node.availableZ
        for (const z of otherLayers) {
          parents.set(
            `${node.capacityMeshNodeId}:${z}`,
            `${node.capacityMeshNodeId}:${firstZ}`,
          )
        }
      }
      for (const port of normallyKept) {
        if (!port.nodeIds.every((id) => allowedNodes.has(id))) continue
        for (const z of port.availableZ) {
          const left = find(`${port.nodeIds[0]}:${z}`)
          const right = find(`${port.nodeIds[1]}:${z}`)
          if (left !== right) parents.set(left, right)
        }
      }
      const anchors = new Set<string>()
      for (const port of normallyKept) {
        for (const assignment of port._preloadedTracePortAssignments ?? []) {
          if (assignment.fixedNetId !== fixedNetId) continue
          for (const id of port.nodeIds) {
            if (allowedNodes.has(id)) anchors.add(find(`${id}:${assignment.z}`))
          }
        }
      }
      const edges = candidates.flatMap((port) =>
        port.nodeIds.every((id) => allowedNodes.has(id))
          ? port
              ._preloadedTracePortAssignments!.filter(
                (assignment) => assignment.fixedNetId === fixedNetId,
              )
              .map(({ z }) => ({
                port,
                left: find(`${port.nodeIds[0]}:${z}`),
                right: find(`${port.nodeIds[1]}:${z}`),
              }))
          : [],
      )
      const adjacency = new Map<string, Set<number>>()
      const retainedEdges = new Set<number>()
      for (const [index, edge] of edges.entries()) {
        const left = find(edge.left)
        const right = find(edge.right)
        if (left === right) continue
        parents.set(left, right)
        retainedEdges.add(index)
        for (const endpoint of [edge.left, edge.right]) {
          if (!adjacency.has(endpoint)) adjacency.set(endpoint, new Set())
          adjacency.get(endpoint)!.add(index)
        }
      }
      // Keep paths between existing preloaded regions, not dangling branches
      // that introduce new sections without repairing any endpoint.
      const leaves = [...adjacency.keys()].filter(
        (key) => !anchors.has(key) && adjacency.get(key)!.size === 1,
      )
      while (leaves.length > 0) {
        const leaf = leaves.pop()!
        for (const index of adjacency.get(leaf)!) {
          retainedEdges.delete(index)
          const edge = edges[index]!
          for (const endpoint of [edge.left, edge.right]) {
            const neighbors = adjacency.get(endpoint)!
            neighbors.delete(index)
            if (!anchors.has(endpoint) && neighbors.size === 1) {
              leaves.push(endpoint)
            }
          }
        }
      }
      for (const index of retainedEdges) required.add(edges[index]!.port)
    }
    return required
  }

  override getOutput(): SharedEdgeSegment[] {
    if (this.filteredOutput) {
      return this.filteredOutput
    }

    const requiredPreloadedPorts = this.getRequiredPreloadedCrampedPorts()
    this.filteredOutput = this.input.sharedEdgeSegments.map((segment) => ({
      ...segment,
      portPoints: segment.portPoints.flatMap((portPoint) => {
        if (!portPoint.cramped || this.crampedPortPointsToKeep.has(portPoint)) {
          return [portPoint]
        }

        // Preserve preloaded crossings only when needed for connectivity.
        // Keep the cramped penalty so ordinary routes prefer wider passages.
        if (
          this.isMultilayerEscapePort(portPoint) ||
          requiredPreloadedPorts.has(portPoint)
        ) {
          return [
            {
              ...portPoint,
              tinyHypergraphPortPenalty: CRAMPED_NON_NECESSARY_PORT_PENALTY,
            },
          ]
        }

        return []
      }),
    }))
    return this.filteredOutput
  }

  private getCandidateExitCapacity(candidate: ExploredPortPoint): number {
    if (!candidate.parent) {
      throw new Error(
        `Missing parent for cramped escape candidate ${candidate.port.segmentPortPointId}`,
      )
    }
    const previousNodeIds = new Set(candidate.parent.port.nodeIds)
    const exitNodes = candidate.port.nodeIds
      .filter((nodeId) => !previousNodeIds.has(nodeId))
      .map((nodeId) => {
        const node = this.nodeMap.get(nodeId)
        if (!node) {
          throw new Error(`Could not find capacity mesh node for id ${nodeId}`)
        }
        return node
      })
    if (exitNodes.length === 0) {
      throw new Error(
        `Could not find exit node for cramped escape candidate ${candidate.port.segmentPortPointId}`,
      )
    }
    return Math.max(
      0,
      ...exitNodes.map(
        (node) => node.width * node.height * node.availableZ.length,
      ),
    )
  }

  private keepCandidatePath(candidate: ExploredPortPoint): void {
    this.crampedPortPointsToKeep.add(candidate.port)
    let parent = candidate.parent
    while (parent) {
      this.crampedPortPointsToKeep.add(parent.port)
      parent = parent.parent
    }
  }

  private isMultilayerEscapePort(portPoint: SegmentPortPoint): boolean {
    return portPoint.nodeIds.some(
      (nodeId) => (this.nodeMap.get(nodeId)?.availableZ.length ?? 0) > 1,
    )
  }

  override visualize(): GraphicsObject {
    const graphics: GraphicsObject = {
      rects: [],
      points: [],
    }

    for (const obstacleCmNode of this.targetNode) {
      graphics.rects!.push({
        ...obstacleCmNode,
        fill:
          this.currentTarget?.capacityMeshNodeId ===
          obstacleCmNode.capacityMeshNodeId
            ? "rgba(255, 0, 0, 0.5)"
            : "rgba(255, 0, 0, 0.2)",
      })
    }

    for (const candidate of this.candidatesAtDepth) {
      graphics.points!.push({
        ...candidate.port,
        color: candidate.port.cramped ? "blue" : "green",
      })
    }

    for (const crampedPortPoint of this.crampedPortPointsToKeep) {
      graphics.points!.push({
        ...crampedPortPoint,
        color: "blue",
      })
    }

    if (this.activeSubSolver) {
      return mergeGraphics(graphics, this.activeSubSolver.visualize())
    }

    return graphics
  }
}
