import Flatbush from "flatbush"
import type { CapacityMeshNode } from "../../types/capacity-mesh-types"
import { areNodesBordering } from "../../utils/areNodesBordering"
import { CapacityMeshEdgeSolver } from "./CapacityMeshEdgeSolver"

type Bounds = {
  left: number
  right: number
  top: number
  bottom: number
  minBucketX: number
  maxBucketX: number
  minBucketY: number
  maxBucketY: number
}

/** Index surfaces rather than replicating every rectangle throughout its area. */
export class CapacityMeshBoundaryEdgeSolver extends CapacityMeshEdgeSolver {
  override stats = {
    boundaryEdges: {
      activated: true,
      nodeCount: 0,
      indexItems: 0,
      boundaryQueries: 0,
      boundaryHits: 0,
      boundaryCandidatesInLegacyDomain: 0,
      pairTests: 0,
      regularEdges: 0,
      targetQueries: 0,
      targetHits: 0,
      targetEdges: 0,
      incidentVisits: 0,
      indexMs: 0,
      regularMs: 0,
      targetMs: 0,
      phase: "index",
    },
  }
  private bounds: Bounds[] = []
  private sideIndexes: Flatbush[] = []
  private targetIndex?: Flatbush
  private targets: number[] = []
  private currentNodeIndex = 0
  private regularEdgeSet = new Set<string>()
  private neighbors = new Map<string, Set<string>>()
  private nodeById = new Map<string, CapacityMeshNode>()

  constructor(nodes: CapacityMeshNode[]) {
    const start = performance.now()
    super(nodes)
    this.MAX_ITERATIONS = 10e6
    const stats = this.stats.boundaryEdges
    stats.nodeCount = nodes.length
    for (const [i, node] of nodes.entries()) {
      const { x, y } = node.center
      const left = x - node.width / 2
      const right = x + node.width / 2
      const top = y - node.height / 2
      const bottom = y + node.height / 2
      if (
        this.nodeById.has(node.capacityMeshNodeId) ||
        ![left, right, top, bottom].every(Number.isFinite) ||
        node.width < 0 || node.height < 0
      ) {
        throw new Error("Boundary edge index requires unique node IDs and finite nonnegative rectangles")
      }
      this.nodeById.set(node.capacityMeshNodeId, node)
      this.neighbors.set(node.capacityMeshNodeId, new Set())
      this.bounds.push({
        left, right, top, bottom,
        minBucketX: Math.floor(left / 0.4),
        maxBucketX: Math.floor(right / 0.4),
        minBucketY: Math.floor(top / 0.4),
        maxBucketY: Math.floor(bottom / 0.4),
      })
      if (node._containsTarget) this.targets.push(i)
    }
    if (nodes.length > 0) {
      this.sideIndexes = Array.from({ length: 4 }, () => new Flatbush(nodes.length))
      for (const b of this.bounds) {
        this.sideIndexes[0]!.add(b.left, b.top, b.left, b.bottom)
        this.sideIndexes[1]!.add(b.right, b.top, b.right, b.bottom)
        this.sideIndexes[2]!.add(b.left, b.top, b.right, b.top)
        this.sideIndexes[3]!.add(b.left, b.bottom, b.right, b.bottom)
      }
      for (const index of this.sideIndexes) index.finish()
      stats.indexItems = nodes.length * 4
    }
    if (this.targets.length > 0) {
      this.targetIndex = new Flatbush(this.targets.length)
      for (const i of this.targets) {
        const b = this.bounds[i]!
        this.targetIndex.add(b.left, b.top, b.right, b.bottom)
      }
      this.targetIndex.finish()
      stats.indexItems += this.targets.length
    }
    stats.indexMs = performance.now() - start
    stats.phase = "regular"
  }

