import type {
  ConnectionPoint,
  MultiLayerConnectionPoint,
  SingleLayerConnectionPoint,
} from "../types/srj-types"

// Type guards and helpers for ConnectionPoint types
export function isMultiLayerConnectionPoint(
  point: ConnectionPoint,
): point is MultiLayerConnectionPoint {
  return !("layer" in point) && Array.isArray(point.layers)
}

export function isSingleLayerConnectionPoint(
  point: ConnectionPoint,
): point is SingleLayerConnectionPoint {
  return !("layers" in point) && typeof point.layer === "string"
}

/**
 * Gets the primary layer from a connection point.
 * For MultiLayerConnectionPoint, returns the first layer as default.
 */
export function getConnectionPointLayer(point: ConnectionPoint): string {
  return getConnectionPointLayers(point)[0]
}

/**
 * Gets all layers from a connection point.
 * For ConnectionPoint, returns an array with the single layer.
 */
export function getConnectionPointLayers(point: ConnectionPoint): string[] {
  if (isMultiLayerConnectionPoint(point)) {
    return point.layers
  }
  if (isSingleLayerConnectionPoint(point)) {
    return [point.layer]
  }
  throw new Error(
    "Connection point must specify either layer or layers, never both",
  )
}
