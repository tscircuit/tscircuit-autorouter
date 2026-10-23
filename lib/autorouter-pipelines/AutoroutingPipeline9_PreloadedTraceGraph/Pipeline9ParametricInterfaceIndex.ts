import type { NodeWithPortPoints, PortPoint } from "lib/types/high-density-types"

export type Pipeline9ParametricInterfacePort = {
  capacityMeshNodeId: string
  port: PortPoint
  traceWidth: number
}

/** Immutable physical terminal reservations, shared by every serial/batch cell. */
export class Pipeline9ParametricInterfaceIndex {
  readonly ports: readonly Pipeline9ParametricInterfacePort[]
  readonly retainedKeyCodeUnits: number
  private readonly witnessKeys = new Set<string>()

  constructor(ports: readonly Pipeline9ParametricInterfacePort[], layerCount: number) {
    this.ports = ports.map((entry) => {
      const { port } = entry
      if (!entry.capacityMeshNodeId.length || ![port.x, port.y, entry.traceWidth].every(Number.isFinite) || entry.traceWidth <= 0 || !Number.isInteger(port.z) || port.z < 0 || port.z >= layerCount || !port.connectionName.length || !(port.rootConnectionName ?? port.connectionName).length) throw new Error("Parametric interface reservation has invalid geometry or ownership")
      return Object.freeze({ ...entry, port: Object.freeze({ ...port }) })
    })
    for (const entry of this.ports) this.witnessKeys.add(this.getWitnessKey(entry.capacityMeshNodeId, entry.port, entry.traceWidth))
    this.retainedKeyCodeUnits = [...this.witnessKeys].reduce((total, key) => total + key.length, 0)
  }

  private getWitnessKey(nodeId: string, port: PortPoint, width: number): string {
    return JSON.stringify([
      nodeId, port.portPointId, port.pcb_port_id,
      port.connectionName, port.rootConnectionName,
      port.x, port.y, port.z, width,
    ])
  }

  hasSourceTerminal(nodeId: string, port: PortPoint, width: number): boolean {
    const key = this.getWitnessKey(nodeId, port, width)
    // Exact immutable provenance identity; this avoids an all-scene scan for
    // each local port when reconstructing a worker's own-node obligations.
    // Set/JSON allocation is setup overhead, not counted as geometry queries.
    return this.witnessKeys.has(key)
  }

  query(node: NodeWithPortPoints, candidateRadius: number, clearance: number): Pipeline9ParametricInterfacePort[] {
    if (![candidateRadius, clearance].every(Number.isFinite) || candidateRadius <= 0 || clearance < 0) throw new Error("Parametric reservation query has invalid dimensions")
    // Every candidate centerline is in the cell, including its exact normal
    // leads. Expand by candidate radius/gap; entries already include their own
    // physical radius. AABB rejection never decides a contact on its own.
    const reach = candidateRadius + clearance + 1e-6 + 1e-9
    // A counted linear broadphase once per cell keeps the serialized witness
    // scene identical for serial and worker batches; no per-formula scene scan.
    return this.ports.filter((entry) => {
      const radius = entry.traceWidth / 2
      return entry.port.x + radius >= node.center.x - node.width / 2 - reach && entry.port.x - radius <= node.center.x + node.width / 2 + reach && entry.port.y + radius >= node.center.y - node.height / 2 - reach && entry.port.y - radius <= node.center.y + node.height / 2 + reach
    })
  }
}
