import { BaseSolver } from "lib/solvers/BaseSolver"
import type { DetectedComponent } from "lib/solvers/ComponentDetectionSolver/ComponentDetectionSolver"
import type { CapacityMeshNode, SimpleRouteJson } from "lib/types"

export interface TopologyGeneratorForCompoentsParams {
  detectedComponents: DetectedComponent[]
  inputSrj: SimpleRouteJson
}

export type TopologyGeneratorForCompoentsOutput = CapacityMeshNode[]

export class TopologyGeneratorForCompoents extends BaseSolver {
  private output: TopologyGeneratorForCompoentsOutput = []

  constructor(
    public readonly inputProblem: TopologyGeneratorForCompoentsParams,
  ) {
    super()
  }

  override getConstructorParams() {
    return [this.inputProblem] as const
  }

  override _step() {
    // TODO: Generate component-local topology capacity mesh nodes from detected
    // components and the input SimpleRouteJson.
    this.output = []
    this.solved = true
  }

  getOutput(): TopologyGeneratorForCompoentsOutput {
    if (!this.solved) {
      throw new Error("TopologyGeneratorForCompoents has not solved yet")
    }

    return this.output
  }
}
