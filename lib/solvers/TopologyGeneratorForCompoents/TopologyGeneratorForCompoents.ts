import { BaseSolver } from "lib/solvers/BaseSolver"
import type { DetectedComponent } from "lib/solvers/ComponentDetectionSolver/ComponentDetectionSolver"
import {
  TopologyGenerator,
  type TopologyGeneratorSolver,
} from "lib/solvers/TopologyPlanningSolver/TopologyGenerator"
import type { CapacityMeshNode, SimpleRouteJson } from "lib/types"
import "lib/solvers/BgaTopologyGeneratorSolver/BgaTopologyGeneratorSolver"
import "lib/solvers/QfpThermalPadTopologyGeneratorSolver/QfpThermalPadTopologyGeneratorSolver"
import "lib/solvers/QfpTopologyGeneratorSolver/QfpTopologyGeneratorSolver"
import "lib/solvers/SoicTopologyGeneratorSolver/SoicTopologyGeneratorSolver"

export interface TopologyGeneratorForCompoentsParams {
  detectedComponents: DetectedComponent[]
  inputSrj: SimpleRouteJson
}

export type TopologyGeneratorForCompoentsOutput = CapacityMeshNode[]

export class TopologyGeneratorForCompoents extends BaseSolver {
  private output: TopologyGeneratorForCompoentsOutput = []
  private componentMeshNodes: CapacityMeshNode[][] = []
  private currentComponentIndex = 0
  private activeTopologyGenerator?: TopologyGeneratorSolver | null = null

  constructor(
    public readonly inputProblem: TopologyGeneratorForCompoentsParams,
  ) {
    super()
  }

  override getConstructorParams() {
    return [this.inputProblem] as const
  }

  override _step() {
    if (this.activeTopologyGenerator) {
      this.activeTopologyGenerator.step()

      if (this.activeTopologyGenerator.failed) {
        this.error = this.activeTopologyGenerator.error
        this.failed = true
        this.activeTopologyGenerator = null
        return
      }

      if (!this.activeTopologyGenerator.solved) return

      this.componentMeshNodes.push(
        this.activeTopologyGenerator.getOutput().routingRegions,
      )
      this.currentComponentIndex += 1
      this.activeTopologyGenerator = null
      return
    }

    if (
      this.currentComponentIndex >= this.inputProblem.detectedComponents.length
    ) {
      this.finalizeComponentTopology()
      this.solved = true
      return
    }

    const detectedComponent =
      this.inputProblem.detectedComponents[this.currentComponentIndex]!
    this.activeTopologyGenerator = TopologyGenerator.create(
      detectedComponent.componentKind,
      {
        inputSrj: this.inputProblem.inputSrj,
        detectedComponent,
      },
    )
  }

  private finalizeComponentTopology() {
    this.output = this.componentMeshNodes.flat()
    this.stats = {
      detectedComponentCount: this.inputProblem.detectedComponents.length,
      componentMeshNodeCount: this.output.length,
      componentMeshNodeCounts: this.componentMeshNodes.map(
        (nodes) => nodes.length,
      ),
    }
  }

  getOutput(): TopologyGeneratorForCompoentsOutput {
    if (!this.solved) {
      throw new Error("TopologyGeneratorForCompoents has not solved yet")
    }

    return this.output
  }
}
