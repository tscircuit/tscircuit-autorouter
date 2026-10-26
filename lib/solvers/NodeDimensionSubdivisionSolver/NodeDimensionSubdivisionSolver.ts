import type { GraphicsObject } from "graphics-debug"
import Flatbush from "flatbush"
import type { CapacityMeshNode } from "lib/types"
import { BaseSolver } from "lib/solvers/BaseSolver"
import { areNodesBordering } from "lib/utils/areNodesBordering"

const DEFAULT_MIN_NODE_AREA = 0.1 ** 2
// Twice areNodesBordering's epsilon; thinner slices are coordinate artifacts.
const MIN_CONNECTIVITY_BRIDGE_DIMENSION = 0.002
const CONNECTIVITY_BRIDGE_QUERY_PADDING = 0.002
const FREE_SPAN_EPSILON = 1e-10
const GLOBAL_FREE_GEOMETRY_KEYS = new Set([
  "capacityMeshNodeId",
  "center",
  "width",
  "height",
  "layer",
  "availableZ",
])
const EMPTY_GLOBAL_FREE_ROLE_KEYS = new Set([
  "_containsObstacle",
  "_containsTarget",
  "_completelyInsideObstacle",
  "_isComponentTopologyNode",
  "_isNarrowQfpPadGap",
])

type BridgeNodeIndex = {
  index: Flatbush
  originalNodeIndices: number[]
}

type BridgeNodeWorkspace = {
  bridgeNodeIndex?: BridgeNodeIndex
}

function isPlainGlobalFreeNode(node: CapacityMeshNode): boolean {
  if (
    node.availableZ.length === 0 ||
    node.availableZ.some((z) => !Number.isInteger(z) || z < 0)
  )
    return false
  if (
    ![node.center.x, node.center.y, node.width, node.height].every(
      Number.isFinite,
    ) ||
    node.width <= 0 ||
    node.height <= 0
  )
    return false
  // Unknown metadata can describe ownership, component gaps or offboard links.
  // Keep their subdivision behavior intact, even when the free-span floor is on.
  return Object.entries(node).every(
    ([key, value]) =>
      GLOBAL_FREE_GEOMETRY_KEYS.has(key) ||
      value === undefined ||
      (EMPTY_GLOBAL_FREE_ROLE_KEYS.has(key) && value === false),
  )
}

const createBridgeNodeIndex = (nodes: CapacityMeshNode[]): BridgeNodeIndex => {
  const originalNodeIndices: number[] = []
  for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex++) {
    const node = nodes[nodeIndex]!
    // These coordinates cannot satisfy areNodesBordering against a finite
    // bridge. Infinite dimensions can, so retain their unbounded rectangles.
    if (
      !Number.isFinite(node.center.x) ||
      !Number.isFinite(node.center.y) ||
      Number.isNaN(node.width) ||
      Number.isNaN(node.height)
    ) {
      continue
    }
    originalNodeIndices.push(nodeIndex)
  }

  // The finite bridge requesting this index is itself an indexed original.
  if (originalNodeIndices.length === 0) {
    throw new Error("Connectivity bridge index has no original nodes")
  }
  const index = new Flatbush(originalNodeIndices.length)
  for (const nodeIndex of originalNodeIndices) {
    const node = nodes[nodeIndex]!
    const left = node.center.x - node.width / 2
    const right = node.center.x + node.width / 2
    const top = node.center.y - node.height / 2
    const bottom = node.center.y + node.height / 2
    // Canonical bounds also cover the original predicate's negative-dimension
    // cases. Clipping infinities preserves intersections with finite bridges.
    index.add(
      Math.max(-Number.MAX_VALUE, Math.min(left, right)),
      Math.max(-Number.MAX_VALUE, Math.min(top, bottom)),
      Math.min(Number.MAX_VALUE, Math.max(left, right)),
      Math.min(Number.MAX_VALUE, Math.max(top, bottom)),
    )
  }
  index.finish()
  return { index, originalNodeIndices }
}

export class NodeDimensionSubdivisionSolver extends BaseSolver {
  public readonly outputNodes: CapacityMeshNode[]

