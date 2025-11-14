import type { GraphicsObject } from "graphics-debug"
import { BaseSolver } from "../BaseSolver"
import type {
  CapacityMeshEdge,
  CapacityMeshNode,
  CapacityMeshNodeId,
  Obstacle,
  SimpleRouteJson,
} from "../../types"
import {
  isRectCompletelyInsidePolygon,
  isRectOverlappingPolygon,
} from "@tscircuit/math-utils"
import { COLORS } from "../colors"
import { isPointInRect } from "lib/utils/isPointInRect"
import { doRectsOverlap } from "lib/utils/doRectsOverlap"
import { CapacityMeshNodeSolver } from "./CapacityMeshNodeSolver1"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import { getTunedTotalCapacity1 } from "lib/utils/getTunedTotalCapacity1"

interface CapacityMeshNodeSolverOptions {
  capacityDepth?: number
}

interface Target {
  x: number
  y: number
  connectionName: string
  availableZ: number[]
}

export class CapacityMeshNodeSolver2_NodeUnderObstacle extends CapacityMeshNodeSolver {
  VIA_DIAMETER = 0.6
  OBSTACLE_MARGIN = 0.1
  /**
   * The threshold for the percentage of a single-layer node that must be
   * covered by obstacles to be considered "under an obstacle"
   */
  OVERLAP_THRESHOLD_FOR_SINGLE_LAYER_NODES = 0.2 // 20% coverage threshold

  constructor(
    public srj: SimpleRouteJson,
    public opts: CapacityMeshNodeSolverOptions = {},
  ) {
    super(srj, opts)
  }

  isNodeCompletelyOutsideBounds(node: CapacityMeshNode): boolean {
    if (this.outlinePolygon) {
      const nodeRect = this.getNodeRect(node)
      if (!isRectOverlappingPolygon(nodeRect, this.outlinePolygon)) {
        return true
      }
    }
    return (
      node.center.x + node.width / 2 < this.srj.bounds.minX ||
      node.center.x - node.width / 2 > this.srj.bounds.maxX ||
      node.center.y + node.height / 2 < this.srj.bounds.minY ||
      node.center.y - node.height / 2 > this.srj.bounds.maxY
    )
  }

  isNodePartiallyOutsideBounds(node: CapacityMeshNode): boolean {
    if (this.outlinePolygon) {
      const nodeRect = this.getNodeRect(node)
      const overlapsOutline = isRectOverlappingPolygon(
        nodeRect,
        this.outlinePolygon,
      )
      if (!overlapsOutline) {
        return false
      }
      return !isRectCompletelyInsidePolygon(nodeRect, this.outlinePolygon)
    }
    return (
      node.center.x - node.width / 2 < this.srj.bounds.minX ||
      node.center.x + node.width / 2 > this.srj.bounds.maxX ||
      node.center.y - node.height / 2 < this.srj.bounds.minY ||
      node.center.y + node.height / 2 > this.srj.bounds.maxY
    )
  }

  /**
   * Calculate the percentage of node area covered by obstacles
   */
  getObstacleCoveragePercentage(node: CapacityMeshNode): number {
    const overlappingObstacles = this.getXYZOverlappingObstacles(node)
    if (overlappingObstacles.length === 0) return 0

    const nodeLeft = node.center.x - node.width / 2
    const nodeRight = node.center.x + node.width / 2
    const nodeTop = node.center.y - node.height / 2
    const nodeBottom = node.center.y + node.height / 2
    const nodeArea = node.width * node.height

    let totalOverlapArea = 0

    for (const obstacle of overlappingObstacles) {
      // Calculate overlap rectangle
      const overlapLeft = Math.max(
        nodeLeft,
        obstacle.center.x - obstacle.width / 2,
      )
      const overlapRight = Math.min(
        nodeRight,
        obstacle.center.x + obstacle.width / 2,
      )
      const overlapTop = Math.max(
        nodeTop,
        obstacle.center.y - obstacle.height / 2,
      )
      const overlapBottom = Math.min(
        nodeBottom,
        obstacle.center.y + obstacle.height / 2,
      )

      if (overlapLeft < overlapRight && overlapTop < overlapBottom) {
        const overlapArea =
          (overlapRight - overlapLeft) * (overlapBottom - overlapTop)
        totalOverlapArea += overlapArea
      }
    }

    return totalOverlapArea / nodeArea
  }

  /**
   * Check if a single-layer node should be filtered due to obstacle coverage
   */
  shouldFilterSingleLayerNodeForObstacle(node: CapacityMeshNode): boolean {
    if (node.availableZ.length !== 1) return false
    if (!node._containsObstacle) return false

    const coveragePercent = this.getObstacleCoveragePercentage(node)
    return coveragePercent > this.OVERLAP_THRESHOLD_FOR_SINGLE_LAYER_NODES
  }

