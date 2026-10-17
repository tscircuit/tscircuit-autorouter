import { RbushIndex } from "lib/data-structures/RbushIndex"

type PhysicalViaTopology = {
  portX: ArrayLike<number>
  portY: ArrayLike<number>
  regionCenterX: ArrayLike<number>
  regionCenterY: ArrayLike<number>
  regionWidth: ArrayLike<number>
  regionHeight: ArrayLike<number>
  regionMetadata?: { isLayerTransition?: boolean }[]
}

type ViaRegionPortConflicts = {
  portsByRegion: number[][]
  regionsByPort: number[][]
}

/** Index all layers; the native solver applies each route's actual via span. */
export const getPhysicalViaRegionPortConflicts = (
  topology: PhysicalViaTopology,
  traceWidth: number,
  clearance: number,
): ViaRegionPortConflicts => {
  const index = new RbushIndex<number>()
  const portsByRegion = Array.from(
    { length: topology.regionWidth.length },
    (): number[] => [],
  )
  const regionsByPort = Array.from(
    { length: topology.portX.length },
    (): number[] => [],
  )
  for (let port = 0; port < topology.portX.length; port++) {
    const x = topology.portX[port]!
    const y = topology.portY[port]!
    index.insert(port, x, y, x, y)
  }
  for (let region = 0; region < topology.regionWidth.length; region++) {
    if (!topology.regionMetadata?.[region]?.isLayerTransition) continue
    const x = topology.regionCenterX[region]!
    const y = topology.regionCenterY[region]!
    const diameter = Math.max(
      topology.regionWidth[region]!,
      topology.regionHeight[region]!,
    )
    const radius = diameter / 2 + Math.max(traceWidth, diameter) / 2 + clearance
    for (const port of index.search(
      x - radius,
      y - radius,
      x + radius,
      y + radius,
    )) {
      if (
        Math.hypot(topology.portX[port]! - x, topology.portY[port]! - y) >=
        radius - 1e-6
      ) {
        continue
      }
      portsByRegion[region]!.push(port)
      regionsByPort[port]!.push(region)
    }
  }
  return { portsByRegion, regionsByPort }
}
