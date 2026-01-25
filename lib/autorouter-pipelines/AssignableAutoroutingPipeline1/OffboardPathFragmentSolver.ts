import { BaseSolver } from "lib/solvers/BaseSolver"
import { GraphicsObject } from "graphics-debug"
import type {
  CapacityMeshEdge,
  CapacityMeshNode,
  CapacityPath,
  SimpleRouteConnection,
} from "lib/types"
import { getConnectionPointLayer } from "lib/types/srj-types"
import { isPointInRect } from "lib/utils/isPointInRect"
import { createNodeMap } from "lib/utils/createNodeMap"

type AnimationState = "showing_original_path" | "showing_fragment" | "done"

/**
 * Splits capacity paths at offboard edges into separate fragments.
 * When a path crosses an offboard edge (created by OffboardCapacityNodeSolver),
 * this solver breaks it into independent path segments.
 *
 * Each fragment becomes a separate connection with its own `connectionName`
 * (e.g., `AD_NET_frag_0`, `AD_NET_frag_1`). The solver also creates new
 * `SimpleRouteConnection` entries with appropriate `pointsToConnect` - the
 * original pad location plus a synthetic point at the offboard node.
 *
 * This enables downstream solvers to route each fragment independently,
 * treating them as separate traces that terminate at off-board connection points.
 */
export class OffboardPathFragmentSolver extends BaseSolver {
  override getSolverName(): string {
    return "OffboardPathFragmentSolver"
  }

  private inputPaths: CapacityPath[]
  private capacityEdges: CapacityMeshEdge[]
  private originalConnections: SimpleRouteConnection[]
  fragmentedPaths: CapacityPath[] = []
  fragmentedConnections: SimpleRouteConnection[] = []
  fragmentedOriginalConnectionNames: Set<string> = new Set()
  private nextFragmentId = 0

  // Animation state
  private animationState: AnimationState = "showing_original_path"
  private currentPath: CapacityPath | null = null
  private currentFragments: CapacityPath[] = []
  private currentFragmentIndex = 0

  // For visualization - store node map
  private nodeMap: Map<string, CapacityMeshNode> = new Map()

  constructor({
    capacityPaths,
    capacityEdges,
    capacityNodes,
    connections,
  }: {
    capacityPaths: CapacityPath[]
    capacityEdges: CapacityMeshEdge[]
    capacityNodes: CapacityMeshNode[]
    connections: SimpleRouteConnection[]
  }) {
    super()
    this.inputPaths = [...capacityPaths]
    this.capacityEdges = capacityEdges
    this.originalConnections = connections

    // Build node map for visualization and lookups
    this.nodeMap = createNodeMap(capacityNodes)
  }

  _step() {
    // State machine for animation
    switch (this.animationState) {
      case "showing_original_path": {
        // Get next path to process
        if (this.inputPaths.length === 0) {
          this.animationState = "done"
          this.solved = true
          return
        }

        this.currentPath = this.inputPaths.shift()!
        this.currentFragments = this.splitPath(this.currentPath)
        this.currentFragmentIndex = 0

        // Check if this path was fragmented
        const wasFragmented = this.currentFragments.some(
          (f) => f.isFragmentedPath,
        )
        if (wasFragmented) {
          // Move to showing fragments
          this.animationState = "showing_fragment"
        } else {
          // No fragmentation, just add the path as-is and get next
          this.fragmentedPaths.push(...this.currentFragments)
          // Stay in showing_original_path to get next path
        }
        break
      }

      case "showing_fragment": {
        if (this.currentFragmentIndex < this.currentFragments.length) {
          // Add one fragment at a time
          const fragment = this.currentFragments[this.currentFragmentIndex]
          this.fragmentedPaths.push(fragment)
          this.currentFragmentIndex++
        } else {
          // All fragments added, create connections and move to next path
          if (this.currentPath) {
            this.fragmentedOriginalConnectionNames.add(
              this.currentPath.connectionName,
            )
            this.createFragmentConnections(
              this.currentPath,
              this.currentFragments,
            )
          }

          // Reset and go back to showing_original_path for next path
          this.currentPath = null
          this.currentFragments = []
          this.currentFragmentIndex = 0
          this.animationState = "showing_original_path"
        }
        break
      }

      case "done": {
        this.solved = true
        break
      }
    }
  }

