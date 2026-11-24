import type { LayerRef } from "circuit-json"

export type LayerName = LayerRef

export const mapZToLayerName = (z: number, layerCount: number): LayerName => {
  if (z === 1 && layerCount === 1) return "inner1"
  if (z < 0 || z >= layerCount) {
    throw new Error(`Invalid z "${z}" for layer count: ${layerCount}`)
  }

  if (z === 0) return "top"
  if (z === layerCount - 1) return "bottom"
  return `inner${z}` as LayerName
}
