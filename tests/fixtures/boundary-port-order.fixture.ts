import type { HyperGraphHg, RegionHg, RegionPortHg } from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver/types"

export const makeBoundaryPortOrderGraph = (): HyperGraphHg => {
  const definitions = [
    ["center", 0, 0, 2, 2], ["east-lower", 2, -0.5, 2, 1],
    ["east-upper", 2, 0.5, 2, 1], ["west", -2, 0, 2, 2],
    ["north", 0, 2, 2, 2], ["south", 0, -2, 2, 2],
  ] as const
  const regions: RegionHg[] = definitions.map(([id, x, y, width, height]) => ({
    regionId: id, ports: [], d: { capacityMeshNodeId: id, center: { x, y },
      width, height, layer: "top", availableZ: [0, 1],
      ...(id === "center" ? { layerChangeAllowedNetIds: [] } : {}) },
  }))
  const center = regions[0]!, ports: RegionPortHg[] = []
  for (const [index, x, y] of [[1, 1, -0.5], [2, 1, 0.5], [3, -1, 0], [4, 0, 1], [5, 0, -1]]) {
    const other = regions[index!]!
    const port: RegionPortHg = { portId: `port-${index}`, region1: center, region2: other,
      d: { portId: `port-${index}`, x: x!, y: y!, z: 0, distToCentermostPortOnZ: 0,
        regions: [center, other] } }
    center.ports.push(port)
    other.ports.push(port)
    ports.push(port)
  }
  return { regions, ports }
}
