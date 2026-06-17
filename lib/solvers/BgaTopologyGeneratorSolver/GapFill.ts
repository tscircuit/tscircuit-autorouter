import { BasePipelineSolver, definePipelineStep } from "@tscircuit/solver-utils"
import type { PipelineStep } from "@tscircuit/solver-utils"
import type { CapacityMeshNode } from "lib/types"
import type { GapFillInput } from "./BgaGapFillTypes"
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
}
