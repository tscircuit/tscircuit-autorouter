import { getBoundFromCenteredRect } from "@tscircuit/math-utils"
import type { Bounds } from "@tscircuit/math-utils"
import { BasePipelineSolver, definePipelineStep } from "@tscircuit/solver-utils"
import type { BaseSolver } from "@tscircuit/solver-utils"
import type { PipelineStep } from "@tscircuit/solver-utils"
import type { GraphicsObject, Line, Point, Rect } from "graphics-debug"
import type { CapacityMeshNode } from "lib/types"
import { createRectFromCapacityNode } from "lib/utils/createRectFromCapacityNode"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import type { GapFillInput } from "./BgaGapFillTypes"
import type { EdgeSegmentWithObstacle } from "./BgaGapFillTypes"
import { DetectEdgesNotConnectedToMesh } from "./DetectEdgesNotConnectedToMesh"
import { ExpandUnconnectedEdgesToMesh } from "./ExpandUnconnectedEdgesToMesh"
import {
  getGapFillEdgeColor,
  getGapFillEdgeDirectionLabel,
  getGapFillEdgeMidpoint,
  getGapFillEdgeVisualId,
  getGapFillExpandedNodeEdgeIndex,
  getGapFillObstacleEdges,
  sortGapFillEdgesByLocation,
} from "./gapFillVisualization"

const EDGE_EPSILON: number = 1e-3

type GraphicsRectList = Rect[]
type GraphicsLineList = Line[]
type GraphicsPointList = Point[]

const getAdjacentTargetNodeIds = ({
  expandedNode,
  edge,
  meshNodes,
}: {
  expandedNode: CapacityMeshNode
  edge: EdgeSegmentWithObstacle
  meshNodes: CapacityMeshNode[]
}): string[] => {
  const expandedBounds: Bounds = getBoundFromCenteredRect(expandedNode)
  const edgeIsVertical: boolean =
    Math.abs(edge.start.x - edge.end.x) <= EDGE_EPSILON

  return meshNodes
    .filter((meshNode) => {
      if (meshNode._containsObstacle) return false
      if (
        !expandedNode.availableZ.some((z: number) =>
          meshNode.availableZ.includes(z),
        )
      ) {
        return false
      }

      const meshBounds: Bounds = getBoundFromCenteredRect(meshNode)

      if (edgeIsVertical) {
        const yOverlap =
          Math.min(expandedBounds.maxY, meshBounds.maxY) -
          Math.max(expandedBounds.minY, meshBounds.minY)
        if (yOverlap <= EDGE_EPSILON) return false

        return edge.expansionDirection.x < 0
          ? Math.abs(meshBounds.maxX - expandedBounds.minX) <= EDGE_EPSILON
          : Math.abs(meshBounds.minX - expandedBounds.maxX) <= EDGE_EPSILON
      }

      const xOverlap =
        Math.min(expandedBounds.maxX, meshBounds.maxX) -
        Math.max(expandedBounds.minX, meshBounds.minX)
      if (xOverlap <= EDGE_EPSILON) return false

      return edge.expansionDirection.y < 0
        ? Math.abs(meshBounds.maxY - expandedBounds.minY) <= EDGE_EPSILON
        : Math.abs(meshBounds.minY - expandedBounds.maxY) <= EDGE_EPSILON
    })
    .map((meshNode) => meshNode.capacityMeshNodeId)
}

export class GapFill extends BasePipelineSolver<GapFillInput> {
  detectEdgesNotConnectedToMesh!: DetectEdgesNotConnectedToMesh
  expandUnconnectedEdgesToMesh!: ExpandUnconnectedEdgesToMesh

  pipelineDef: PipelineStep<BaseSolver>[] = [
    definePipelineStep(
      "detectEdgesNotConnectedToMesh",
      DetectEdgesNotConnectedToMesh,
      (gapFill: GapFill) => [gapFill.inputProblem],
    ),
    definePipelineStep(
      "expandUnconnectedEdgesToMesh",
      ExpandUnconnectedEdgesToMesh,
      (gapFill: GapFill) => [
        {
          meshNodes: gapFill.inputProblem.meshNodes,
          edgesWithObstacle: gapFill.detectEdgesNotConnectedToMesh.getOutput(),
          layerCount: gapFill.inputProblem.layerCount,
        },
      ],
    ),
  ]

  constructor(public readonly inputProblem: GapFillInput) {
    super(inputProblem)
  }

