import { ConnectionPoint, PointKey } from "lib/types"
import {
  isMultiLayerConnectionPoint,
  isSingleLayerConnectionPoint,
} from "./connection-point-utils"

/**
 * Generates a unique string key for a ConnectionPoint,
 * prioritizing pointId if available, otherwise using coordinates and layer(s).
 */
export function getPointKey(connectionPoint: ConnectionPoint): PointKey {
  if (connectionPoint.pointId) {
    return connectionPoint.pointId
  }

  let layerKey = ""
  if (isSingleLayerConnectionPoint(connectionPoint)) {
    layerKey = connectionPoint.layer
  } else if (
    isMultiLayerConnectionPoint(connectionPoint) &&
    connectionPoint.layers
  ) {
    layerKey = connectionPoint.layers.sort().join("-") // Sort layers for consistent key
  }

  // Using toFixed(4) for precision in coordinate-based keys
  return `${connectionPoint.x.toFixed(4)},${connectionPoint.y.toFixed(4)},${layerKey}`
}
