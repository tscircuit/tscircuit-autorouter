import { getViaLayers } from "high-density-repair03/lib"
import { type LayerName, mapZToLayerName } from "./mapZToLayerName"

/** Physical layers occupied by a via on this board. */
export function getViaDrillLayers(
  via: { from_layer: string; to_layer: string; layers?: string[] },
  layerCount: number,
  allowBlindAndBuriedVias: boolean,
): LayerName[] {
  if (allowBlindAndBuriedVias && via.layers !== undefined) {
    return via.layers as LayerName[]
  }
  const drillSpan = allowBlindAndBuriedVias
    ? via
    : {
        from_layer: "top",
        to_layer: mapZToLayerName(layerCount - 1, layerCount),
      }
  return getViaLayers(drillSpan, layerCount) as LayerName[]
}