  override getOutput(): CapacityMeshNode[] {
    return [
      ...this.inputProblem.meshNodes,
      ...this.expandUnconnectedEdgesToMesh.getOutput(),
    ]
  }

  getExpandedNodes(): CapacityMeshNode[] {
    return this.expandUnconnectedEdgesToMesh.getOutput()
  }

  private getObstacleLayer(edgeWithObstacle: EdgeSegmentWithObstacle): string {
    const availableZ =
      edgeWithObstacle.obstacle.__zLayers ??
      edgeWithObstacle.obstacle.layers.map((layerName) =>
        mapLayerNameToZ(layerName, this.inputProblem.layerCount),
      )

    return `z${availableZ.join(",")}`
  }

  private getObstacleRects(): GraphicsRectList {
    return this.inputProblem.unmarkedComponentObstacles.map(
      (obstacle): Rect => {
        const availableZ =
          obstacle.__zLayers ??
          obstacle.layers.map((layerName) =>
            mapLayerNameToZ(layerName, this.inputProblem.layerCount),
          )

        return {
          center: obstacle.center,
          width: obstacle.width,
          height: obstacle.height,
          fill: "rgba(150,150,150,0.08)",
          stroke: "rgba(90,90,90,0.42)",
          label: obstacle.obstacleId ?? obstacle.componentId ?? "bga obstacle",
          layer: `z${availableZ.join(",")}`,
        }
      },
    )
  }

  private getBaseMeshRects(): GraphicsRectList {
    return this.inputProblem.meshNodes.map((node) => ({
      ...createRectFromCapacityNode(node, {
        rectMargin: 0.025,
        zOffset: 0.01,
      }),
      fill: node._containsObstacle
        ? "rgba(210,60,60,0.14)"
        : "rgba(80,120,160,0.08)",
      stroke: node._containsObstacle
        ? "rgba(190,40,40,0.42)"
        : "rgba(80,120,160,0.28)",
      label: `mesh ${node.capacityMeshNodeId}\nz:${node.availableZ.join(",")}`,
    }))
  }

  override initialVisualize(): GraphicsObject | null {
    const obstacleEdges: EdgeSegmentWithObstacle[] = getGapFillObstacleEdges(
      this.inputProblem.unmarkedComponentObstacles,
    )
    const visualEdges: EdgeSegmentWithObstacle[] =
      sortGapFillEdgesByLocation(obstacleEdges)
    const initialLines: GraphicsLineList = [
      ...obstacleEdges.map(
        (edgeWithObstacle): Line => ({
          points: [edgeWithObstacle.start, edgeWithObstacle.end],
          strokeColor: getGapFillEdgeColor(edgeWithObstacle, 0.72),
          strokeWidth: 0.018,
          strokeDash: "0.05 0.035",
          layer: this.getObstacleLayer(edgeWithObstacle),
          label: [
            getGapFillEdgeVisualId(edgeWithObstacle, visualEdges),
            getGapFillEdgeDirectionLabel(edgeWithObstacle),
          ].join(" "),
        }),
      ),
      ...obstacleEdges.map((edgeWithObstacle): Line => {
        const midpoint = getGapFillEdgeMidpoint(edgeWithObstacle)
        return {
          points: [
            midpoint,
            {
              x: midpoint.x + edgeWithObstacle.expansionDirection.x * 0.18,
              y: midpoint.y + edgeWithObstacle.expansionDirection.y * 0.18,
            },
          ],
          strokeColor: getGapFillEdgeColor(edgeWithObstacle, 0.64),
          strokeWidth: 0.012,
          strokeDash: "0.035 0.025",
          layer: this.getObstacleLayer(edgeWithObstacle),
        }
      }),
    ]

    return {
      title: "BGA GapFill: candidate obstacle edges",
      rects: [...this.getBaseMeshRects(), ...this.getObstacleRects()],
      lines: initialLines,
    }
  }

