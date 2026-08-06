import type { GraphicsObject } from "graphics-debug"
import { CapacityNodeTree } from "lib/data-structures/CapacityNodeTree"
import { BaseSolver } from "lib/solvers/BaseSolver"
import type { CapacityMeshNode } from "lib/types"

const BORDER_EPSILON = 0.001

type PortLoadSubdivisionSolverParams = {
  nodes: CapacityMeshNode[]
  minPortSpacing: number
}

type BoundaryLoad = {
  horizontalPortCount: number
  verticalPortCount: number
}

const getBounds = (node: CapacityMeshNode) => ({
  minX: node.center.x - node.width / 2,
  maxX: node.center.x + node.width / 2,
  minY: node.center.y - node.height / 2,
  maxY: node.center.y + node.height / 2,
})

const getSharedLayerCount = (
  firstNode: CapacityMeshNode,
  secondNode: CapacityMeshNode,
) =>
  firstNode.availableZ.filter((z) => secondNode.availableZ.includes(z)).length

const getPortPositionCount = (length: number, minPortSpacing: number) => {
  const edgeMargin = (minPortSpacing * 3) / 4
  const effectiveLength = Math.max(0, length - edgeMargin * 2)
  let portPositionCount = Math.max(
    1,
    Math.floor(effectiveLength / minPortSpacing) + 1,
  )

  if (portPositionCount > 5) {
    portPositionCount = 5 + Math.floor(portPositionCount / 4)
  }

  return portPositionCount
}

const getSharedBoundary = (
  firstNode: CapacityMeshNode,
  secondNode: CapacityMeshNode,
): { direction: "horizontal" | "vertical"; length: number } | undefined => {
  const first = getBounds(firstNode)
  const second = getBounds(secondNode)
  const verticalOverlap =
    Math.min(first.maxY, second.maxY) - Math.max(first.minY, second.minY)
  const horizontalOverlap =
    Math.min(first.maxX, second.maxX) - Math.max(first.minX, second.minX)

  const sharesVerticalBoundary =
    verticalOverlap >= BORDER_EPSILON &&
    (Math.abs(first.maxX - second.minX) < BORDER_EPSILON ||
      Math.abs(first.minX - second.maxX) < BORDER_EPSILON)
  if (sharesVerticalBoundary) {
    return { direction: "vertical", length: verticalOverlap }
  }

  const sharesHorizontalBoundary =
    horizontalOverlap >= BORDER_EPSILON &&
    (Math.abs(first.maxY - second.minY) < BORDER_EPSILON ||
      Math.abs(first.minY - second.maxY) < BORDER_EPSILON)
  if (sharesHorizontalBoundary) {
    return { direction: "horizontal", length: horizontalOverlap }
  }

  return undefined
}

/**
 * Subdivides free regions whose fragmented boundary would create more port
 * points than can physically fit around that boundary. External boundaries
 * are preserved; subdivision only replaces one high-fanout region with a
 * connected grid of lower-fanout regions.
 */
export class PortLoadSubdivisionSolver extends BaseSolver {
  readonly outputNodes: CapacityMeshNode[] = []
  private readonly nodeTree: CapacityNodeTree

  constructor(private readonly params: PortLoadSubdivisionSolverParams) {
    super()
    this.nodeTree = new CapacityNodeTree(params.nodes)
  }

  override getSolverName(): string {
    return "PortLoadSubdivisionSolver"
  }

  private getBoundaryLoad(node: CapacityMeshNode): BoundaryLoad {
    const boundaryLoad: BoundaryLoad = {
      horizontalPortCount: 0,
      verticalPortCount: 0,
    }
    const nearbyNodes = this.nodeTree.getNodesInArea(
      node.center.x,
      node.center.y,
      node.width * 2,
      node.height * 2,
    )

    for (const neighbor of nearbyNodes) {
      if (neighbor.capacityMeshNodeId === node.capacityMeshNodeId) continue
      const sharedLayerCount = getSharedLayerCount(node, neighbor)
      if (sharedLayerCount === 0) continue
      const sharedBoundary = getSharedBoundary(node, neighbor)
      if (!sharedBoundary) continue

      const portCount =
        getPortPositionCount(
          sharedBoundary.length,
          this.params.minPortSpacing,
        ) * sharedLayerCount
      if (sharedBoundary.direction === "horizontal") {
        boundaryLoad.horizontalPortCount += portCount
      } else {
        boundaryLoad.verticalPortCount += portCount
      }
    }

    return boundaryLoad
  }

