import type { SerializedHyperGraph } from "@tscircuit/hypergraph"

type Port = SerializedHyperGraph["ports"][number]
type Region = SerializedHyperGraph["regions"][number]
type Bounds = { minX: number; maxX: number; minY: number; maxY: number }

const getBounds = (region: Region): Bounds => {
  const { center, width, height } = region.d
  return region.d.bounds ?? {
    minX: center.x - width / 2,
    maxX: center.x + width / 2,
    minY: center.y - height / 2,
    maxY: center.y + height / 2,
  }
}

/** Keep original ports fixed; place extra capacity only where another trace fits. */
export const fitDuplicatePortsToSharedBoundary = (
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
  const regions = new Map(
    graph.regions.map((region) => [region.regionId, region]),
  )
  const boundaryKey = (port: Port): string =>
    JSON.stringify([[port.region1Id, port.region2Id].sort(), port.d.z])
  const occupied = new Map<string, Port[]>()
  for (const port of graph.ports) {
    if (typeof port.d.duplicatedFromPortId === "string") continue
    const key = boundaryKey(port)
    const ports = occupied.get(key) ?? []
    ports.push(port)
    occupied.set(key, ports)
  }
  const removed = new Set<string>()
  const ports = graph.ports.flatMap((port): Port[] => {
    if (typeof port.d.duplicatedFromPortId !== "string") return [port]
    const a = regions.get(port.region1Id)
    const b = regions.get(port.region2Id)
    if (!a || !b) {
      throw new Error(`Missing adjacent region for port ${port.portId}`)
    }
    const aa = getBounds(a)
    const bb = getBounds(b)
    const x1 = Math.max(aa.minX, bb.minX)
    const x2 = Math.min(aa.maxX, bb.maxX)
    const y1 = Math.max(aa.minY, bb.minY)
    const y2 = Math.min(aa.maxY, bb.maxY)
    const vertical = Math.abs(x2 - x1) < 1e-7 && y2 > y1
    const horizontal = Math.abs(y2 - y1) < 1e-7 && x2 > x1
    // Point contacts and overlapping regions do not provide a shared edge
    // on which additional planar capacity can be demonstrated.
    if (!vertical && !horizontal) {
      removed.add(port.portId)
      return []
    }
    const key = boundaryKey(port)
    const existing = occupied.get(key) ?? []
    const axis = vertical ? "y" : "x"
    const low = (vertical ? y1 : x1) + traceWidth / 2
    const high = (vertical ? y2 : x2) - traceWidth / 2
    const positions = existing
      .map((p) => p.d[axis] as number)
      .sort((a, b) => a - b)
    // Select the largest free interval after excluding all existing ports.
    let cursor = low
    let bestStart = low
    let bestEnd = low - 1
    for (const position of [...positions, high + spacing]) {
      const end = Math.min(high, position - spacing)
      if (end >= cursor && end - cursor > bestEnd - bestStart) {
        bestStart = cursor
        bestEnd = end
      }
      cursor = Math.max(cursor, position + spacing)
    }
    if (bestEnd < bestStart) {
      removed.add(port.portId)
      return []
    }
    const position = bestStart
    const placed: Port = {
      ...port,
      d: {
        ...port.d,
        x: vertical ? (x1 + x2) / 2 : position,
        y: vertical ? position : (y1 + y2) / 2,
      },
    }
    existing.push(placed)
    occupied.set(key, existing)
    return [placed]
  })
  return {
    ...graph,
    ports,
    regions: graph.regions.map((region) => ({
      ...region,
      pointIds: region.pointIds.filter((id) => !removed.has(id)),
    })),
  }
}
