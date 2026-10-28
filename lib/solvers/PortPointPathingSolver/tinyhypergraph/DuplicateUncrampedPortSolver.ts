import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { DuplicateCongestedPortSolver } from "tiny-hypergraph/lib/index"

export class DuplicateUncrampedPortSolver extends DuplicateCongestedPortSolver {
  protected override duplicateCongestedPorts(
    portUseCounts: Map<string, number>,
  ): SerializedHyperGraph {
    const crampedPortIds = new Set(
      this.serializedHyperGraph.ports
        .filter((port) => port.d?.cramped === true)
        .map((port) => port.portId),
    )
    // A cramped boundary has no room for another trace. Duplicating its port
    // invents capacity that the detailed router cannot physically realize.
    const graph = super.duplicateCongestedPorts(
      new Map([...portUseCounts].filter(([id]) => !crampedPortIds.has(id))),
    )
    this.report.portUseCounts = Object.fromEntries([...portUseCounts].sort())
    return graph
  }
}