  /**
   * Check if a node should be filtered due to obstacles.
   * Single-layer nodes: filtered only if >20% covered
   * Multi-layer nodes: filtered if any overlap
   */
  shouldFilterNodeForObstacle(node: CapacityMeshNode): boolean {
    if (!node._containsObstacle) return false

    if (node.availableZ.length === 1) {
      return this.shouldFilterSingleLayerNodeForObstacle(node)
    }

    // Multi-layer nodes: use original behavior (filter if any obstacle)
    return true
  }

  createChildNodeAtPosition(
    parent: CapacityMeshNode,
    opts: {
      center: { x: number; y: number }
      width: number
      height: number
      availableZ: number[]
      _depth?: number
    },
  ): CapacityMeshNode {
    const childNode: CapacityMeshNode = {
      capacityMeshNodeId: this.getNextNodeId(),
      center: opts.center,
      width: opts.width,
      height: opts.height,
      layer: parent.layer,
      availableZ: opts.availableZ,
      _depth: opts._depth ?? (parent._depth ?? 0) + 1,
      _parent: parent,
    }

    const overlappingObstacles = this.getXYZOverlappingObstacles(childNode)

    childNode._containsObstacle =
      overlappingObstacles.length > 0 ||
      this.isNodePartiallyOutsideBounds(childNode)

    const target = this.getTargetIfNodeContainsTarget(childNode)

    if (target) {
      childNode._targetConnectionName = target.connectionName
      childNode._containsTarget = true
    }

    if (childNode._containsObstacle) {
      childNode._completelyInsideObstacle =
        this.isNodeCompletelyInsideObstacle(childNode)
    }
    // childNode._shouldBeInGraph =
    //   (!isOutsideBounds && !childNode._completelyInsideObstacle) || childNode._

    return childNode
  }

  getZSubdivisionChildNodes(node: CapacityMeshNode): CapacityMeshNode[] {
    if (node.availableZ.length === 1) return []

    const childNodes: CapacityMeshNode[] = []

    // Split availableZ into individual layers
    const otherZBlocks = node.availableZ.map((z) => [z])

    for (const zBlock of otherZBlocks) {
      const childNode = this.createChildNodeAtPosition(node, {
        center: { ...node.center },
        width: node.width,
        height: node.height,
        availableZ: zBlock,
        // z-subdivision doesn't count towards depth, should be same as parent
        _depth: node._depth!,
      })

      if (this.isNodeCompletelyOutsideBounds(childNode)) {
        continue
      }

      childNodes.push(childNode)
    }

    return childNodes
  }

  getChildNodes(parent: CapacityMeshNode): CapacityMeshNode[] {
    if (parent._depth! >= this.MAX_DEPTH) return []
    const childNodes: CapacityMeshNode[] = []

    const childNodeSize = { width: parent.width / 2, height: parent.height / 2 }

    const childNodePositions = [
      {
        x: parent.center.x - childNodeSize.width / 2,
        y: parent.center.y - childNodeSize.height / 2,
      },
      {
        x: parent.center.x + childNodeSize.width / 2,
        y: parent.center.y - childNodeSize.height / 2,
      },
      {
        x: parent.center.x - childNodeSize.width / 2,
        y: parent.center.y + childNodeSize.height / 2,
      },
      {
        x: parent.center.x + childNodeSize.width / 2,
        y: parent.center.y + childNodeSize.height / 2,
      },
    ]

    for (const position of childNodePositions) {
      const childNode = this.createChildNodeAtPosition(parent, {
        center: position,
        width: childNodeSize.width,
        height: childNodeSize.height,
        availableZ: parent.availableZ,
      })
      if (this.isNodeCompletelyOutsideBounds(childNode)) {
        continue
      }
      childNodes.push(childNode)
    }

    return childNodes
  }

  shouldNodeBeXYSubdivided(node: CapacityMeshNode) {
    if (node._depth! >= this.MAX_DEPTH) return false
    if (node._containsTarget) return true
    if (node.availableZ.length === 1 && node._depth! <= this.MAX_DEPTH)
      return true
    if (node._containsObstacle && !node._completelyInsideObstacle) return true
    return false
  }

  _step() {
    const nextNode = this.unfinishedNodes.pop()
    if (!nextNode) {
      this.solved = true
      return
    }

    const childNodes = this.getChildNodes(nextNode)

    const finishedNewNodes: CapacityMeshNode[] = []
    const unfinishedNewNodes: CapacityMeshNode[] = []

    for (const childNode of childNodes) {
      const shouldBeXYSubdivided = this.shouldNodeBeXYSubdivided(childNode)
      const shouldBeZSubdivided =
        childNode.availableZ.length > 1 &&
        !shouldBeXYSubdivided &&
        (childNode._containsObstacle ||
          childNode.width < this.VIA_DIAMETER + this.OBSTACLE_MARGIN)
      if (shouldBeXYSubdivided) {
        unfinishedNewNodes.push(childNode)
      } else if (
        !shouldBeXYSubdivided &&
        !this.shouldFilterNodeForObstacle(childNode) &&
        !shouldBeZSubdivided
      ) {
        finishedNewNodes.push(childNode)
      } else if (!shouldBeXYSubdivided && childNode._containsTarget) {
        if (shouldBeZSubdivided) {
          const zSubNodes = this.getZSubdivisionChildNodes(childNode)
          finishedNewNodes.push(
            ...zSubNodes.filter(
              (n) => n._containsTarget || !this.shouldFilterNodeForObstacle(n),
            ),
          )
        } else {
          finishedNewNodes.push(childNode)
        }
      } else if (shouldBeZSubdivided) {
        finishedNewNodes.push(
          ...this.getZSubdivisionChildNodes(childNode).filter(
            (zSubNode) => !this.shouldFilterNodeForObstacle(zSubNode),
          ),
        )
      }
    }

    this.unfinishedNodes.push(...unfinishedNewNodes)
    this.finishedNodes.push(...finishedNewNodes)
  }

