import type { SerializedHyperGraph } from "@tscircuit/hypergraph"

type Port = SerializedHyperGraph["ports"][number]
type Region = SerializedHyperGraph["regions"][number]
type Bounds = { minX: number; maxX: number; minY: number; maxY: number }

const getBounds = (region: Region): Bounds => {
  const { center, width, height } = region.d
  return (
    region.d.bounds ?? {
      minX: center.x - width / 2,
      maxX: center.x + width / 2,
      minY: center.y - height / 2,
      maxY: center.y + height / 2,
    }
  )
}

/** Estimate cramped boundary capacity without changing graph geometry. */
export const assignCrampedPortCapacityCosts = (
  graph: SerializedHyperGraph,
  traceWidth: number,
  clearance: number,
): SerializedHyperGraph => {
  const spacing = traceWidth + clearance
  if (!(traceWidth > 0) || !(clearance >= 0) || !Number.isFinite(spacing)) {
    throw new Error(
      "Duplicate port capacity requires a positive width and nonnegative clearance",
    )
  }
  const regions = new Map(graph.regions.map((region) => [region.regionId, region]))
  const boundaryKey = (port: Port): string =>
    JSON.stringify([[port.region1Id, port.region2Id].sort(), port.d.z])
  const capacities = new Map<string, number>()
  for (const port of graph.ports) {
    if (!port.d.cramped) continue
    const a = regions.get(port.region1Id)
    const b = regions.get(port.region2Id)
    if (!a || !b) {
      throw new Error(`Missing adjacent region for port ${port.portId}`)
    }
    const aa = getBounds(a)
    const bb = getBounds(b)
    const dx = Math.min(aa.maxX, bb.maxX) - Math.max(aa.minX, bb.minX)
    const dy = Math.min(aa.maxY, bb.maxY) - Math.max(aa.minY, bb.minY)
    const length =
      Math.abs(dx) < 1e-7 && dy > 0
        ? dy
        : Math.abs(dy) < 1e-7 && dx > 0
          ? dx
          : undefined
    // Point contacts and overlapping regions have no shared-edge width to
    // estimate. Their connectivity and existing routing costs stay unchanged.
    if (length === undefined) continue

    // UniformPortDistributionSolver redistributes original ports too. Estimate
    // the whole edge's capacity, rather than treating initial positions as fixed.
    const capacity = Math.max(1, Math.floor((length + clearance + 1e-9) / spacing))
    capacities.set(boundaryKey(port), capacity)
  }
  const ports = graph.ports.map((port): Port => {
    const key = boundaryKey(port)
    const capacity = capacities.get(key)
    if (capacity === undefined) return port
    return {
      ...port,
      d: {
        ...port.d,
        crampedBoundaryKey: key,
        crampedBoundaryCapacity: capacity,
        crampedBoundaryPitch: spacing,
      },
    }
  })
  return { ...graph, ports }
}
