import { type Candidate, TinyHyperGraphSolver } from "tiny-hypergraph/lib/core"

/** Prefer free boundary capacity while preserving greedy best-first search. */
export class CrampedPortAwareGreedyFinalRouteSolver extends TinyHyperGraphSolver {
  private boundaryPorts?: Map<string, number[]>
  private capacityEpoch = ""
  private capacityCosts = new Map<string, number>()

  override computeG(currentCandidate: Candidate): number {
    // Accumulating congestion costs exhausts the final pass's search budget.
    // Keep upstream's greedy search and apply a local preference in computeH.
    return currentCandidate.g
  }

  override computeH(neighborPortId: number): number {
    const distance = super.computeH(neighborPortId)
    const metadata = this.topology.portMetadata?.[neighborPortId]
    if (!metadata?.crampedBoundaryKey) return distance
    if (!this.boundaryPorts) {
      this.boundaryPorts = new Map()
      this.topology.portMetadata!.forEach((port, index) => {
        if (!port?.crampedBoundaryKey) return
        const key = String(port.crampedBoundaryKey)
        const siblings = this.boundaryPorts!.get(key) ?? []
        siblings.push(index)
        this.boundaryPorts!.set(key, siblings)
      })
    }
    // Assignments stay fixed during a route search; invalidate after a route
    // completes or a rip-up changes the occupancy of shared boundaries.
    const epoch = `${this.state.currentRouteId}:${this.state.ripCount}`
    if (this.capacityEpoch !== epoch) {
      this.capacityEpoch = epoch
      this.capacityCosts.clear()
    }
    const key = String(metadata.crampedBoundaryKey)
    let cost = this.capacityCosts.get(key)
    if (cost === undefined) {
      const owners = new Set<number>()
      for (const portId of this.boundaryPorts.get(key)!) {
        const owner = this.state.portAssignment[portId]!
        if (owner >= 0 && owner !== this.state.currentRouteNetId) {
          owners.add(owner)
        }
      }
      // Mesh edges are approximate routing partitions, not copper bottlenecks.
      // Small groups can fan out during detailed routing. Only bias severe
      // crowding (over four times nominal capacity); retain every route choice.
      // Count distinct foreign nets, not virtual copies or same-net branches.
      const overflow = Math.max(
        0,
        owners.size + 1 - 4 * Number(metadata.crampedBoundaryCapacity),
      )
      cost =
        Number(metadata.crampedBoundaryPitch) *
        overflow ** 2 *
        this.DISTANCE_TO_COST
      this.capacityCosts.set(key, cost)
    }
    return distance + cost
  }
}