  private createFragmentConnections(
    originalPath: CapacityPath,
    fragments: CapacityPath[],
  ): void {
    const originalConnection = this.originalConnections.find(
      (c) => c.name === originalPath.connectionName,
    )
    if (!originalConnection) return

    for (let fragIdx = 0; fragIdx < fragments.length; fragIdx++) {
      const fragment = fragments[fragIdx]
      if (!fragment.isFragmentedPath) continue

      // Find which points from original connection are in this fragment's nodes
      const fragmentPoints = originalConnection.pointsToConnect.filter(
        (point) => {
          for (const nodeId of fragment.nodeIds) {
            const node = this.nodeMap.get(nodeId)
            if (!node) continue

            if (isPointInRect(point, node)) {
              return true
            }
          }
          return false
        },
      )

      const isFirstFragment = fragIdx === 0
      const offboardNodeId = isFirstFragment
        ? fragment.nodeIds[fragment.nodeIds.length - 1]
        : fragment.nodeIds[0]

      const offboardNode = this.nodeMap.get(offboardNodeId)

      if (fragmentPoints.length > 0 && offboardNode) {
        const realPoint = fragmentPoints[0]
        const syntheticPoint = {
          x: offboardNode.center.x,
          y: offboardNode.center.y,
          layer: getConnectionPointLayer(realPoint),
        }

        const pointsToConnect = isFirstFragment
          ? [...fragmentPoints, syntheticPoint]
          : [syntheticPoint, ...fragmentPoints]

        this.fragmentedConnections.push({
          name: fragment.connectionName,
          pointsToConnect,
          netConnectionName: originalConnection.netConnectionName,
          rootConnectionName: originalConnection.rootConnectionName, // Propagate rootConnectionName
        })
      }
    }
  }

  private splitPath(path: CapacityPath): CapacityPath[] {
    const { nodeIds } = path
    if (nodeIds.length < 2) {
      return [path]
    }

    // Find offboard edges
    const offboardIndices: number[] = []
    for (let i = 0; i < nodeIds.length - 1; i++) {
      const edge = this.capacityEdges.find(
        (e) =>
          (e.nodeIds[0] === nodeIds[i] && e.nodeIds[1] === nodeIds[i + 1]) ||
          (e.nodeIds[0] === nodeIds[i + 1] && e.nodeIds[1] === nodeIds[i]),
      )
      if (edge && edge.isOffboardEdge) {
        offboardIndices.push(i)
      }
    }

    if (offboardIndices.length === 0) {
      return [path]
    }

    const fragments: CapacityPath[] = []
    let startIdx = 0
    let fragmentIndex = 0

    for (const offboardIdx of offboardIndices) {
      const fragNodes = nodeIds.slice(startIdx, offboardIdx + 1)
      if (fragNodes.length >= 1) {
        const fragId = this.nextFragmentId++
        fragments.push({
          capacityPathId: `${path.capacityPathId}_frag_${fragId}`,
          connectionName: `${path.connectionName}_frag_${fragmentIndex++}`,
          rootConnectionName: path.rootConnectionName, // Propagate rootConnectionName
          nodeIds: fragNodes,
          isFragmentedPath: true,
          mstPairConnectionName: path.connectionName,
        })
      }
      startIdx = offboardIdx + 1
    }

    if (startIdx < nodeIds.length) {
      const fragNodes = nodeIds.slice(startIdx)
      if (fragNodes.length >= 1) {
        const fragId = this.nextFragmentId++
        fragments.push({
          capacityPathId: `${path.capacityPathId}_frag_${fragId}`,
          connectionName: `${path.connectionName}_frag_${fragmentIndex++}`,
          rootConnectionName: path.rootConnectionName, // Propagate rootConnectionName
          nodeIds: fragNodes,
          isFragmentedPath: true,
          mstPairConnectionName: path.connectionName,
        })
      }
    }

    return fragments.length > 0 ? fragments : [path]
  }

