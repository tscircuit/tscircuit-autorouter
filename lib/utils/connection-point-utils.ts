import type {
  ConnectionPoint,
  MultiLayerConnectionPoint,
  SingleLayerConnectionPoint,
} from "../types/srj-types";

// Type guards and helpers for ConnectionPoint types
export function isMultiLayerConnectionPoint(
  point: ConnectionPoint,
): point is MultiLayerConnectionPoint {
  return "layers" in point && Array.isArray((point as any).layers);
}

export function isSingleLayerConnectionPoint(
  point: ConnectionPoint,
): point is SingleLayerConnectionPoint {
  return "layer" in point && typeof (point as any).layer === "string";
}

/**
 * Gets the primary layer from a connection point.
 * For MultiLayerConnectionPoint, returns the first layer as default.
 */
export function getConnectionPointLayer(point: ConnectionPoint): string {
  if (isMultiLayerConnectionPoint(point)) {
    return point.layers[0];
  }
  return point.layer;
}

/**
 * Gets all layers from a connection point.
 * For ConnectionPoint, returns an array with the single layer.
 */
export function getConnectionPointLayers(point: ConnectionPoint): string[] {
  if (isMultiLayerConnectionPoint(point)) {
    return point.layers;
  }
  return [point.layer];
}