  override finalVisualize(): GraphicsObject | null {
    const edgesWithObstacle: EdgeSegmentWithObstacle[] =
      this.getStageOutput<EdgeSegmentWithObstacle[]>(
        "detectEdgesNotConnectedToMesh",
      ) ?? []
    const expandedNodes: CapacityMeshNode[] =
      this.getStageOutput<CapacityMeshNode[]>("expandUnconnectedEdgesToMesh") ??
      []
    const allObstacleEdges: EdgeSegmentWithObstacle[] =
      sortGapFillEdgesByLocation(
        getGapFillObstacleEdges(this.inputProblem.unmarkedComponentObstacles),
      )

    const expandedNodeByEdgeIndex = new Map<number, CapacityMeshNode>()
    for (const expandedNode of expandedNodes) {
      const edgeIndex = getGapFillExpandedNodeEdgeIndex(expandedNode)
      if (edgeIndex === null) continue

      expandedNodeByEdgeIndex.set(edgeIndex, expandedNode)
    }

    const expandedRects: GraphicsRectList = expandedNodes.map((node): Rect => {
      const edgeIndex = getGapFillExpandedNodeEdgeIndex(node)
      const edge =
        edgeIndex === null ? null : (edgesWithObstacle[edgeIndex] ?? null)
      const targetNodeIds = edge
        ? getAdjacentTargetNodeIds({
            expandedNode: node,
            edge,
            meshNodes: this.inputProblem.meshNodes,
          })
        : []
      const edgeLabel = edge
        ? getGapFillEdgeVisualId(edge, allObstacleEdges)
        : "E?"
      const color =
        edge === null ? "rgba(0,160,100,0.72)" : getGapFillEdgeColor(edge, 0.72)

      return {
        ...createRectFromCapacityNode(node, {
          rectMargin: 0.012,
          zOffset: 0.01,
        }),
        fill:
          edge === null
            ? "rgba(0,160,100,0.24)"
            : getGapFillEdgeColor(edge, 0.16),
        stroke: color,
        label: [
          `${edgeLabel} gap fill`,
          targetNodeIds.length > 0
            ? `to ${targetNodeIds.join(",")}`
            : "target mesh not adjacent",
          `z:${node.availableZ.join(",")}`,
        ].join("\n"),
      }
    })
    const edgeStateLines: GraphicsLineList = edgesWithObstacle.map(
      (edgeWithObstacle, edgeIndex): Line => {
        const expandedNode = expandedNodeByEdgeIndex.get(edgeIndex)

        return {
          points: [edgeWithObstacle.start, edgeWithObstacle.end],
          strokeColor: expandedNode
            ? getGapFillEdgeColor(edgeWithObstacle, 0.68)
            : "rgba(80,80,80,0.14)",
          strokeWidth: expandedNode ? 0.026 : 0.008,
          ...(expandedNode ? {} : { strokeDash: "5 4" }),
          layer: this.getObstacleLayer(edgeWithObstacle),
          label: [
            [
              getGapFillEdgeVisualId(edgeWithObstacle, allObstacleEdges),
              getGapFillEdgeDirectionLabel(edgeWithObstacle),
            ].join(" "),
            expandedNode ? "filled" : "no fill created",
          ].join("\n"),
        }
      },
    )
    const fillConnectionLines: GraphicsLineList = edgesWithObstacle.flatMap(
      (edgeWithObstacle, edgeIndex): Line[] => {
        const midpoint = getGapFillEdgeMidpoint(edgeWithObstacle)
        const expandedNode = expandedNodeByEdgeIndex.get(edgeIndex)
        if (!expandedNode) return []

        return [
          {
            points: [midpoint, expandedNode.center],
            strokeColor: getGapFillEdgeColor(edgeWithObstacle, 0.42),
            strokeWidth: 0.012,
            strokeDash: "0.035 0.025",
            layer: this.getObstacleLayer(edgeWithObstacle),
          },
        ]
      },
    )
    const expandedEdgePoints: GraphicsPointList = edgesWithObstacle.flatMap(
      (edgeWithObstacle, edgeIndex): Point[] => {
        if (!expandedNodeByEdgeIndex.has(edgeIndex)) return []

        return [
          {
            ...getGapFillEdgeMidpoint(edgeWithObstacle),
            color: getGapFillEdgeColor(edgeWithObstacle, 0.82),
            label: getGapFillEdgeVisualId(edgeWithObstacle, allObstacleEdges),
            layer: this.getObstacleLayer(edgeWithObstacle),
          },
        ]
      },
    )

    return {
      title: "BGA GapFill: disconnected edges and created mesh",
      rects: [
        ...this.getBaseMeshRects(),
        ...this.getObstacleRects(),
        ...expandedRects,
      ],
      lines: [...edgeStateLines, ...fillConnectionLines],
      points: expandedEdgePoints,
    }
  }
}
