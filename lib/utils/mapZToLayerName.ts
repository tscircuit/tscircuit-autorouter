export type LayerName =
  | "top"
  | "bottom"
  | "inner1"
  | "inner2"
  | "inner3"
  | "inner4"
  | "inner5"
  | "inner6"

export const mapZToLayerName = (z: number, layerCount: number): LayerName => {
  if (z === 1 && layerCount === 1) return "inner1"
  if (z < 0 || z >= layerCount) {
    throw new Error(`Invalid z "${z}" for layer count: ${layerCount}`)
  }

  if (z === 0) return "top"
  if (z === layerCount - 1) return "bottom"
  return `inner${z}` as any
}