  /**
   * The dimension limit has priority. Opting into minimumFreeNodeSpan makes
   * the ratio limit best effort for plain global free cells on any layer set.
   */
  constructor(
    private readonly nodes: CapacityMeshNode[],
    private readonly maxNodeDimension: number,
    private readonly maxNodeRatio: number = Number.POSITIVE_INFINITY,
    private readonly minNodeArea: number = DEFAULT_MIN_NODE_AREA,
    private readonly minimumFreeNodeSpan: number = 0,
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
      const preserveOrdinaryFreePorts =
        Number.isFinite(this.minimumFreeNodeSpan) &&
        this.minimumFreeNodeSpan > 0 &&
        isPlainGlobalFreeNode(node)
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

        const nextCols = childWidth >= childHeight ? cols + 1 : cols
        const nextRows = childWidth < childHeight ? rows + 1 : rows
        // Aspect-only cuts must not turn a long free boundary into a row of
        // cramped ports. Existing physical short gates remain short.
        if (
          preserveOrdinaryFreePorts &&
          Math.max(node.width / nextCols, node.height / nextRows) <=
            this.minimumFreeNodeSpan + FREE_SPAN_EPSILON
        ) {
          break
        }
        cols = nextCols
        rows = nextRows
      }
    }

    return { cols, rows }
  }

  private shouldRemoveNode(
    node: CapacityMeshNode,
    bridgeNodeWorkspace: BridgeNodeWorkspace,
  ): boolean {
    const hasMinAreaLimit =
      Number.isFinite(this.minNodeArea) && this.minNodeArea > 0

    if (!Number.isFinite(node.width) || !Number.isFinite(node.height)) {
      return true
    }

    if (!hasMinAreaLimit || node.width * node.height >= this.minNodeArea) {
      return false
    }

    if (Math.min(node.width, node.height) < MIN_CONNECTIVITY_BRIDGE_DIMENSION) {
      return true
    }

    if (node._containsTarget) return false

    // Finite dimensions at a nonfinite center cannot border another rectangle.
    if (!Number.isFinite(node.center.x) || !Number.isFinite(node.center.y)) {
      return true
    }

    // Rect decomposition can produce low-area slices that still connect larger
    // regions. Removing such a slice changes reachability, so retain bridges.
    const { index, originalNodeIndices } =
      (bridgeNodeWorkspace.bridgeNodeIndex ??= createBridgeNodeIndex(
        this.nodes,
      ))
    const candidateIndices = index.search(
      node.center.x - node.width / 2 - CONNECTIVITY_BRIDGE_QUERY_PADDING,
      node.center.y - node.height / 2 - CONNECTIVITY_BRIDGE_QUERY_PADDING,
      node.center.x + node.width / 2 + CONNECTIVITY_BRIDGE_QUERY_PADDING,
      node.center.y + node.height / 2 + CONNECTIVITY_BRIDGE_QUERY_PADDING,
    )
    // Flatbush traversal order differs from the original input scan. Insertion
    // indices preserve that scan's order, including repeated original ids.
    candidateIndices.sort((left, right) => left - right)
    let borderingNodeCount = 0
    for (const candidateIndex of candidateIndices) {
      const candidate = this.nodes[originalNodeIndices[candidateIndex]!]!
      if (candidate.capacityMeshNodeId === node.capacityMeshNodeId) continue
      if (!node.availableZ.some((z) => candidate.availableZ.includes(z))) {
        continue
      }
      if (!areNodesBordering(node, candidate)) continue

      if (candidate._containsTarget) return false
      borderingNodeCount++
      if (borderingNodeCount >= 2) return false
    }

    return true
  }

  private subdivideNode(
    node: CapacityMeshNode,
    bridgeNodeWorkspace: BridgeNodeWorkspace,
  ): CapacityMeshNode[] {
    if (this.shouldRemoveNode(node, bridgeNodeWorkspace)) {
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
    let removedInvalidNodeCount = 0
    // This workspace is released after the one-step subdivision stage completes.
    const bridgeNodeWorkspace: BridgeNodeWorkspace = {}

    for (const node of this.nodes) {
      const hasInvalidDimensions =
        !Number.isFinite(node.width) || !Number.isFinite(node.height)
      const subdividedNodes = this.subdivideNode(node, bridgeNodeWorkspace)
      if (subdividedNodes.length === 0) {
        if (hasInvalidDimensions) {
          removedInvalidNodeCount++
        } else {
          removedSmallNodeCount++
        }
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
      removedInvalidNodeCount,
      maxNodeDimension: this.maxNodeDimension,
      maxNodeRatio: this.maxNodeRatio,
      minNodeArea: this.minNodeArea,
      minimumFreeNodeSpan: this.minimumFreeNodeSpan,
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
