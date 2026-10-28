import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { DuplicateCongestedPortSolver } from "tiny-hypergraph/lib/index"

export class CapacityLimitedPortDuplicationSolver extends DuplicateCongestedPortSolver {
  protected override duplicateCongestedPorts(
    portUseCounts: Map<string, number>,
  ): SerializedHyperGraph {
    const limitedPortIds = new Set(
      this.serializedHyperGraph.ports
        .filter((port) => port.d?.allowDuplication === false)
        .map((port) => port.portId),
    )
    // Cramped also includes conservative corner margins and narrow QFP gaps.
    // Only an explicit geometric capacity limit should prohibit duplication.
    const graph = super.duplicateCongestedPorts(
      new Map([...portUseCounts].filter(([id]) => !limitedPortIds.has(id))),
    )
    this.report.portUseCounts = Object.fromEntries([...portUseCounts].sort())
    return graph
  }
}
