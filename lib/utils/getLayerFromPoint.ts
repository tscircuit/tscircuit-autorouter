/**
 * Returns the first layer name from a point that may have `layer` or `layers`.
 */
export function getLayerFromPoint({
  point,
}: {
  point: { layer?: string; layers?: string[] } | null | undefined
}): string | undefined {
  if (!point) return undefined
  if ("layers" in point && Array.isArray(point.layers)) {
    return point.layers[0]
  }
  return point.layer
}
