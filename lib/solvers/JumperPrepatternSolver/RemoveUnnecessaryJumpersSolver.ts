import { BaseSolver } from "../BaseSolver"
import type { GraphicsObject } from "graphics-debug"
import type { InputNodeWithPortPoints } from "../PortPointPathingSolver/PortPointPathingSolver"
import type { CapacityMeshNodeId } from "../../types"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"

export interface RemoveUnnecessaryJumpersSolverParams {
  /**
   * Input nodes from the PortPointPathingSolver
   */
  inputNodes: InputNodeWithPortPoints[]

  /**
   * Set of jumper off-board connection IDs that were actually used by routes
   */
  usedJumperOffBoardObstacleIds: Set<string>

  /**
   * Connectivity map for off-board obstacles (used to check if a jumper net was used)
   */
  offBoardConnMap?: ConnectivityMap | null
}

/**
 * RemoveUnnecessaryJumpersSolver removes jumpers that aren't needed because
 * there are no traces between the pads. It converts unused jumper nodes back
 * to regular nodes so the high density solver can route through them normally.
 *
 * This solver runs after PortPointPathingSolver and before HighDensitySolver.
 */
export class RemoveUnnecessaryJumpersSolver extends BaseSolver {
  inputNodes: InputNodeWithPortPoints[]
  usedJumperOffBoardObstacleIds: Set<string>
  offBoardConnMap: ConnectivityMap | null

  /**
   * Output nodes with unused jumper nodes converted to regular nodes
   */
  outputNodes: InputNodeWithPortPoints[] = []

  /**
   * Set of off-board connection IDs that were removed
   */
  removedOffBoardConnectionIds: Set<string> = new Set()

  constructor(params: RemoveUnnecessaryJumpersSolverParams) {
    super()
    this.inputNodes = params.inputNodes
    this.usedJumperOffBoardObstacleIds = params.usedJumperOffBoardObstacleIds
    this.offBoardConnMap = params.offBoardConnMap ?? null
    this.MAX_ITERATIONS = 1
  }

  /**
   * Check if a jumper off-board connection ID was used
   */
  private isJumperUsed(offBoardConnectionId: string): boolean {
    // Direct match
    if (this.usedJumperOffBoardObstacleIds.has(offBoardConnectionId)) {
      return true
    }

    // Check via connectivity map if available
    if (this.offBoardConnMap) {
      const netId =
        this.offBoardConnMap.getNetConnectedToId(offBoardConnectionId)
      if (netId && this.usedJumperOffBoardObstacleIds.has(netId)) {
        return true
      }
    }

    return false
  }

  _step(): void {
    // Build a map of off-board connection ID -> list of node IDs
    const offBoardConnectionToNodeIds = new Map<string, CapacityMeshNodeId[]>()

    for (const node of this.inputNodes) {
      if (node._offBoardConnectionId) {
        const existing = offBoardConnectionToNodeIds.get(
          node._offBoardConnectionId,
        )
        if (existing) {
          existing.push(node.capacityMeshNodeId)
        } else {
          offBoardConnectionToNodeIds.set(node._offBoardConnectionId, [
            node.capacityMeshNodeId,
          ])
        }
      }
    }

    // Determine which off-board connection IDs to remove
    for (const [offBoardConnectionId] of offBoardConnectionToNodeIds) {
      if (!this.isJumperUsed(offBoardConnectionId)) {
        this.removedOffBoardConnectionIds.add(offBoardConnectionId)
      }
    }

    // Create output nodes with unused jumper nodes converted to regular nodes
    this.outputNodes = this.inputNodes.map((node) => {
      if (
        node._offBoardConnectionId &&
        this.removedOffBoardConnectionIds.has(node._offBoardConnectionId)
      ) {
        // Convert to regular node by removing off-board properties
        return {
          ...node,
          _offBoardConnectionId: undefined,
          _offBoardConnectedCapacityMeshNodeIds: undefined,
        }
      }

      // For nodes that reference removed off-board connections in their
      // connected nodes list, we need to update that list too
      if (
        node._offBoardConnectedCapacityMeshNodeIds &&
        node._offBoardConnectedCapacityMeshNodeIds.length > 0
      ) {
        // Filter out nodes that are no longer off-board connected
        const updatedConnectedIds =
          node._offBoardConnectedCapacityMeshNodeIds.filter((connectedId) => {
            const connectedNode = this.inputNodes.find(
              (n) => n.capacityMeshNodeId === connectedId,
            )
            if (
              connectedNode?._offBoardConnectionId &&
              this.removedOffBoardConnectionIds.has(
                connectedNode._offBoardConnectionId,
              )
            ) {
              return false
            }
            return true
          })

        if (
          updatedConnectedIds.length !==
          node._offBoardConnectedCapacityMeshNodeIds.length
        ) {
          return {
            ...node,
            _offBoardConnectedCapacityMeshNodeIds:
              updatedConnectedIds.length > 0 ? updatedConnectedIds : undefined,
          }
        }
      }

      return node
    })

    this.solved = true
  }

  getOutput(): InputNodeWithPortPoints[] {
    return this.outputNodes
  }

  visualize(): GraphicsObject {
    // Simple visualization showing removed jumper nodes
    const graphics: GraphicsObject = {
      rects: [],
      points: [],
    }

    for (const node of this.inputNodes) {
      if (
        node._offBoardConnectionId &&
        this.removedOffBoardConnectionIds.has(node._offBoardConnectionId)
      ) {
        graphics.rects!.push({
          center: node.center,
          width: node.width,
          height: node.height,
          fill: "rgba(255, 0, 0, 0.2)",
          stroke: "rgba(255, 0, 0, 0.5)",
          label: `Removed: ${node._offBoardConnectionId}`,
        })
      }
    }

    return graphics
  }
}
