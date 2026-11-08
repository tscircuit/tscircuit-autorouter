import type { SerializedHyperGraph } from "@tscircuit/hypergraph"

type Bounds = { minX: number; maxX: number; minY: number; maxY: number }

/** Two narrow crossings cannot carry foreign nets when no legal anchors separate them. */
export const addBoundaryPortClearanceConflicts = (
  graph: SerializedHyperGraph,
  boundsByPortId: ReadonlyMap<string, Bounds>,
  separation: number,
): SerializedHyperGraph => {
  const portsByRegion = new Map<string, typeof graph.ports>()
  for (const port of graph.ports) {
    if (!boundsByPortId.has(port.portId)) continue
    for (const id of [port.region1Id, port.region2Id]) {
      const ports = portsByRegion.get(id) ?? []
      ports.push(port)
      portsByRegion.set(id, ports)
    }
  }
  const conflicts = new Map<string, Set<string>>()
  for (const ports of portsByRegion.values()) {
    for (let i = 0; i < ports.length; i++) {
      const first = ports[i]!
      const a = boundsByPortId.get(first.portId)!
      for (const second of ports.slice(i + 1)) {
        if (first.portId === second.portId || first.d!.z !== second.d!.z)
          continue
        const b = boundsByPortId.get(second.portId)!
        const maxDistance = Math.hypot(
          Math.max(Math.abs(a.minX - b.maxX), Math.abs(a.maxX - b.minX)),
          Math.max(Math.abs(a.minY - b.maxY), Math.abs(a.maxY - b.minY)),
        )
        if (maxDistance >= separation - 1e-8) continue
        for (const [left, right] of [
          [first.portId, second.portId],
          [second.portId, first.portId],
        ]) {
          const ids = conflicts.get(left!) ?? new Set<string>()
          ids.add(right!)
          conflicts.set(left!, ids)
        }
      }
    }
  }
  return {
    ...graph,
    ports: graph.ports.map((port) =>
      conflicts.has(port.portId)
        ? {
            ...port,
            d: {
              ...port.d,
              clearanceConflictPortIds: [...conflicts.get(port.portId)!].sort(),
            },
          }
        : port,
    ),
  }
}