  getFragmentedPaths(): CapacityPath[] {
    return this.fragmentedPaths
  }

  getFragmentedConnections(): SimpleRouteConnection[] {
    return this.fragmentedConnections
  }

  getFragmentedOriginalConnectionNames(): Set<string> {
    return this.fragmentedOriginalConnectionNames
  }

  visualize(): GraphicsObject {
    const lines: any[] = []
    const points: any[] = []
    const rects: any[] = []

    // Draw the original path if we're showing it
    if (this.animationState === "showing_original_path" && this.currentPath) {
      this.drawPath({
        path: this.currentPath,
        color: "gray",
        lines,
        points,
        rects,
        labelPrefix: "Original: ",
      })
    }

    // Draw already processed fragments
    this.fragmentedPaths.forEach((path, idx) => {
      if (path.isFragmentedPath) {
        const color = idx % 2 === 0 ? "blue" : "red"
        this.drawPath({
          path,
          color,
          lines,
          points,
          rects,
          labelPrefix: `Frag ${idx}: `,
        })
      } else {
        this.drawPath({
          path,
          color: "green",
          lines,
          points,
          rects,
          labelPrefix: "",
        })
      }
    })

    // If we're in the middle of showing fragments, highlight current fragment being added
    if (
      this.animationState === "showing_fragment" &&
      this.currentFragmentIndex > 0
    ) {
      // The last added fragment gets highlighted
      const lastIdx = this.fragmentedPaths.length - 1
      if (lastIdx >= 0) {
        const lastPath = this.fragmentedPaths[lastIdx]
        if (lastPath.isFragmentedPath) {
          // Draw a highlight around the last fragment
          this.drawPath({
            path: lastPath,
            color: "orange",
            lines,
            points,
            rects,
            labelPrefix: "NEW: ",
          })
        }
      }
    }

    // Show offboard edges
    for (const edge of this.capacityEdges) {
      if (edge.isOffboardEdge) {
        const node1 = this.nodeMap.get(edge.nodeIds[0])
        const node2 = this.nodeMap.get(edge.nodeIds[1])
        if (node1 && node2) {
          lines.push({
            points: [node1.center, node2.center],
            strokeColor: "orange",
            strokeWidth: 0.15,
            strokeDasharray: "0.3,0.15",
          })
        }
      }
    }

    let title = "Offboard Path Fragment Solver"
    if (this.animationState === "showing_original_path") {
      title += " - Analyzing path..."
    } else if (this.animationState === "showing_fragment") {
      title += ` - Fragment ${this.currentFragmentIndex}/${this.currentFragments.length}`
    } else {
      title += ` - Done (${this.fragmentedPaths.filter((p) => p.isFragmentedPath).length} fragments)`
    }

    return {
      lines,
      points,
      rects,
      title,
    }
  }

  private drawPath(options: {
    path: CapacityPath
    color: string
    lines: any[]
    points: any[]
    rects: any[]
    labelPrefix: string
  }) {
    const { path, color, lines, points, rects, labelPrefix } = options
    const pathPoints: { x: number; y: number }[] = []

    for (let i = 0; i < path.nodeIds.length; i++) {
      const nodeId = path.nodeIds[i]
      const node = this.nodeMap.get(nodeId)
      if (!node) continue

      pathPoints.push(node.center)

      // Draw small rect for each node
      rects.push({
        center: node.center,
        width: node.width * 0.8,
        height: node.height * 0.8,
        stroke: color,
        strokeWidth: 0.05,
        fill: `${color}33`, // transparent fill
      })

      // Label first and last nodes
      if (i === 0 || i === path.nodeIds.length - 1) {
        points.push({
          x: node.center.x,
          y: node.center.y,
          color,
          label: `${labelPrefix}${path.connectionName}\n${nodeId}`,
        })
      }
    }

    // Draw line connecting the path
    if (pathPoints.length > 1) {
      lines.push({
        points: pathPoints,
        strokeColor: color,
        strokeWidth: 0.1,
      })
    }
  }
}
