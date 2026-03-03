import type { GraphicsObject } from "graphics-debug"
import type { TypedHyperGraph, TypedRegionPort } from "../types"

/** Draws regions and ports from the typed hypergraph for debugging. */
export function visualizeTypedHyperGraph(
  graph: TypedHyperGraph,
): GraphicsObject {
  const graphics: GraphicsObject = {
    rects: [],
    points: [],
  }

  for (const region of graph.regions) {
    graphics.rects!.push({
      center: region.d.center,
      width: region.d.width,
      height: region.d.height,
      fill: "rgba(200, 200, 200, 0.5)",
      label: region.regionId,
    })
  }

  let lastPort: TypedRegionPort | undefined = graph.ports[0]
  let padding = 0

  for (const port of graph.ports) {
    if (lastPort && port.d.parentPortId === lastPort.d.parentPortId) {
      padding += 0.1
    } else {
      padding = 0
    }

    graphics.points!.push({
      x: port.d.x + padding,
      y: port.d.y,
      color: "rgba(4, 90, 20, 0.3)",
      label: port.portId,
    })
    lastPort = port
  }

  return graphics
}
