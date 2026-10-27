import type { SerializedHyperGraph } from "@tscircuit/hypergraph"

export type TerminalPortIdentity = {
  portId: string
  terminalRegionId: string
  physicalTerminalId: string | undefined
  netId: string
  hostRegionId: string
  z: number
  x: number
  y: number
}

/** Reuse an actual terminal identity; equal net labels or XY alone never join ports. */
export const shareConnectedTerminalPorts = (args: {
  graph: SerializedHyperGraph
  terminals: TerminalPortIdentity[]
}): void => {
  const canonicalByIdentity = new Map<string, TerminalPortIdentity>()
  const replacementByPortId = new Map<string, string>()
  const removedRegionIds = new Set<string>()
  for (const terminal of args.terminals) {
    if (!terminal.physicalTerminalId) continue
    const key = JSON.stringify([
      terminal.netId, terminal.physicalTerminalId, terminal.hostRegionId,
      terminal.z, terminal.x, terminal.y,
    ])
    const canonical = canonicalByIdentity.get(key)
    if (!canonical) {
      canonicalByIdentity.set(key, terminal)
      continue
    }
    replacementByPortId.set(terminal.portId, canonical.portId)
    removedRegionIds.add(terminal.terminalRegionId)
  }
  if (replacementByPortId.size === 0) return
  args.graph.regions = args.graph.regions.filter((region) => !removedRegionIds.has(region.regionId))
  args.graph.ports = args.graph.ports.filter((port) => !replacementByPortId.has(port.portId))
  for (const region of args.graph.regions) {
    region.pointIds = [...new Set(region.pointIds.map((portId) => replacementByPortId.get(portId) ?? portId))]
  }
  for (const route of args.graph.solvedRoutes ?? []) {
    for (const point of route.path) {
      point.portId = replacementByPortId.get(point.portId) ?? point.portId
    }
  }
}
