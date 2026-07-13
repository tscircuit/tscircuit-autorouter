import type { GraphicsObject } from "graphics-debug"
import type { HyperGraphHg, RegionPortHg } from "../types"

/** Draws regions and ports from the HG hypergraph for debugging. */
export function visualizeHgHyperGraph(graph: HyperGraphHg): GraphicsObject {
  const graphics: GraphicsObject = {
    rects: [],
    points: [],
  }

  for (const region of graph.regions) {
    if (region.d._offBoardConnectionId) continue
    graphics.rects!.push({
      center: region.d.center,
      width: region.d.width,
      height: region.d.height,
      fill: "rgba(200, 200, 200, 0.5)",
      label: region.regionId,
    })
  }

  for (const port of graph.ports) {
    const offBoardRegion = [port.region1, port.region2].find((region) =>
      Boolean(region.d._offBoardConnectionId),
    )
    if (!offBoardRegion) continue
    graphics.points!.push({
      x: port.d.x,
      y: port.d.y,
      color: "rgba(130, 40, 210, 0.9)",
      label: `prefab portal: ${offBoardRegion.d._offBoardConnectionId}`,
    })
  }

  return graphics
}