  private getSubdivisionGrid(node: CapacityMeshNode): {
    cols: number
    rows: number
  } {
    if (
      node._containsObstacle ||
      node._containsTarget ||
      node._isVirtualOffboard ||
      node._offBoardConnectionId
    ) {
      return { cols: 1, rows: 1 }
    }

    const boundaryLoad = this.getBoundaryLoad(node)
    const layerCount = Math.max(1, node.availableZ.length)
    const horizontalPortCapacity = Math.max(
      1,
      Math.floor((node.width * 2) / this.params.minPortSpacing) * layerCount,
    )
    const verticalPortCapacity = Math.max(
      1,
      Math.floor((node.height * 2) / this.params.minPortSpacing) * layerCount,
    )
    const maxCols = Math.max(
      1,
      Math.floor(node.width / this.params.minPortSpacing),
    )
    const maxRows = Math.max(
      1,
      Math.floor(node.height / this.params.minPortSpacing),
    )

    const projectedPortCount =
      boundaryLoad.horizontalPortCount + boundaryLoad.verticalPortCount
    const perimeterPortCapacity =
      horizontalPortCapacity + verticalPortCapacity
    const requiredChildCount = Math.max(
      1,
      Math.ceil(projectedPortCount / perimeterPortCapacity),
    )
    if (requiredChildCount === 1) return { cols: 1, rows: 1 }

    const horizontalLoadFraction =
      boundaryLoad.horizontalPortCount / projectedPortCount
    let cols = Math.min(
      maxCols,
      Math.max(
        1,
        Math.ceil(requiredChildCount ** horizontalLoadFraction),
      ),
    )
    let rows = Math.min(
      maxRows,
      Math.max(1, Math.ceil(requiredChildCount / cols)),
    )
    if (cols * rows < requiredChildCount) {
      cols = Math.min(
        maxCols,
        Math.max(cols, Math.ceil(requiredChildCount / rows)),
      )
    }

    return { cols, rows }
  }

  private subdivideNode(node: CapacityMeshNode): CapacityMeshNode[] {
    const { cols, rows } = this.getSubdivisionGrid(node)
    if (cols === 1 && rows === 1) return [node]

    const childWidth = node.width / cols
    const childHeight = node.height / rows
    const minX = node.center.x - node.width / 2
    const minY = node.center.y - node.height / 2
    const childNodes: CapacityMeshNode[] = []

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        childNodes.push({
          ...node,
          capacityMeshNodeId: `${node.capacityMeshNodeId}__port_load_${row}_${col}`,
          center: {
            x: minX + childWidth * (col + 0.5),
            y: minY + childHeight * (row + 0.5),
          },
          width: childWidth,
          height: childHeight,
          availableZ: [...node.availableZ],
        })
      }
    }

    return childNodes
  }

  override _step() {
    let subdividedNodeCount = 0
    for (const node of this.params.nodes) {
      const childNodes = this.subdivideNode(node)
      if (childNodes.length > 1) subdividedNodeCount++
      this.outputNodes.push(...childNodes)
    }

    this.stats = {
      inputNodeCount: this.params.nodes.length,
      outputNodeCount: this.outputNodes.length,
      subdividedNodeCount,
      minPortSpacing: this.params.minPortSpacing,
    }
    this.solved = true
  }

  override visualize(): GraphicsObject {
    return {
      rects: this.outputNodes.map((node) => ({
        center: node.center,
        width: node.width,
        height: node.height,
        label: node.capacityMeshNodeId,
        layer: `z${node.availableZ.join(",")}`,
        fill: "rgba(80, 150, 255, 0.08)",
        stroke: "rgba(40, 100, 200, 0.5)",
      })),
    }
  }
}
