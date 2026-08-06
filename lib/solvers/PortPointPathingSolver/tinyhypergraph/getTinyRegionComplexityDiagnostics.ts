import type { HyperGraphHg, RegionHg } from "../hgportpointpathingsolver/types"

type NeighborPortCount = {
  neighborRegionId: string
  portCount: number
}

type RouteEndpoint = {
  regionId: string
  terminalKey: string
}

const getNeighborPortCounts = (region: RegionHg): NeighborPortCount[] => {
  const portCountByNeighborId = new Map<string, number>()

  for (const port of region.ports) {
    const neighbor =
      port.region1.regionId === region.regionId ? port.region2 : port.region1
    portCountByNeighborId.set(
      neighbor.regionId,
      (portCountByNeighborId.get(neighbor.regionId) ?? 0) + 1,
    )
  }

  return [...portCountByNeighborId.entries()]
    .map(([neighborRegionId, portCount]) => ({
      neighborRegionId,
      portCount,
    }))
    .sort((left, right) => right.portCount - left.portCount)
}

const getPortCountByLayer = (region: RegionHg): Record<string, number> => {
  const countByLayer: Record<string, number> = {}
  for (const port of region.ports) {
    const layerKey = `z${port.d.z}`
    countByLayer[layerKey] = (countByLayer[layerKey] ?? 0) + 1
  }
  return countByLayer
}

const getPortKindCounts = (region: RegionHg) => {
  let crampedPortCount = 0
  let componentBoundaryPortCount = 0
  let crampedComponentBoundaryPortCount = 0

  for (const port of region.ports) {
    const neighbor =
      port.region1.regionId === region.regionId ? port.region2 : port.region1
    if (port.d.cramped) crampedPortCount++
    const crossesComponentBoundary =
      Boolean(region.d._isComponentTopologyNode) !==
      Boolean(neighbor.d._isComponentTopologyNode)
    if (!crossesComponentBoundary) continue
    componentBoundaryPortCount++
    if (port.d.cramped) crampedComponentBoundaryPortCount++
  }

  return {
    crampedPortCount,
    componentBoundaryPortCount,
    crampedComponentBoundaryPortCount,
  }
}

export const getTinyRegionComplexityDiagnostics = ({
  graph,
  routeCount,
  routeEndpoints,
}: {
  graph: HyperGraphHg
  routeCount: number
  routeEndpoints: RouteEndpoint[]
}) => {
  const routeEndpointCountByRegionId = new Map<string, number>()
  const terminalKeysByRegionId = new Map<string, Set<string>>()
  for (const { regionId, terminalKey } of routeEndpoints) {
    routeEndpointCountByRegionId.set(
      regionId,
      (routeEndpointCountByRegionId.get(regionId) ?? 0) + 1,
    )
    const terminalKeys = terminalKeysByRegionId.get(regionId) ?? new Set()
    terminalKeys.add(terminalKey)
    terminalKeysByRegionId.set(regionId, terminalKeys)
  }

  const regions = graph.regions
    .map((region) => {
      const neighborPortCounts = getNeighborPortCounts(region)
      const portCount = region.ports.length
      const routeEndpointCount =
        routeEndpointCountByRegionId.get(region.regionId) ?? 0
      const uniqueRouteEndpointCount =
        terminalKeysByRegionId.get(region.regionId)?.size ?? 0
      const portCountAfterTerminals = portCount + routeEndpointCount
      const portCountAfterSharedTerminals =
        portCount + uniqueRouteEndpointCount
      const portKindCounts = getPortKindCounts(region)
      return {
        regionId: region.regionId,
        center: region.d.center,
        width: region.d.width,
        height: region.d.height,
        availableZ: region.d.availableZ,
        portCount,
        routeEndpointCount,
        uniqueRouteEndpointCount,
        portCountAfterTerminals,
        portCountAfterSharedTerminals,
        portCountByLayer: getPortCountByLayer(region),
        ...portKindCounts,
        neighborCount: neighborPortCounts.length,
        largestNeighborPortCount: neighborPortCounts[0]?.portCount ?? 0,
        boundaryTraceUpperBound: Math.floor(portCount / 2),
        routeTraceUpperBound: routeCount,
        implicitDirectedTransitions: portCount * Math.max(portCount - 1, 0),
        implicitDirectedTransitionsAfterTerminals:
          portCountAfterTerminals * Math.max(portCountAfterTerminals - 1, 0),
        implicitDirectedTransitionsAfterSharedTerminals:
          portCountAfterSharedTerminals *
          Math.max(portCountAfterSharedTerminals - 1, 0),
        containsTarget: Boolean(region.d._containsTarget),
        containsObstacle: Boolean(region.d._containsObstacle),
        componentTopology: Boolean(region.d._isComponentTopologyNode),
        topNeighborPortCounts: neighborPortCounts.slice(0, 8),
      }
    })
    .sort(
      (left, right) =>
        right.implicitDirectedTransitionsAfterTerminals -
        left.implicitDirectedTransitionsAfterTerminals,
    )

  return {
    regionCount: regions.length,
    portCount: graph.ports.length,
    routeCount,
    totalImplicitDirectedTransitions: regions.reduce(
      (sum, region) => sum + region.implicitDirectedTransitions,
      0,
    ),
    totalImplicitDirectedTransitionsAfterTerminals: regions.reduce(
      (sum, region) =>
        sum + region.implicitDirectedTransitionsAfterTerminals,
      0,
    ),
    totalImplicitDirectedTransitionsAfterSharedTerminals: regions.reduce(
      (sum, region) =>
        sum + region.implicitDirectedTransitionsAfterSharedTerminals,
      0,
    ),
    topRegions: regions.slice(0, 30),
  }
}