  visualize(): GraphicsObject {
    const graphics: GraphicsObject = {
      lines: [],
      points: [],
      rects: [],
      circles: [],
      coordinateSystem: "cartesian",
      title: "Capacity Mesh Visualization (Nodes Under Obstacles)",
    }

    // Draw outline polygon if provided
    if (this.outlinePolygon && this.outlinePolygon.length >= 2) {
      const outlinePoints = this.outlinePolygon.map(
        (point: { x: number; y: number }) => ({
          x: point.x,
          y: point.y,
        }),
      )

      outlinePoints.push({ ...outlinePoints[0]! })

      graphics.lines!.push({
        points: outlinePoints,
        strokeColor: "rgba(0, 136, 255, 0.95)",
        label: "outline",
      })

      for (const point of this.outlinePolygon) {
        graphics.points!.push({
          x: point.x,
          y: point.y,
          color: "rgba(0, 136, 255, 0.95)",
        })
      }
    }

    // Draw obstacles
    for (const obstacle of this.srj.obstacles) {
      graphics.rects!.push({
        center: obstacle.center,
        width: obstacle.width,
        height: obstacle.height,
        fill:
          obstacle.zLayers?.length === 1 && obstacle.zLayers?.includes(1)
            ? "rgba(0,0,255,0.3)"
            : "rgba(255,0,0,0.3)",
        stroke: "red",
        label: ["obstacle", `z: ${obstacle.zLayers!.join(",")}`].join("\n"),
      })
    }

    // Draw mesh nodes (both finished and unfinished) with Z-separation
    const allNodes = [...this.finishedNodes, ...this.unfinishedNodes]

    for (const node of allNodes) {
      const lowestZ = Math.min(...node.availableZ)
      const isNextToBeProcessed =
        this.unfinishedNodes.length > 0 &&
        node === this.unfinishedNodes[this.unfinishedNodes.length - 1]

      // Z-separation offset calculation (SUBTLE but visible)
      const offsetX = lowestZ * this.zSeparation * 0.01 // Reduced from 0.5
      const offsetY = -lowestZ * this.zSeparation * 0.01 // Reduced from 0.25

      const originalCenter = { ...node.center }
      const offsetCenter = {
        x: node.center.x + offsetX,
        y: node.center.y + offsetY,
      }

      const deltaX = offsetCenter.x - originalCenter.x
      const deltaY = offsetCenter.y - originalCenter.y

      graphics.rects!.push({
        center: offsetCenter,
        width: Math.max(node.width - 2, node.width * 0.8),
        height: Math.max(node.height - 2, node.height * 0.8),
        fill: node._containsObstacle
          ? "rgba(255,0,0,0.1)"
          : ({
              "0,1": "rgba(0,0,0,0.1)",
              "0": "rgba(0,200,200, 0.1)",
              "1": "rgba(0,0,200, 0.1)",
            }[node.availableZ.join(",")] ?? "rgba(0,200,200,0.1)"),
        stroke: isNextToBeProcessed ? "rgba(255,165,0,0.5)" : undefined,
        label: [
          node.capacityMeshNodeId,
          `availableZ: ${node.availableZ.join(",")}`,
          `target? ${node._containsTarget ?? false}`,
          `obs? ${node._containsObstacle ?? false}`,
          `${node.width.toFixed(2)}x${node.height.toFixed(2)}`,
          `lowestZ: ${lowestZ}`,
          `zSep: ${this.zSeparation}`,
          `offset: (${deltaX.toFixed(3)}, ${deltaY.toFixed(3)})`,
        ].join("\n"),
      })
    }
    graphics.rects!.sort((a, b) => a.center.y - b.center.y)

    // Draw connection points (each connection gets a unique color).
    this.srj.connections.forEach((connection, index) => {
      const color = COLORS[index % COLORS.length]
      for (const pt of connection.pointsToConnect) {
        graphics.points!.push({
          x: pt.x,
          y: pt.y,
          label: `conn-${index} (${pt.layer})`,
          color,
        })
      }
    })

    return graphics
  }
}
