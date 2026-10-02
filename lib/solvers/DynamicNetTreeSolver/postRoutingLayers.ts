import type { SimpleRouteJson, SimplifiedPcbTrace } from "../../types"
import { mapZToLayerName } from "../../utils/mapZToLayerName"

/** Transactional input must use one canonical name for each physical layer. */
export function postRoutingLayerIndex(layer: string, layerCount: number): number {
  if (!Number.isInteger(layerCount) || layerCount < 2 || layerCount > 10)
    throw new Error(`Invalid post-routing copper layer count ${layerCount}`)
  const z = layer === "top" ? 0 : layer === "bottom" ? layerCount - 1 :
    /^inner[1-9][0-9]*$/.test(layer) ? Number(layer.slice(5)) : -1
  if (z < 0 || z >= layerCount || mapZToLayerName(z, layerCount) !== layer)
    throw new Error(`Invalid post-routing copper layer ${layer}`)
  return z
}

/** Signal endpoints and the physical drilled span are independent. Follow the
 * native SRJ policy: ordinary vias span the whole stack; blind/buried vias may
 * occupy a contiguous endpoint span, or an explicitly wider physical span. */
export function postRoutingViaLayers(
  srj: Pick<SimpleRouteJson, "layerCount" | "allowBlindAndBuriedVias">,
  via: Extract<SimplifiedPcbTrace["route"][number], { route_type: "via" }>,
): number[] {
  const from = postRoutingLayerIndex(via.from_layer, srj.layerCount)
  const to = postRoutingLayerIndex(via.to_layer, srj.layerCount)
  const min = srj.allowBlindAndBuriedVias ? Math.min(from, to) : 0
  const max = srj.allowBlindAndBuriedVias ? Math.max(from, to) : srj.layerCount - 1
  const layers = via.layers ? via.layers.map((layer) =>
    postRoutingLayerIndex(layer, srj.layerCount)).sort((a, b) => a - b) :
    Array.from({ length: max - min + 1 }, (_, i) => min + i)
  if (from === to || layers.length < 2 || !layers.includes(from) ||
    !layers.includes(to) || layers.some((z, i) => i > 0 && z !== layers[i - 1]! + 1) ||
    (!srj.allowBlindAndBuriedVias && (layers[0] !== 0 || layers.length !== srj.layerCount)))
    throw new Error("Invalid post-routing via physical span")
  return layers
}
