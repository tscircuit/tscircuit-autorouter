import type { SimpleRouteJson } from "lib/types"
import { mapZToLayerName } from "./mapZToLayerName"

export function getRoutingLayerIndices({
  layerCount,
  routingLayers,
}: Pick<SimpleRouteJson, "layerCount" | "routingLayers">): number[] {
  const physicalLayers = Array.from({ length: layerCount }, (_, z) =>
    mapZToLayerName(z, layerCount),
  )
  if (routingLayers === undefined) return physicalLayers.map((_, z) => z)
  if (!routingLayers.length)
    throw new Error("routingLayers must contain a copper layer")
  const allowedLayers = new Set(routingLayers)
  const indices = physicalLayers.flatMap((layer, z) =>
    allowedLayers.has(layer) ? [z] : [],
  )
  if (indices.length !== allowedLayers.size) {
    throw new Error(
      `Invalid routingLayers for a ${layerCount}-layer board: ${routingLayers.join(", ")}`,
    )
  }
  return indices
}
