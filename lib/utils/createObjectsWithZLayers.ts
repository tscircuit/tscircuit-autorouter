import {
  getUniqueValidZLayers,
  getUniqueValidZLayersFromLayerNames,
} from "lib/utils/mapLayerNameToZ";

type LayerMappedObject = {
  __zLayers?: number[];
  layers?: string[];
};

/**
 * Produces a derived object array where every item has a valid `__zLayers` array.
 *
 * This centralizes layer normalization for inputs that may only provide
 * string-based `layers`, so downstream solvers can safely use z-layer logic
 * without requiring pipeline-level SRJ preprocessing or mutating original data.
 */
export const createObjectsWithZLayers = <T extends LayerMappedObject>(
  objects: ReadonlyArray<T>,
  layerCount: number = 2,
): Array<T & { __zLayers: number[] }> => {
  const allZLayers = Array.from({ length: layerCount }, (_, i) => i);

  return objects.map((object) => {
    const candidateZLayers =
      object.__zLayers ??
      (object.layers
        ? getUniqueValidZLayersFromLayerNames(object.layers, layerCount)
        : undefined) ??
      allZLayers;

    const zLayers = getUniqueValidZLayers(candidateZLayers, layerCount);

    return { ...object, __zLayers: zLayers.length > 0 ? zLayers : allZLayers };
  });
};
