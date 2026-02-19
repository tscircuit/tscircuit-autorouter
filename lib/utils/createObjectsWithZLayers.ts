import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"

type LayerMappedObject = {
  zLayers?: number[]
  layers?: string[]
}

/**
 * Produces a derived object array where every item has a valid `zLayers` array.
 *
 * This centralizes layer normalization for inputs that may only provide
 * string-based `layers`, so downstream solvers can safely use z-layer logic
 * without requiring pipeline-level SRJ preprocessing or mutating original data.
 */
export const createObjectsWithZLayers = <T extends LayerMappedObject>(
  objects: ReadonlyArray<T>,
  layerCount: number = 2,
): Array<T & { zLayers: number[] }> => {
  const allZLayers = Array.from({ length: layerCount }, (_, i) => i)

  return objects.map((object) => {
    const rawZLayers =
      object.zLayers ??
      object.layers?.map((layer) => mapLayerNameToZ(layer, layerCount)) ??
      allZLayers

    const zLayers = Array.from(
      new Set(rawZLayers.filter((z) => z >= 0 && z < layerCount)),
    )

    return { ...object, zLayers: zLayers.length > 0 ? zLayers : allZLayers }
  })
}