  override _step(): void {
    if (this.currentNodeIndex >= this.nodes.length) {
      const start = performance.now()
      this.stats.boundaryEdges.phase = "targets"
      try {
        this.handleTargetNodes()
        this.solved = true
        this.stats.boundaryEdges.phase = "complete"
      } finally {
        this.stats.boundaryEdges.targetMs += performance.now() - start
      }
      return
    }
    const start = performance.now()
    const a = this.nodes[this.currentNodeIndex]!
    const b = this.bounds[this.currentNodeIndex]!
    // Outward rounding is broadphase-only. The unchanged predicates below make
    // the strict <.001 side distance and inclusive >=.001 overlap decisions.
    const pad = 0.001 + 4 * Number.EPSILON * Math.max(1, Math.abs(b.left), Math.abs(b.right), Math.abs(b.top), Math.abs(b.bottom))
    const candidates = new Set<number>()
    const searches = [
      this.sideIndexes[1]!.search(b.left - pad, b.top, b.left + pad, b.bottom),
      this.sideIndexes[0]!.search(b.right - pad, b.top, b.right + pad, b.bottom),
      this.sideIndexes[3]!.search(b.left, b.top - pad, b.right, b.top + pad),
      this.sideIndexes[2]!.search(b.left, b.bottom - pad, b.right, b.bottom + pad),
    ]
    const stats = this.stats.boundaryEdges
    stats.boundaryQueries += 4
    for (const found of searches) {
      stats.boundaryHits += found.length
      for (const i of found) candidates.add(i)
    }
    const minX = Math.floor((a.center.x - (a.width * 2) / 2) / 0.4)
    const maxX = Math.floor((a.center.x + (a.width * 2) / 2) / 0.4)
    const minY = Math.floor((a.center.y - (a.height * 2) / 2) / 0.4)
    const maxY = Math.floor((a.center.y + (a.height * 2) / 2) / 0.4)
    const ordered: { i: number; x: number; y: number }[] = []
    for (const i of candidates) {
      const other = this.bounds[i]!
      const x = Math.max(minX, other.minBucketX)
      const y = Math.max(minY, other.minBucketY)
      if (x <= Math.min(maxX, other.maxBucketX) && y <= Math.min(maxY, other.maxBucketY)) ordered.push({ i, x, y })
    }
    // The old bucket scan first encounters B at this bucket, then by its input
    // index. Filtering nonbordering rectangles before sorting cannot change any
    // emitted edge's orientation, ceID, or position in the output array.
    ordered.sort((u, v) => u.x - v.x || u.y - v.y || u.i - v.i)
    stats.boundaryCandidatesInLegacyDomain += ordered.length
    for (const { i } of ordered) {
      const other = this.nodes[i]!
      stats.pairTests++
      if (!areNodesBordering(a, other)) continue
      const sameStrawParent = a._strawNode && other._strawNode && a._strawParentCapacityMeshNodeId === other._strawParentCapacityMeshNodeId
      const key = `${a.capacityMeshNodeId}-${other.capacityMeshNodeId}`
      if (a.capacityMeshNodeId === other.capacityMeshNodeId || sameStrawParent || !this.doNodesHaveSharedLayer(a, other) || this.regularEdgeSet.has(key)) continue
      // Retain the legacy directed string-key behavior, including its ordering.
      this.regularEdgeSet.add(key)
      this.regularEdgeSet.add(`${other.capacityMeshNodeId}-${a.capacityMeshNodeId}`)
      this.appendEdge(a, other)
      stats.regularEdges++
    }
    this.currentNodeIndex++
    stats.regularMs += performance.now() - start
  }

  private appendEdge(a: CapacityMeshNode, b: CapacityMeshNode): void {
    this.edges.push({
      capacityMeshEdgeId: this.getNextCapacityMeshEdgeId(),
      nodeIds: [a.capacityMeshNodeId, b.capacityMeshNodeId],
    })
    this.neighbors.get(a.capacityMeshNodeId)!.add(b.capacityMeshNodeId)
    this.neighbors.get(b.capacityMeshNodeId)!.add(a.capacityMeshNodeId)
  }

  override handleTargetNodes(): void {
    const stats = this.stats.boundaryEdges
    for (const [position, i] of this.targets.entries()) {
      const a = this.nodes[i]!
      const b = this.bounds[i]!
      const pad = 0.001 + 4 * Number.EPSILON * Math.max(1, Math.abs(b.left), Math.abs(b.right), Math.abs(b.top), Math.abs(b.bottom))
      const candidates = this.targetIndex!.search(b.left - pad, b.top - pad, b.right + pad, b.bottom + pad).filter((j) => j > position).sort((x, y) => x - y)
      stats.targetQueries++
      stats.targetHits += candidates.length
      for (const j of candidates) {
        const other = this.nodes[this.targets[j]!]!
        if (!this.doNodesHaveSharedLayer(a, other) || !this.doNodesTouchOrOverlap(a, other) || this.hasEdgeBetween(a, other)) continue
        this.appendEdge(a, other)
        stats.targetEdges++
      }
    }
    for (const i of this.targets) {
      const target = this.nodes[i]!
      if (!target._containsObstacle || !target._targetConnectionName) continue
      let hasRoutingEdge = false
      for (const id of this.neighbors.get(target.capacityMeshNodeId)!) {
        stats.incidentVisits++
        const other = this.nodeById.get(id)!
        if (!other._containsObstacle && !other._containsTarget && this.doNodesHaveSharedLayer(target, other)) {
          hasRoutingEdge = true
          break
        }
      }
      if (hasRoutingEdge) continue
      throw new Error(`Target obstacle region "${target.capacityMeshNodeId}" for connection "${target._targetConnectionName}" has no bordering routing edge`)
    }
  }

  override hasEdgeBetween(a: CapacityMeshNode, b: CapacityMeshNode): boolean {
    const neighbors = this.neighbors.get(a.capacityMeshNodeId)
    if (!neighbors) {
      throw new Error(`Unknown capacity mesh node "${a.capacityMeshNodeId}"`)
    }
    return neighbors.has(b.capacityMeshNodeId)
  }
}
