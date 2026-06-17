import { BasePipelineSolver, definePipelineStep } from "@tscircuit/solver-utils"
import type { PipelineStep } from "@tscircuit/solver-utils"
import type { GraphicsObject } from "graphics-debug"
import type { CapacityMeshNode } from "lib/types"
import { createRectFromCapacityNode } from "lib/utils/createRectFromCapacityNode"
import type { GapFillInput } from "./BgaGapFillTypes"
import type { EdgeSegmentWithObstacle } from "./BgaGapFillTypes"
import { DetectEdgesNotConnectedToMesh } from "./DetectEdgesNotConnectedToMesh"
import { ExpandUnconnectedEdgesToMesh } from "./ExpandUnconnectedEdgesToMesh"

export class GapFill extends BasePipelineSolver<GapFillInput> {
  detectEdgesNotConnectedToMesh!: DetectEdgesNotConnectedToMesh
  expandUnconnectedEdgesToMesh!: ExpandUnconnectedEdgesToMesh

  pipelineDef: PipelineStep<any>[] = [
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

  override initialVisualize(): GraphicsObject | null {
    return {
      rects: [
        ...this.inputProblem.meshNodes.map((node) => ({
          ...createRectFromCapacityNode(node, { rectMargin: 0.01 }),
          fill: node._containsObstacle
            ? "rgba(255,0,0,0.16)"
            : "rgba(0,120,255,0.08)",
          stroke: node._containsObstacle
            ? "rgba(255,0,0,0.35)"
            : "rgba(0,120,255,0.28)",
        })),
      ],
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

    return {
      rects: [
        ...this.inputProblem.meshNodes.map((node) => ({
          ...createRectFromCapacityNode(node, { rectMargin: 0.01 }),
          fill: node._containsObstacle
            ? "rgba(255,0,0,0.16)"
            : "rgba(0,120,255,0.08)",
          stroke: node._containsObstacle
            ? "rgba(255,0,0,0.35)"
            : "rgba(0,120,255,0.28)",
        })),
        ...expandedNodes.map((node) => ({
          ...createRectFromCapacityNode(node, { rectMargin: 0.01 }),
          fill: "rgba(0,200,120,0.24)",
          stroke: "rgba(0,200,120,0.68)",
          label: `gapfill ${node.capacityMeshNodeId}`,
        })),
      ],
      lines: edgesWithObstacle.map((edgeWithObstacle) => ({
        points: [edgeWithObstacle.start, edgeWithObstacle.end],
        stroke: "rgba(255,140,0,0.95)",
        strokeWidth: 0.03,
      })),
    }
  }
}
