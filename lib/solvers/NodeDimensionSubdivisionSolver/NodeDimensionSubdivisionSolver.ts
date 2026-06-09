import type { GraphicsObject } from "graphics-debug"
import type { CapacityMeshNode } from "lib/types"
import { BaseSolver } from "lib/solvers/BaseSolver"

const DEFAULT_MIN_NODE_AREA = 0.1 ** 2

export class NodeDimensionSubdivisionSolver extends BaseSolver {
  public readonly outputNodes: CapacityMeshNode[]

  constructor(
    private readonly nodes: CapacityMeshNode[],
    private readonly maxNodeDimension: number,
    private readonly maxNodeRatio: number = Number.POSITIVE_INFINITY,
    private readonly minNodeArea: number = DEFAULT_MIN_NODE_AREA,
  ) {
    super()
    this.outputNodes = []
  }

  override getSolverName(): string {
    return "NodeDimensionSubdivisionSolver"
  }

  private getSubdivisionGrid(node: CapacityMeshNode): {
    cols: number
    rows: number
  } {
    const hasDimensionLimit =
      Number.isFinite(this.maxNodeDimension) && this.maxNodeDimension > 0
    const hasRatioLimit =
      Number.isFinite(this.maxNodeRatio) && this.maxNodeRatio > 0

    let cols = hasDimensionLimit
      ? Math.max(1, Math.ceil(node.width / this.maxNodeDimension))
      : 1
    let rows = hasDimensionLimit
      ? Math.max(1, Math.ceil(node.height / this.maxNodeDimension))
      : 1

    if (hasRatioLimit && node.width > 0 && node.height > 0) {
      while (true) {
        const childWidth = node.width / cols
        const childHeight = node.height / rows
        const childRatio =
          childWidth >= childHeight
            ? childWidth / childHeight
            : childHeight / childWidth

        if (childRatio <= this.maxNodeRatio) {
          break
        }

        if (childWidth >= childHeight) {
          cols++
        } else {
          rows++
        }
      }
    }

    return { cols, rows }
  }

  private shouldRemoveNode(node: CapacityMeshNode): boolean {
    const hasMinAreaLimit =
      Number.isFinite(this.minNodeArea) && this.minNodeArea > 0

    return hasMinAreaLimit && node.width * node.height < this.minNodeArea
  }

  private subdivideNode(node: CapacityMeshNode): CapacityMeshNode[] {
    if (this.shouldRemoveNode(node)) {
      return []
    }

    const { cols, rows } = this.getSubdivisionGrid(node)

    if (cols === 1 && rows === 1) {
      return [node]
    }

    const childWidth = node.width / cols
    const childHeight = node.height / rows
    const minX = node.center.x - node.width / 2
    const minY = node.center.y - node.height / 2

    const childNodes: CapacityMeshNode[] = []

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        childNodes.push({
          ...node,
          capacityMeshNodeId: `${node.capacityMeshNodeId}__sub_${row}_${col}`,
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
    const inputCount = this.nodes.length
    let subdividedNodeCount = 0
    let removedSmallNodeCount = 0

    for (const node of this.nodes) {
      const subdividedNodes = this.subdivideNode(node)
      if (subdividedNodes.length === 0) {
        removedSmallNodeCount++
        continue
      }

      if (subdividedNodes.length > 1) {
        subdividedNodeCount++
      }
      this.outputNodes.push(...subdividedNodes)
    }

    this.stats = {
      inputNodeCount: inputCount,
      outputNodeCount: this.outputNodes.length,
      subdividedNodeCount,
      removedSmallNodeCount,
      maxNodeDimension: this.maxNodeDimension,
      maxNodeRatio: this.maxNodeRatio,
      minNodeArea: this.minNodeArea,
    }
    this.solved = true
  }

  override visualize(): GraphicsObject {
    return {
      rects: this.outputNodes.map((node) => ({
        center: node.center,
        width: node.width,
        height: node.height,
        label: `${node.capacityMeshNodeId}\n${node.width.toFixed(2)}x${node.height.toFixed(2)}`,
        layer: `z${node.availableZ.join(",")}`,
        fill: "rgba(0, 200, 255, 0.08)",
        stroke: "rgba(0, 120, 180, 0.5)",
      })),
    }
  }
}
