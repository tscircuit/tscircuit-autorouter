import type { TinyHyperGraphProblem, TinyHyperGraphTopology } from "tiny-hypergraph/lib/core"

type PortBounds = { minX: number; maxX: number; minY: number; maxY: number }

const getSharedBoundaryBounds = (
  topology: TinyHyperGraphTopology,
  portId: number,
): PortBounds | undefined => {
  const regions = topology.incidentPortRegion[portId]!
  if (regions.length !== 2 || regions[0] === regions[1]) return undefined
  const bounds = regions.map(regionId => ({
    minX: topology.regionCenterX[regionId]! - topology.regionWidth[regionId]! / 2,
    maxX: topology.regionCenterX[regionId]! + topology.regionWidth[regionId]! / 2,
    minY: topology.regionCenterY[regionId]! - topology.regionHeight[regionId]! / 2,
    maxY: topology.regionCenterY[regionId]! + topology.regionHeight[regionId]! / 2,
  }))
  const shared = {
    minX: Math.max(bounds[0]!.minX, bounds[1]!.minX),
    maxX: Math.min(bounds[0]!.maxX, bounds[1]!.maxX),
    minY: Math.max(bounds[0]!.minY, bounds[1]!.minY),
    maxY: Math.min(bounds[0]!.maxY, bounds[1]!.maxY),
  }
  if (shared.maxX < shared.minX - 1e-9 || shared.maxY < shared.minY - 1e-9) return undefined
  // Interior terminals and layer transitions do not represent shared edges.
  if (shared.maxX - shared.minX > 1e-9 && shared.maxY - shared.minY > 1e-9) return undefined
  return shared
}

/** Board-world points in mm, +X right and +Y up. Two crossings are exclusive
 * only when even the farthest placements on their shared edges cannot clear. */
export function getPhysicalPortConflicts(
  topology: TinyHyperGraphTopology,
  minimumSpacing: number,
): NonNullable<TinyHyperGraphProblem["portConflicts"]> {
  const bounds = Array.from({ length: topology.portCount }, (_, portId) =>
    getSharedBoundaryBounds(topology, portId))
  const conflicts = Array.from({ length: topology.portCount }, () => new Set<number>())
  for (const ports of topology.regionIncidentPorts) {
    for (let firstIndex = 0; firstIndex < ports.length; firstIndex++) {
      const first = ports[firstIndex]!, firstBounds = bounds[first]
      if (!firstBounds) continue
      for (const second of ports.slice(firstIndex + 1)) {
        const secondBounds = bounds[second]
        if (!secondBounds || topology.portZ[first] !== topology.portZ[second]) continue
        const maxXDistance = Math.max(
          Math.abs(firstBounds.minX - secondBounds.maxX),
          Math.abs(firstBounds.maxX - secondBounds.minX),
        )
        const maxYDistance = Math.max(
          Math.abs(firstBounds.minY - secondBounds.maxY),
          Math.abs(firstBounds.maxY - secondBounds.minY),
        )
        if (Math.hypot(maxXDistance, maxYDistance) >= minimumSpacing - 1e-9) continue
        conflicts[first]!.add(second)
        conflicts[second]!.add(first)
      }
    }
  }
  return conflicts.map(ports => [...ports])
}
