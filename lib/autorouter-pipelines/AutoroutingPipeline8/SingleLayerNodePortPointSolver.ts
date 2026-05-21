import type { GraphicsObject } from "graphics-debug"
import { BaseSolver } from "lib/solvers/BaseSolver"
import type {
  SegmentPortPoint,
  SharedEdgeSegment,
} from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import type { CapacityMeshNode, CapacityMeshNodeId } from "lib/types"
import { createRectFromCapacityNode } from "lib/utils/createRectFromCapacityNode"

type SingleLayerNodePortPointSolverParams = {
  capacityMeshNodes: CapacityMeshNode[]
  sharedEdgeSegments: SharedEdgeSegment[]
}

const getSingleLayerNodeId = (nodeId: CapacityMeshNodeId, z: number) =>
  `${nodeId}__z${z}`

const uniqueSorted = (values: number[]) =>
  [...new Set(values)].sort((a, b) => a - b)

export class SingleLayerNodePortPointSolver extends BaseSolver {
  outputNodes: CapacityMeshNode[] = []
  outputSharedEdgeSegments: SharedEdgeSegment[] = []
  private nodeIdByOriginalAndZ = new Map<string, CapacityMeshNodeId>()

  constructor(public readonly params: SingleLayerNodePortPointSolverParams) {
    super()
    this.MAX_ITERATIONS = 1
  }

  override getSolverName() {
    return "SingleLayerNodePortPointSolver"
  }

  override _step() {
    this.outputNodes = this.params.capacityMeshNodes.flatMap((node) => {
      const availableZ = uniqueSorted(node.availableZ)
      return availableZ.map((z) => {
        const capacityMeshNodeId = getSingleLayerNodeId(
          node.capacityMeshNodeId,
          z,
        )
        this.nodeIdByOriginalAndZ.set(
          `${node.capacityMeshNodeId}:${z}`,
          capacityMeshNodeId,
        )
        return {
          ...node,
          capacityMeshNodeId,
          layer: `z${z}`,
          availableZ: [z],
          _parent: node,
        }
      })
    })

    this.outputSharedEdgeSegments = this.params.sharedEdgeSegments.flatMap(
      (segment) => this.splitSharedEdgeSegment(segment),
    )

    this.stats = {
      inputNodeCount: this.params.capacityMeshNodes.length,
      outputNodeCount: this.outputNodes.length,
      inputPortPointCount: this.params.sharedEdgeSegments.reduce(
        (count, segment) => count + segment.portPoints.length,
        0,
      ),
      outputPortPointCount: this.outputSharedEdgeSegments.reduce(
        (count, segment) => count + segment.portPoints.length,
        0,
      ),
    }
    this.solved = true
  }

  private getSplitNodeId(nodeId: CapacityMeshNodeId, z: number) {
    return this.nodeIdByOriginalAndZ.get(`${nodeId}:${z}`)
  }

  private splitPortPoint(portPoint: SegmentPortPoint): SegmentPortPoint[] {
    return uniqueSorted(portPoint.availableZ).flatMap((z) => {
      const nodeIds = portPoint.nodeIds.map((nodeId) =>
        this.getSplitNodeId(nodeId, z),
      ) as Array<CapacityMeshNodeId | undefined>

      if (!nodeIds[0] || !nodeIds[1]) {
        return []
      }

      return [
        {
          ...portPoint,
          segmentPortPointId: `${portPoint.segmentPortPointId}__z${z}`,
          availableZ: [z],
          nodeIds: [nodeIds[0], nodeIds[1]],
        },
      ]
    })
  }

  private splitSharedEdgeSegment(
    segment: SharedEdgeSegment,
  ): SharedEdgeSegment[] {
    const portPointsByZ = new Map<number, SegmentPortPoint[]>()
    for (const portPoint of segment.portPoints.flatMap((portPoint) =>
      this.splitPortPoint(portPoint),
    )) {
      const z = portPoint.availableZ[0]
      if (z === undefined) continue
      const existing = portPointsByZ.get(z) ?? []
      existing.push(portPoint)
      portPointsByZ.set(z, existing)
    }

    return [...portPointsByZ.entries()].map(([z, portPoints]) => ({
      ...segment,
      edgeId: `${segment.edgeId}__z${z}`,
      nodeIds: portPoints[0]!.nodeIds,
      availableZ: [z],
      portPoints,
    }))
  }

  getOutput() {
    return {
      capacityMeshNodes: this.outputNodes,
      sharedEdgeSegments: this.outputSharedEdgeSegments,
    }
  }

  override getConstructorParams() {
    return [this.params] as const
  }

  override visualize(): GraphicsObject {
    return {
      rects: this.outputNodes.map((node) => ({
        ...createRectFromCapacityNode(node),
        label: `${node.capacityMeshNodeId}\n${node.layer}`,
      })),
      points: this.outputSharedEdgeSegments.flatMap((segment) =>
        segment.portPoints.map((portPoint) => ({
          x: portPoint.x,
          y: portPoint.y,
          label: `${portPoint.segmentPortPointId}\nz${portPoint.availableZ.join(
            ",",
          )}`,
        })),
      ),
    }
  }
}
